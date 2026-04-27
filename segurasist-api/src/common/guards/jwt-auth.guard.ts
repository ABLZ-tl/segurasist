import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyRequest } from 'fastify';
import { JWTPayload, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AuthUser } from '../decorators/current-user.decorator';
import { PUBLIC_KEY } from '../decorators/roles.decorator';
import { TenantCtx } from '../decorators/tenant.decorator';
import { PrismaBypassRlsService } from '../prisma/prisma-bypass-rls.service';

interface CognitoClaims extends JWTPayload {
  sub: string;
  email?: string;
  'custom:tenant_id'?: string;
  'custom:role'?: string;
  scope?: string;
  /**
   * Cognito emite ambos token_use:
   *   - 'id'     → idToken (con custom:* claims, audience = client_id en `aud`)
   *   - 'access' → accessToken (sin custom:* claims, sin `aud` por defecto;
   *                 trae `client_id` separado).
   *
   * El API se autentica usando el **idToken** (es lo que `AuthController.login`
   * devuelve y lo que `AuthController.me` consume) — los custom claims
   * (`custom:tenant_id`, `custom:role`) sólo viven ahí.
   */
  token_use?: 'access' | 'id';
  client_id?: string;
  /**
   * MFA assurance. Cognito emite `amr: ['pwd', 'mfa', ...]` cuando el flow MFA
   * fue completado (e.g. SMS/TOTP). En cognito-local este claim NO se emite,
   * por eso el modo `'log'` es default fuera de producción.
   * Fallback alternativo: `cognito:mfa_enabled` boolean (claim "Number" en
   * algunos entornos managed). Aceptamos ambos.
   */
  amr?: string[];
  'cognito:mfa_enabled'?: boolean;
}

export type MfaEnforcement = 'strict' | 'log' | 'off';

/** Roles para los que la política MFA aplica (admin pool). */
const MFA_REQUIRED_ROLES = new Set(['admin_segurasist', 'admin_mac']);

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * S3-08 — Marker request-scoped que el `JwtAuthGuard` setea cuando un superadmin
 * envía `X-Tenant-Override: <tenantId>` válido. Lo consumen el
 * `AuditInterceptor` (para enriquecer el payload con `_overrideTenant` /
 * `_overriddenBy`) y un `TenantOverrideAuditInterceptor` que persiste el evento
 * `tenant.override.used` también en GETs (los reads no caen en la lógica
 * estándar de mutación-only del audit interceptor).
 */
export interface TenantOverrideCtx {
  active: true;
  overrideTenant: string;
}

export type AuthPool = 'admin' | 'insured';

/**
 * Pool a la que pertenece el token validado. Se inyecta en `request.user.pool`
 * (defensa en profundidad para el `RolesGuard`: un token con
 * `custom:role=admin_segurasist` pero `aud=COGNITO_CLIENT_ID_INSURED` queda
 * marcado como `pool=insured` y los downstream guards rechazan el escalamiento.
 */
export interface PoolVerified {
  claims: CognitoClaims;
  pool: AuthPool;
}

