/**
 * SCIM 2.0 service — S5-1 Sprint 5 iter 1.
 *
 * Implements the User CRUD subset of RFC 7643/7644 needed for IdP-driven
 * provisioning (Okta / AzureAD / OneLogin push):
 *
 *   - GET    /Users (list, with `userName eq "..."` filter + pagination).
 *   - GET    /Users/:id
 *   - POST   /Users (idempotent on `externalId`).
 *   - PUT    /Users/:id (full replace).
 *   - PATCH  /Users/:id (RFC 7644 §3.5.2 ops: replace/add/remove on
 *                        `active`, `name`, `emails`, `roles`).
 *   - DELETE /Users/:id (soft delete — sets `User.deletedAt`).
 *
 * Iter 1 storage: in-memory map keyed by tenant. Iter 2 swaps the data
 * source for `PrismaBypassRlsService.user` with proper tenant context.
 * The public service surface is stable (`listUsers`, `getUser`,
 * `createUser`, `replaceUser`, `patchUser`, `deleteUser`).
 *
 * Design notes:
 *   - `externalId` is the IdP-side stable ID. `POST /Users` with the
 *     same externalId returns 409 (per Okta's expectation; AzureAD treats
 *     it as "noop", which we still honor by exposing the existing
 *     resource URL in the error detail).
 *   - The platform `User.role` enum maps from a SCIM `roles` array. We
 *     accept the FIRST role and map it via `SCIM_ROLE_MAP` below.
 *   - PII redaction: SCIM payloads always contain emails. The audit
 *     event hashes the userName and stores the resourceId; the diff
 *     itself goes through the existing scrub-sensitive pipeline.
 */
import * as crypto from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { AuditWriterService, type AuditEventAction } from '@modules/audit/audit-writer.service';

export type ScimRole = 'admin_mac' | 'operator' | 'supervisor';

export interface ScimUserResource {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  active: boolean;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: Array<{ value: string; primary?: boolean; type?: string }>;
  roles?: Array<{ value: ScimRole; primary?: boolean }>;
  meta: {
    resourceType: 'User';
    created: string;
    lastModified: string;
    location?: string;
    version: string;
  };
}

export interface ScimListResponse {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: ScimUserResource[];
}

export interface ScimError {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'];
  detail: string;
  status: string;
  scimType?: string;
}

export interface ScimPatchOp {
  op: 'replace' | 'add' | 'remove';
  path?: string;
  value?: unknown;
}

const SCIM_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCIM_ENTERPRISE_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

export const SCIM_ROLE_MAP: Record<string, ScimRole> = {
  admin: 'admin_mac',
  admin_mac: 'admin_mac',
  operator: 'operator',
  supervisor: 'supervisor',
};

interface InternalUser {
  id: string;
  tenantId: string;
  externalId?: string;
  userName: string;
  givenName?: string;
  familyName?: string;
  email: string;
  role: ScimRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
}

@Injectable()
export class ScimService {
  /** In-memory store keyed by `${tenantId}:${userId}`. Iter 2 → Prisma. */
  private readonly store = new Map<string, InternalUser>();
  /** Secondary index (tenantId, externalId) → userId for idempotency. */
  private readonly externalIdIndex = new Map<string, string>();

  /**
   * S5-1 iter 2 — `AuditWriterService` + `AuditContextFactory` are
   * `@Optional()` so the existing integration test (which boots the
   * controller with a fake `AuditContextFactory` and no writer) keeps
   * passing. In production both come from `AuditPersistenceModule`
   * (imported by `ScimModule`).
   */
  constructor(
    @Optional() private readonly auditWriter?: AuditWriterService,
    @Optional() private readonly auditCtx?: AuditContextFactory,
  ) {}

  // -------------------------------------------------------------------
  // List + filter
  // -------------------------------------------------------------------

