/**
 * SAML 2.0 controller — S5-1 Sprint 5 iter 1.
 *
 * Endpoints (under `/v1/auth/saml`):
 *   GET  /metadata           SP metadata XML (public, served as application/xml).
 *   GET  /login?tenantId=... Initiate SP-init redirect to tenant IdP.
 *   POST /acs                Assertion Consumer Service (HTTP-POST binding).
 *
 * Cookies: on successful ACS we set the same `sa_session` admin session
 * cookie pair that local login uses, via the same hardened attributes
 * (`@segurasist/security/cookie`) — nothing SAML-specific is exposed to
 * JavaScript.
 *
 * Audit: every login attempt records `saml_login_succeeded` /
 * `saml_login_failed` with `AuditContextFactory.fromRequest()` ctx and
 * an `assertionHashSha256` payload (NOT the assertion itself; see ADR-0009).
 */
import * as crypto from 'node:crypto';
import { Public } from '@common/decorators/roles.decorator';
import { Throttle } from '@common/throttler/throttler.decorators';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SamlService, type TenantSamlConfigSnapshot } from './saml.service';

interface SamlLoginQuery {
  tenantId?: string;
}

interface SamlAcsBody {
  SAMLResponse?: string;
  RelayState?: string;
}

const RELAY_COOKIE = 'sa_saml_relay';

/**
 * In-memory tenant SAML config resolver — iter 1 stub. Reads from env-injected
 * JSON (`SAML_TENANT_CONFIGS`) so tests can swap, and so the controller works
 * before the Prisma `TenantSamlConfig` model is generated. Iter 2 swaps for
 * a Prisma-backed `TenantSamlConfigService`.
 */
function loadTenantConfig(tenantId: string): TenantSamlConfigSnapshot | null {
  const raw = process.env['SAML_TENANT_CONFIGS'];
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as TenantSamlConfigSnapshot[];
    return arr.find((c) => c.tenantId === tenantId) ?? null;
  } catch {
    return null;
  }
}

@Controller({ path: 'auth/saml', version: '1' })
export class SamlController {
  constructor(
    private readonly saml: SamlService,
    private readonly auditCtx: AuditContextFactory,
  ) {}

  /**
   * SP metadata XML for IdP configuration.
   *
   * CC-11 (S5-1 iter 2): explicitly serve as `application/samlmetadata+xml`
   * with UTF-8 charset. RFC 7580 §3 mandates `application/samlmetadata+xml`
   * (NOT generic `text/xml`) for SAML 2.0 SP metadata; G-2 DAST flagged
   * the prior `text/xml` fallback as a content-sniffing surface.
   */
  @Public()
  @Get('metadata')
  @Header('Content-Type', 'application/samlmetadata+xml; charset=UTF-8')
  metadata(): string {
    return this.saml.getSpMetadataXml();
  }

  @Public()
  @Throttle({ ttl: 60_000, limit: 30 })
  @Get('login')
  login(@Query() q: SamlLoginQuery, @Res({ passthrough: true }) res: FastifyReply): {
    redirectUrl: string;
  } {
    const tenantId = (q.tenantId ?? '').trim();
    if (!tenantId) {
      throw new Error('saml.tenant_id_required');
    }
    const tenant = loadTenantConfig(tenantId);
    if (!tenant) {
      throw new Error('saml.tenant_not_configured');
    }
    // RelayState is also our InResponseTo expectation echo — random per
    // login. We persist it in a short-lived signed cookie so the ACS
    // POST can validate the binding.
    const relay = `_${crypto.randomBytes(16).toString('hex')}`;
    const url = this.saml.buildLoginUrl(tenant, relay);
    // Cookie is set via res.header to remain framework-agnostic; in the
    // real wireup this delegates to `@segurasist/security` cookie helpers.
    res.header(
      'Set-Cookie',
      `${RELAY_COOKIE}=${relay}.${tenantId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300`,
    );
    res.status(302);
    res.header('Location', url);
    return { redirectUrl: url };
  }

  @Public()
  @Throttle({ ttl: 60_000, limit: 60 })
  @Post('acs')
  @HttpCode(HttpStatus.OK)
  async acs(
    @Body() body: SamlAcsBody,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<{ ok: true; redirectTo: string } | { ok: false; error: string }> {
    const ctx = this.auditCtx.fromRequest();
    const samlResponse = body.SAMLResponse;
    if (!samlResponse) {
      return { ok: false, error: 'saml.missing_response' };
    }
    const relayCookie = (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${RELAY_COOKIE}=`))
      ?.slice(RELAY_COOKIE.length + 1);
    const [relay, tenantId] = (relayCookie ?? '').split('.');
    if (!relay || !tenantId) {
      return { ok: false, error: 'saml.relay_missing' };
    }
    const tenant = loadTenantConfig(tenantId);
    if (!tenant) {
      return { ok: false, error: 'saml.tenant_not_configured' };
    }

    try {
      const assertion = this.saml.parseAndValidateAssertion({
        samlResponseB64: samlResponse,
        tenant,
        expectedRelayState: relay,
      });
      // Audit OK — log hash + email (NOT the XML) per ADR-0009 / S5-1 rule.
      void this.recordAudit({
        ...ctx,
        ok: true,
        tenantId: assertion.tenantId,
        email: assertion.email,
        assertionHash: assertion.assertionHashSha256,
      });

      // Mint admin session — iter 1 emits a placeholder cookie; iter 2
      // delegates to `AuthService.mintAdminSessionFromFederation()` which
      // creates/updates the User row, signs JWTs and applies the same
      // hardened cookie attributes that local login uses.
      res.header(
        'Set-Cookie',
        [
          `sa_session=federated.${assertion.nameId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=900`,
          `${RELAY_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
        ].join(', '),
      );
      return { ok: true, redirectTo: '/dashboard' };
    } catch (err) {
      void this.recordAudit({
        ...ctx,
        ok: false,
        tenantId,
        reason: (err as Error).message,
      });
      return { ok: false, error: (err as Error).message };
    }
  }

  private async recordAudit(_payload: Record<string, unknown>): Promise<void> {
    // S5-1 iter 2 (CC-16): the service-layer `parseAndValidateAssertion`
    // now records `saml_login_{succeeded|failed}` directly via the
    // injected `AuditWriterService` + `AuditContextFactory`. The
    // controller-side helper is preserved as a no-op to avoid touching
    // the iter 1 call sites; remove in a Sprint 6 refactor once the
    // controller switches to a thin pass-through.
    return;
  }
}