// Cache de JWKS por user-pool (24h con stale-while-revalidate, gestionado por jose).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly jwks: JWTVerifyGetKey;
  private readonly issuer: string;
  private readonly insuredIssuer: string;
  private readonly insuredJwks: JWTVerifyGetKey;
  private readonly adminClientId: string;
  private readonly insuredClientId: string;
  private readonly mfaEnforcement: MfaEnforcement;

  constructor(
    @Inject(ENV_TOKEN) env: Env,
    private readonly reflector: Reflector,
    /**
     * S3-08 — Inyectado para validar `X-Tenant-Override` contra el catálogo
     * `tenants` (BYPASSRLS). Se marca `@Optional()` para no romper unit tests
     * que instancian el guard con `new JwtAuthGuard(env, reflector)` sin
     * `PrismaBypassRlsService`. En esos casos, si llega un override sin el
     * service configurado, el guard devuelve 503 (defensa en profundidad).
     */
    @Optional() private readonly prismaBypass?: PrismaBypassRlsService,
  ) {
    // En dev local con cognito-local: COGNITO_ENDPOINT=http://localhost:9229
    // → issuer http://localhost:9229/<pool_id>, JWKS http://localhost:9229/<pool_id>/.well-known/jwks.json.
    // En prod: ausente → issuer https://cognito-idp.<region>.amazonaws.com/<pool_id>.
    // M4: el env schema valida que en NODE_ENV=production COGNITO_ENDPOINT
    // (si está) DEBE apuntar a `cognito-idp.<region>.amazonaws.com`.
    const base = env.COGNITO_ENDPOINT
      ? env.COGNITO_ENDPOINT.replace(/\/$/, '')
      : `https://cognito-idp.${env.COGNITO_REGION}.amazonaws.com`;
    this.issuer = `${base}/${env.COGNITO_USER_POOL_ID_ADMIN}`;
    this.insuredIssuer = `${base}/${env.COGNITO_USER_POOL_ID_INSURED}`;
    this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
      cacheMaxAge: 24 * 60 * 60 * 1000,
      cooldownDuration: 30_000,
    });
    this.insuredJwks = createRemoteJWKSet(new URL(`${this.insuredIssuer}/.well-known/jwks.json`), {
      cacheMaxAge: 24 * 60 * 60 * 1000,
      cooldownDuration: 30_000,
    });
    this.adminClientId = env.COGNITO_CLIENT_ID_ADMIN;
    this.insuredClientId = env.COGNITO_CLIENT_ID_INSURED;
    this.mfaEnforcement = resolveMfaEnforcement(env);
    if (this.mfaEnforcement === 'off') {
      this.logger.warn(
        'MFA_ENFORCEMENT=off: enforcement de MFA deshabilitado para roles admin (escape hatch).',
      );
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<
      FastifyRequest & {
        user?: AuthUser;
        tenant?: TenantCtx;
        bypassRls?: boolean;
        tenantOverride?: TenantOverrideCtx;
      }
    >();
    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = auth.slice(7).trim();

    const { claims, pool } = await this.verifyAgainstAnyPool(token);

    // Validamos token_use=id: el API consume idToken (custom:* claims sólo
    // viven ahí). Si por error usamos un access token, lo rechazamos en lugar
    // de fallar más tarde por falta de custom:tenant_id.
    if (claims.token_use !== undefined && claims.token_use !== 'id') {
      throw new UnauthorizedException('Token inválido: se esperaba id_token');
    }

    const role = claims['custom:role'] ?? 'insured';
    const scopes = typeof claims.scope === 'string' && claims.scope.length > 0 ? claims.scope.split(' ') : [];
    const tenantId = claims['custom:tenant_id'];

    // MFA enforcement — solo aplica a admins (admin_segurasist/admin_mac).
    // Operator/supervisor/insured: bypass (insured tiene OTP de email separado;
    // operator/supervisor recomendado pero no enforced en MVP).
    const mfaVerified = this.detectMfa(claims);
    if (MFA_REQUIRED_ROLES.has(role) && pool === 'admin' && !mfaVerified) {
      const traceId = (req.id as string | undefined) ?? undefined;
      if (this.mfaEnforcement === 'strict') {
        this.logger.warn({ traceId, role, sub: claims.sub }, 'MFA missing for admin role (strict)');
        throw new ForbiddenException('MFA required for admin role');
      }
      if (this.mfaEnforcement === 'log') {
        this.logger.warn({ traceId, role, sub: claims.sub }, 'admin sin amr=mfa');
      }
      // 'off' → silencio (init log ya marcó el escape hatch).
    }

    // M2 — Branch superadmin: cross-tenant. NO se setea app.current_tenant
    // (el RLS bypass se hace al nivel de rol DB, ver PrismaBypassRlsService).
    // Defensa en profundidad: el rol superadmin SÓLO se acepta si el token
    // viene del pool admin. Un token de insured con custom:role=admin_segurasist
    // queda con pool=insured y este branch no se ejecuta.
    if (role === 'admin_segurasist' && pool === 'admin') {
      req.user = {
        id: claims.sub,
        cognitoSub: claims.sub,
        email: claims.email ?? '',
        role,
        scopes,
        mfaEnrolled: true,
        mfaVerified,
        pool,
        // Flag explícito que los controllers usan para decidir bypass vs RLS.
        // Equivalente a req.bypassRls (ya seteado abajo) pero accesible desde
        // `@CurrentUser()` sin tener que inyectar `@Req()`.
        platformAdmin: true,
      };
      // No tenant context: superadmin lee con PrismaBypassRlsService (BYPASSRLS).
      req.bypassRls = true;
      // No seteamos req.tenant — los handlers que necesiten un tenant fallan
      // explícitamente con "Tenant decorator used without JwtAuthGuard" o por
      // el assertTenant del PrismaService normal (segurasist_app NOBYPASSRLS),
      // que es la defensa en profundidad esperada.

      // S3-08 — Branch tenant-override: SÓLO admin_segurasist puede usar
      // `X-Tenant-Override`. Cualquier otro rol que envíe el header recibe 403
      // (ver bloque debajo). Cuando es válido: req.tenant pasa a ser el
      // override Y bajamos bypassRls a false para que las RLS apliquen al
      // tenant impersonado (el superadmin opera EN nombre del tenant, no como
      // root). Defense in depth: dos capas (header check + RLS).
      await this.applyTenantOverride(req);
      return true;
    }

    // Resto de roles: tenant context obligatorio.
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ForbiddenException('Token sin custom:tenant_id');
    }

    req.user = {
      id: claims.sub,
      cognitoSub: claims.sub,
      email: claims.email ?? '',
      role,
      scopes,
      mfaEnrolled: true,
      mfaVerified,
      pool,
    };
    req.tenant = { id: tenantId };

    // S3-08 — Cualquier rol distinto de admin_segurasist que envíe el header
    // X-Tenant-Override es un intento de privilege escalation: 403 + log.
    const overrideAttempt = this.readOverrideHeader(req);
    if (overrideAttempt !== null) {
      this.logger.warn(
        {
          actorId: claims.sub,
          role,
          pool,
          attempted: overrideAttempt,
          ip: (req.ip || '').toString() || undefined,
          userAgent: req.headers['user-agent'] ?? undefined,
          traceId: (req.id as string | undefined) ?? undefined,
          requestPath: req.url,
        },
        'Tenant override attempt denied (rol no autorizado)',
      );
      throw new ForbiddenException('Tenant override no permitido');
    }

    return true;
  }

  /**
   * Lee y normaliza el header `X-Tenant-Override`. Devuelve `null` si está
   * ausente o vacío. Acepta `string` y `string[]` (Fastify normaliza repetidos).
   * Si llega como array y no todos los valores coinciden, devuelve el primero
   * (el guard validará después que sea UUID + tenant existente).
   */
  private readOverrideHeader(req: FastifyRequest): string | null {
    const raw = req.headers['x-tenant-override'];
    if (raw === undefined || raw === null) return null;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (Array.isArray(raw)) {
      const first = raw[0];
      if (typeof first === 'string') {
        const trimmed = first.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
    }
    return null;
  }

  /**
   * Aplica el override de tenant para superadmin. Validaciones (en orden):
   *  1. Header con formato UUID (sino: 403 — evita filtración via timing).
   *  2. PrismaBypassRlsService disponible (sino: 503/Forbidden con mensaje
   *     claro — el guard NO debe abrir el path sin la capa de validación).
   *  3. Tenant existe (sino: 404 explícito; nunca 400/403 — antiguamente
   *     filtraba info de qué tenants existen).
   *  4. Tenant activo (sino: 403 — evita operar sobre tenants suspendidos).
   *
   * Side effects en req:
   *  - req.tenant = { id: overrideTenant }
   *  - req.bypassRls = false   (CRÍTICO: bajamos bypass para que RLS aplique)
   *  - req.tenantOverride = { active: true, overrideTenant }
   */
  private async applyTenantOverride(
    req: FastifyRequest & {
      user?: AuthUser;
      tenant?: TenantCtx;
      bypassRls?: boolean;
      tenantOverride?: TenantOverrideCtx;
    },
  ): Promise<void> {
    const overrideTenant = this.readOverrideHeader(req);
    if (overrideTenant === null) return;

    if (!UUID_RE.test(overrideTenant)) {
      // Formato inválido → 403 (NO 404: 404 implicaría que el lookup ocurrió
      // y filtraría que el formato es válido pero no existe).
      throw new ForbiddenException('Tenant override formato inválido');
    }

    if (!this.prismaBypass) {
      // Defense in depth: si el guard no fue inicializado con el bypass
      // service no podemos validar el tenant. Antes de abrir el path en
      // ciego, fallamos cerrado.
      throw new ForbiddenException('Tenant override deshabilitado: bypass service no disponible');
    }

    let row: { id: string; status: string } | null;
    try {
      row = await this.prismaBypass.client.tenant.findUnique({
        where: { id: overrideTenant },
        select: { id: true, status: true },
      });
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), overrideTenant },
        'Tenant override lookup falló',
      );
      throw new ForbiddenException('Tenant override no validable');
    }

    if (!row) {
      throw new NotFoundException(`Tenant override no encontrado: ${overrideTenant}`);
    }
    if (row.status !== 'active') {
      throw new ForbiddenException('Tenant override está inactivo');
    }

    // Aplicar el override: req.tenant pasa a ser el override Y bajamos bypass
    // para que RLS aplique al tenant impersonado.
    req.tenant = { id: overrideTenant };
    req.bypassRls = false;
    req.tenantOverride = { active: true, overrideTenant };
    if (req.user) {
      // Aún cross-tenant: el actor sigue siendo platformAdmin (las queries
      // siguen pudiendo necesitar el cliente bypass para writes en audit_log).
      // Pero el tenant CONTEXT pasa a ser el override.
      req.user.platformAdmin = true;
    }
    this.logger.log(
      {
        actorId: req.user?.id,
        overrideTenant,
        traceId: (req.id as string | undefined) ?? undefined,
        requestPath: req.url,
      },
      'Tenant override applied',
    );
  }

  /**
   * MFA detection helper. Acepta dos shapes (Cognito real vs cognito-local):
   *  - `amr: string[]` con `'mfa'` presente (lo que Cognito emite tras MFA).
   *  - `cognito:mfa_enabled: true` boolean (alternativa managed).
   * No lee otros heuristics (e.g. `event_id`) — ambiguos.
   */
  private detectMfa(claims: CognitoClaims): boolean {
    if (Array.isArray(claims.amr) && claims.amr.includes('mfa')) return true;
    if (claims['cognito:mfa_enabled'] === true) return true;
    return false;
  }

  /**
   * Pool-aware: tras verificar la firma contra un pool, comprobamos que el
   * `aud` del token matchee el client_id de ese pool. Sin esta validación,
   * si por config error las pools comparten signing keys (rotaciones,
   * mis-import de JWKS, etc) un token de insured podría pasar como admin
   * (privilege escalation latente).
   */
  private async verifyAgainstAnyPool(token: string): Promise<PoolVerified> {
    // Intento 1: pool admin.
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.issuer });
      const claims = payload as CognitoClaims;
      const aud = this.extractAud(claims);
      if (aud === this.adminClientId) {
        return { claims, pool: 'admin' };
      }
      if (aud === this.insuredClientId) {
        // El issuer dice admin pero la audience es la del pool insured →
        // configuración incoherente; lo tratamos como insured (NUNCA escalamos).
        return { claims, pool: 'insured' };
      }
      // Audience desconocida — no podemos atribuir el token a ninguna pool.
      throw new UnauthorizedException('AUTH_INVALID_TOKEN: audience desconocida');
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      // Cae al pool insured.
    }

    // Intento 2: pool insured.
    try {
      const { payload } = await jwtVerify(token, this.insuredJwks, { issuer: this.insuredIssuer });
      const claims = payload as CognitoClaims;
      const aud = this.extractAud(claims);
      if (aud === this.insuredClientId) {
        return { claims, pool: 'insured' };
      }
      if (aud === this.adminClientId) {
        // Idéntico al caso anterior: config incoherente → tratamos como insured.
        return { claims, pool: 'insured' };
      }
      throw new UnauthorizedException('AUTH_INVALID_TOKEN: audience desconocida');
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;
      throw new UnauthorizedException(
        err instanceof Error ? `Invalid token: ${err.message}` : 'Invalid token',
      );
    }
  }

  /**
   * `aud` puede ser string o string[]. Cognito idTokens lo emiten como string,
   * pero defendemos contra el caso array para no fallar en upgrades futuros.
   * Si es array, requerimos que TODAS las entradas matcheen el mismo client
   * (ningún token mixto admin+insured pasa).
   */
  private extractAud(claims: CognitoClaims): string | undefined {
    const aud = claims.aud;
    if (typeof aud === 'string') return aud;
    if (Array.isArray(aud)) {
      if (aud.length === 1) return aud[0];
      // Token mixto: rechazamos. Devolvemos undefined para que el caller emita 401.
      return undefined;
    }
    return undefined;
  }
}

/**
 * Resuelve el modo de enforcement MFA. El env explícito siempre gana; en su
 * ausencia: `'strict'` en producción, `'log'` en development/test/staging.
 * Justificación: cognito-local NO emite `amr` claim, así que en dev/test
 * no podemos enforcar `'strict'` sin romper auth real local.
 */
export function resolveMfaEnforcement(env: Pick<Env, 'NODE_ENV' | 'MFA_ENFORCEMENT'>): MfaEnforcement {
  if (env.MFA_ENFORCEMENT) return env.MFA_ENFORCEMENT;
  return env.NODE_ENV === 'production' ? 'strict' : 'log';
}