  listUsers(
    tenantId: string,
    opts: { filter?: string; startIndex?: number; count?: number },
  ): ScimListResponse {
    const all = [...this.store.values()].filter(
      (u) => u.tenantId === tenantId && !u.deletedAt,
    );
    const filtered = opts.filter ? all.filter((u) => matchesFilter(u, opts.filter!)) : all;
    const startIndex = Math.max(1, opts.startIndex ?? 1);
    const count = Math.max(0, Math.min(200, opts.count ?? 100));
    const slice = filtered.slice(startIndex - 1, startIndex - 1 + count);
    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: filtered.length,
      startIndex,
      itemsPerPage: slice.length,
      Resources: slice.map((u) => this.toResource(u)),
    };
  }

  getUser(tenantId: string, id: string): ScimUserResource {
    const u = this.store.get(this.key(tenantId, id));
    if (!u || u.deletedAt) throw new NotFoundException(scimError('User not found', 404));
    return this.toResource(u);
  }

  // -------------------------------------------------------------------
  // Create — idempotent on externalId
  // -------------------------------------------------------------------

  createUser(tenantId: string, payload: Partial<ScimUserResource>): ScimUserResource {
    const externalId = payload.externalId;
    const userName = (payload.userName ?? '').trim();
    if (!userName) {
      throw new ConflictException(scimError('userName is required', 400, 'invalidValue'));
    }
    if (externalId) {
      const existing = this.externalIdIndex.get(`${tenantId}:${externalId}`);
      if (existing) {
        throw new ConflictException(
          scimError(`User with externalId already exists: /Users/${existing}`, 409, 'uniqueness'),
        );
      }
    }
    // Also reject duplicate userName per-tenant (matches our DB unique).
    const dup = [...this.store.values()].find(
      (u) => u.tenantId === tenantId && u.userName === userName && !u.deletedAt,
    );
    if (dup) {
      throw new ConflictException(scimError('userName already in use', 409, 'uniqueness'));
    }
    const id = crypto.randomUUID();
    const now = new Date();
    const role = mapRole(payload.roles?.[0]?.value);
    const email = payload.emails?.[0]?.value ?? userName;
    const u: InternalUser = {
      id,
      tenantId,
      externalId,
      userName,
      givenName: payload.name?.givenName,
      familyName: payload.name?.familyName,
      email,
      role,
      active: payload.active ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(this.key(tenantId, id), u);
    if (externalId) this.externalIdIndex.set(`${tenantId}:${externalId}`, id);
    this.recordAudit('scim_user_created', tenantId, id, {
      externalId: externalId ?? null,
      userNameHash: hashUserName(userName),
      role,
    });
    return this.toResource(u);
  }

  // -------------------------------------------------------------------
  // Replace + Patch
  // -------------------------------------------------------------------

  replaceUser(tenantId: string, id: string, payload: Partial<ScimUserResource>): ScimUserResource {
    const u = this.requireUser(tenantId, id);
    u.userName = (payload.userName ?? u.userName).trim();
    u.givenName = payload.name?.givenName ?? u.givenName;
    u.familyName = payload.name?.familyName ?? u.familyName;
    u.email = payload.emails?.[0]?.value ?? u.email;
    u.role = payload.roles?.[0]?.value ? mapRole(payload.roles[0].value) : u.role;
    u.active = payload.active ?? u.active;
    u.updatedAt = new Date();
    this.recordAudit('scim_user_updated', tenantId, id, {
      mode: 'replace',
      userNameHash: hashUserName(u.userName),
      active: u.active,
    });
    return this.toResource(u);
  }

  patchUser(tenantId: string, id: string, ops: ScimPatchOp[]): ScimUserResource {
    const u = this.requireUser(tenantId, id);
    for (const op of ops) {
      applyPatchOp(u, op);
    }
    u.updatedAt = new Date();
    this.recordAudit('scim_user_updated', tenantId, id, {
      mode: 'patch',
      opCount: ops.length,
      // Persist op kinds without values — values may carry PII (emails).
      opKinds: ops.map((o) => `${o.op}:${(o.path ?? 'body').toLowerCase()}`),
    });
    return this.toResource(u);
  }

  deleteUser(tenantId: string, id: string): void {
    const u = this.requireUser(tenantId, id);
    u.deletedAt = new Date();
    u.active = false;
    u.updatedAt = u.deletedAt;
    this.recordAudit('scim_user_deleted', tenantId, id, {
      userNameHash: hashUserName(u.userName),
      softDelete: true,
    });
  }

  // -------------------------------------------------------------------
  // Service Provider Config
  // -------------------------------------------------------------------

  serviceProviderConfig(): Record<string, unknown> {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://docs.segurasist.local/scim',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [
        {
          type: 'oauthbearertoken',
          name: 'OAuth Bearer Token',
          description: 'Per-tenant SCIM token (Authorization: Bearer ...).',
          primary: true,
        },
      ],
      meta: { resourceType: 'ServiceProviderConfig', location: '/v1/scim/v2/ServiceProviderConfig' },
    };
  }

  // -------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------

  /**
   * S5-1 iter 2 — fire-and-forget audit emission. NEVER persist raw
   * userName / email / patch values: those are hashed at the call site
   * (`hashUserName`) before being placed in `payloadDiff`. The audit
   * row's `resourceId` is the SCIM internal user UUID, which is
   * platform-controlled and safe to expose.
   *
   * If the writer is undefined (unit/integration tests bypass the
   * `AuditPersistenceModule`), this is a no-op — the integration suite
   * keeps green without a Prisma/audit DB.
   */
  private recordAudit(
    action: AuditEventAction,
    tenantId: string,
    resourceId: string,
    payload: Record<string, unknown>,
  ): void {
    if (!this.auditWriter) return;
    const ctx = this.auditCtx?.fromRequest() ?? {};
    void this.auditWriter.record({
      ...ctx,
      tenantId,
      action,
      resourceType: 'scim.user',
      resourceId,
      payloadDiff: payload,
    });
  }

  private key(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }

  private requireUser(tenantId: string, id: string): InternalUser {
    const u = this.store.get(this.key(tenantId, id));
    if (!u || u.deletedAt) throw new NotFoundException(scimError('User not found', 404));
    return u;
  }

  private toResource(u: InternalUser): ScimUserResource {
    return {
      schemas: [SCIM_USER_SCHEMA, SCIM_ENTERPRISE_SCHEMA],
      id: u.id,
      externalId: u.externalId,
      userName: u.userName,
      active: u.active,
      name: {
        givenName: u.givenName,
        familyName: u.familyName,
        formatted: [u.givenName, u.familyName].filter(Boolean).join(' ') || undefined,
      },
      emails: [{ value: u.email, primary: true, type: 'work' }],
      roles: [{ value: u.role, primary: true }],
      meta: {
        resourceType: 'User',
        created: u.createdAt.toISOString(),
        lastModified: u.updatedAt.toISOString(),
        location: `/v1/scim/v2/Users/${u.id}`,
        version: `W/"${u.updatedAt.getTime()}"`,
      },
    };
  }
}

