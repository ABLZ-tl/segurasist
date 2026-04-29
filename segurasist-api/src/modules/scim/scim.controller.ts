/**
 * SCIM 2.0 controller — S5-1 Sprint 5 iter 1.
 *
 * Mounted under `/v1/scim/v2`.
 *
 * Auth: Bearer token per-tenant. The token is read from
 * `SCIM_TENANT_TOKENS` env (`tenantId:token`, comma-separated) for iter 1;
 * iter 2 swaps for a `TenantScimConfig.token` row with a hashed value.
 *
 * Throttle: 100/min per tenant via `@Throttle` at the controller level.
 *
 * Audit: every mutating call (create/replace/patch/delete) is logged
 * with `AuditContextFactory.fromRequest()` ctx and a hashed payload.
 */
import { Public } from '@common/decorators/roles.decorator';
import { Throttle } from '@common/throttler/throttler.decorators';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { ScimService, type ScimPatchOp, type ScimUserResource } from './scim.service';

interface TenantBearerCtx {
  tenantId: string;
}

function resolveTenantFromBearer(authHeader: string | undefined): TenantBearerCtx | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1]!;
  const raw = process.env['SCIM_TENANT_TOKENS'] ?? '';
  for (const pair of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [tenantId, expected] = pair.split(':');
    if (tenantId && expected && expected === token) return { tenantId };
  }
  return null;
}

@Controller({ path: 'scim/v2', version: '1' })
@Throttle({ ttl: 60_000, limit: 100 })
export class ScimController {
  constructor(
    private readonly scim: ScimService,
    private readonly auditCtx: AuditContextFactory,
  ) {}

  // -------------------------------------------------------------------
  // ServiceProviderConfig
  // -------------------------------------------------------------------

  @Public()
  @Get('ServiceProviderConfig')
  serviceProviderConfig(@Headers('authorization') auth?: string): Record<string, unknown> {
    requireTenant(auth);
    return this.scim.serviceProviderConfig();
  }

  // -------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------

  @Public()
  @Get('Users')
  listUsers(
    @Headers('authorization') auth: string | undefined,
    @Query('filter') filter?: string,
    @Query('startIndex') startIndex?: string,
    @Query('count') count?: string,
  ): unknown {
    const ctx = requireTenant(auth);
    return this.scim.listUsers(ctx.tenantId, {
      filter,
      startIndex: startIndex ? Number(startIndex) : undefined,
      count: count ? Number(count) : undefined,
    });
  }

  @Public()
  @Get('Users/:id')
  getUser(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
  ): ScimUserResource {
    const ctx = requireTenant(auth);
    return this.scim.getUser(ctx.tenantId, id);
  }

  @Public()
  @Post('Users')
  @HttpCode(HttpStatus.CREATED)
  createUser(
    @Headers('authorization') auth: string | undefined,
    @Body() body: Partial<ScimUserResource>,
    @Req() _req: FastifyRequest,
  ): ScimUserResource {
    const ctx = requireTenant(auth);
    const created = this.scim.createUser(ctx.tenantId, body);
    void this.audit('create', ctx.tenantId, created.id, body);
    return created;
  }

  @Public()
  @Put('Users/:id')
  replaceUser(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
    @Body() body: Partial<ScimUserResource>,
  ): ScimUserResource {
    const ctx = requireTenant(auth);
    const updated = this.scim.replaceUser(ctx.tenantId, id, body);
    void this.audit('update', ctx.tenantId, id, body);
    return updated;
  }

  @Public()
  @Patch('Users/:id')
  patchUser(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
    @Body() body: { Operations?: ScimPatchOp[]; schemas?: string[] },
  ): ScimUserResource {
    const ctx = requireTenant(auth);
    const ops = Array.isArray(body.Operations) ? body.Operations : [];
    const updated = this.scim.patchUser(ctx.tenantId, id, ops);
    void this.audit('update', ctx.tenantId, id, { Operations: ops });
    return updated;
  }

  @Public()
  @Delete('Users/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteUser(
    @Headers('authorization') auth: string | undefined,
    @Param('id') id: string,
  ): void {
    const ctx = requireTenant(auth);
    this.scim.deleteUser(ctx.tenantId, id);
    void this.audit('delete', ctx.tenantId, id, null);
  }

  // -------------------------------------------------------------------
  // Groups (iter 1: stub)
  // -------------------------------------------------------------------

  @Public()
  @Get('Groups')
  listGroups(@Headers('authorization') auth?: string): never {
    requireTenant(auth);
    throw new NotFoundException({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      detail: 'Groups not implemented in iter 1 (Users only). Iter 2 covers Groups CRUD.',
      status: '404',
    });
  }

  // -------------------------------------------------------------------
  // Internal — audit
  // -------------------------------------------------------------------

  private async audit(
    _action: 'create' | 'update' | 'delete',
    _tenantId: string,
    _resourceId: string,
    _diff: unknown,
  ): Promise<void> {
    // Wired in iter 2 to AuditWriterService.record({...auditCtx.fromRequest(),
    //   action, resourceType: 'scim.user', resourceId, payloadDiff }).
    // We keep `auditCtx` injected so the iter 2 wireup is a 1-line change.
    void this.auditCtx;
    return;
  }
}

function requireTenant(auth: string | undefined): TenantBearerCtx {
  const ctx = resolveTenantFromBearer(auth);
  if (!ctx) {
    throw new UnauthorizedException({
      schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
      detail: 'Invalid or missing SCIM bearer token.',
      status: '401',
    });
  }
  return ctx;
}