// ============================================================================
// Standalone helpers
// ============================================================================

/**
 * Lowercased SHA-256 of a userName. Used by audit emissions so the row
 * lets us correlate same-user events across create/update/delete without
 * persisting the email itself.
 */
function hashUserName(userName: string): string {
  return crypto.createHash('sha256').update(userName.toLowerCase()).digest('hex');
}

function matchesFilter(u: InternalUser, filter: string): boolean {
  // Iter 1 supports only `userName eq "..."` and `externalId eq "..."`.
  // Iter 2 plugs a small SCIM filter parser (RFC 7644 §3.4.2.2).
  const userNameEq = filter.match(/userName\s+eq\s+"([^"]+)"/i);
  if (userNameEq) return u.userName === userNameEq[1];
  const extIdEq = filter.match(/externalId\s+eq\s+"([^"]+)"/i);
  if (extIdEq) return u.externalId === extIdEq[1];
  return true;
}

function applyPatchOp(u: InternalUser, op: ScimPatchOp): void {
  const path = (op.path ?? '').toLowerCase();
  if (op.op === 'replace' && (!path || path === 'active')) {
    if (typeof op.value === 'boolean') u.active = op.value;
    else if (op.value && typeof op.value === 'object' && 'active' in (op.value as object)) {
      u.active = Boolean((op.value as { active: unknown }).active);
    }
    return;
  }
  if (path === 'name.givenname' && op.op !== 'remove') {
    u.givenName = String(op.value ?? '');
    return;
  }
  if (path === 'name.familyname' && op.op !== 'remove') {
    u.familyName = String(op.value ?? '');
    return;
  }
  if (path.startsWith('emails') && op.op !== 'remove') {
    const v = op.value;
    if (typeof v === 'string') u.email = v;
    else if (Array.isArray(v) && v.length > 0 && typeof v[0]?.value === 'string') u.email = v[0].value;
    return;
  }
  if (path.startsWith('roles')) {
    if (op.op === 'remove') {
      // No-op for iter 1 (we always carry exactly one role).
      return;
    }
    const v = op.value;
    if (Array.isArray(v) && v.length > 0 && typeof v[0]?.value === 'string') {
      u.role = mapRole(v[0].value);
    }
    return;
  }
  // Replace with a body-shaped object, e.g. {active:false, name:{...}}.
  if (op.op === 'replace' && op.value && typeof op.value === 'object') {
    const body = op.value as Record<string, unknown>;
    if (typeof body.active === 'boolean') u.active = body.active;
    if (body.name && typeof body.name === 'object') {
      const n = body.name as Record<string, unknown>;
      if (typeof n.givenName === 'string') u.givenName = n.givenName;
      if (typeof n.familyName === 'string') u.familyName = n.familyName;
    }
  }
}

function mapRole(input: string | undefined): ScimRole {
  if (!input) return 'operator';
  return SCIM_ROLE_MAP[input.toLowerCase()] ?? 'operator';
}

function scimError(detail: string, status: number, scimType?: string): ScimError {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    detail,
    status: String(status),
    ...(scimType ? { scimType } : {}),
  };
}
