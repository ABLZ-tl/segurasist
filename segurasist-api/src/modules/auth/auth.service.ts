/**
 * AuthService — orquesta el login admin + el flujo OTP del portal asegurado.
 *
 * S3-01 — el flujo OTP está implementado completo:
 *
 *   POST /v1/auth/otp/request → `otpRequest()`
 *     1. Anti-enumeration: SIEMPRE devuelve 200 con un sessionId opaco. Si el
 *        CURP no existe, igual generamos un sessionId pero NO persistimos en
 *        Redis ni enviamos email — la respuesta es indistinguible para el
 *        atacante.
 *     2. Lockout por CURP: si el CURP acumuló N "rondas" de OTP_MAX_ATTEMPTS
 *        consecutivas, devolvemos 200 genérico pero NO emitimos código (silent
 *        block). El lockout dura `OTP_LOCKOUT_SECONDS`.
 *     3. Rate limit interno por CURP en Redis (5/min). Idéntico patrón al
 *        ThrottlerGuard pero con key=curp para que un atacante no pueda agotar
 *        el cupo de un CURP específico desde múltiples IPs.
 *     4. Genera código de 6 dígitos cripto-secure y lo persiste hasheado en
 *        Redis con TTL 5 minutos.
 *     5. Audit log `action='otp_requested', resourceType='auth'` (F6 iter 2).
 *
 *   POST /v1/auth/otp/verify → `otpVerify()`
 *     1. Lee la session de Redis. Si no existe → 401 ("Código expirado").
 *     2. Decrementa `attemptsLeft`. Si llega a 0 → invalida la session y
 *        cuenta una "ronda fallida" para el CURP (acumula hacia el lockout).
 *     3. Compara hash(code) timing-safe.
 *     4. Si match: borra la session, llama a Cognito para emitir tokens,
 *        audit log `action='otp_verified', resourceType='auth'` (F6 iter 2).
 *
 * Por qué Redis y NO una tabla SQL: el OTP es ephemero (5min), de muy alta
 * cardinalidad y nunca se consulta histórico. Redis con TTL nativo es el
 * fit perfecto y nos evita una migration. El audit log capta el evento.
 *
 * Por qué hash y NO el código en plain: defense-in-depth contra dump de
 * Redis. El hash usa `crypto.createHash('sha256')` con salt = sessionId
 * (único y de alta entropía).
 */
import * as crypto from 'node:crypto';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { CognitoService, AuthTokens } from '@infra/aws/cognito.service';
import { SesService } from '@infra/aws/ses.service';
import { RedisService } from '@infra/cache/redis.service';
import {
  Injectable,
  Logger,
  NotImplementedException,
  Optional,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { decodeJwt } from 'jose';
import type { AuditContext } from '../audit/audit-context.factory';
import { AuditWriterService } from '../audit/audit-writer.service';
import { EmailTemplateResolver } from '../email/email-template-resolver';
import { LoginDto, OtpRequestDto, OtpVerifyDto, RefreshDto } from './dto/auth.dto';
// `CurrentUser` import keeps tree-shaking happy and surfaces the type used in
// downstream controllers; not invoked here.
void CurrentUser;

/**
 * Shape persistido en Redis bajo `otp:{sessionId}`. JSON-serialized.
 * `codeHash` = sha256(salt=sessionId || ':' || code). El sessionId es de alta
 * entropía (32 bytes random) por lo que sirve como salt único por OTP.
 */
interface OtpSession {
  insuredId: string;
  tenantId: string;
  email: string;
  /** Lowercase hex sha256(sessionId + ':' + code). */
  codeHash: string;
  attemptsLeft: number;
  channel: 'email' | 'sms';
  /** Issued at, ISO. Útil para forensics (no enforced por código). */
  issuedAt: string;
}

/**
 * Respuesta del request OTP. La spec acepta `expiresIn` para que el FE
 * pueda mostrar el contador 5:00 sin tener que hardcodear el TTL.
 */
export interface OtpRequestResult {
  session: string;
  channel: 'email' | 'sms';
  expiresIn: number;
}

const OTP_KEY_PREFIX = 'otp:';
const CURP_RATELIMIT_PREFIX = 'otp:rl:curp:';
const SESSION_RATELIMIT_PREFIX = 'otp:rl:session:';
const CURP_LOCKOUT_PREFIX = 'otp:lock:curp:';
const CURP_FAILED_ROUNDS_PREFIX = 'otp:rounds:curp:';

/**
 * Cuántas "rondas" (cada una = OTP_MAX_ATTEMPTS fallos consecutivos) toleramos
 * antes de aplicar el lockout temporal por CURP. Con max=5 attempts/round y
 * MAX_ROUNDS=5, un atacante necesita 25 OTPs incorrectos seguidos antes del
 * silent block — más que suficiente para detectar el patrón en logs sin
 * castigar a un usuario distraído que se equivoca un par de veces.
 */
const MAX_FAILED_ROUNDS_BEFORE_LOCKOUT = 5;

/** Rate limit interno por CURP — 5 OTP requests por minuto. */
const CURP_REQUESTS_PER_MINUTE = 5;

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    private readonly cognito: CognitoService,
    private readonly redis: RedisService,
    private readonly ses: SesService,
    private readonly templates: EmailTemplateResolver,
    private readonly prismaBypass: PrismaBypassRlsService,
    @Optional() private readonly audit?: AuditWriterService,
  ) {}

  async login(dto: LoginDto): Promise<AuthTokens> {
    if ('email' in dto) {
      return this.cognito.loginAdmin(dto.email, dto.password);
    }
    throw new NotImplementedException('AuthService.login (curp flow) — use /otp/request');
  }

  /**
   * Genera y envía un OTP. Respeta:
   *   - anti-enumeration (siempre 200 + mensaje genérico vía controller).
   *   - rate limit por CURP (5/min) con Redis.
   *   - lockout temporal por CURP tras 5 rondas fallidas.
   *
   * `auditCtx` (F6 iter 2 H-01): contexto canónico {ip, userAgent, traceId}
   * derivado del request por `AuditContextFactory.fromRequest()`. Se propaga
   * al row de audit log para forensics ("OTP requested from IP X" queries).
   * Opcional para retrocompat con tests existentes que llaman sin ctx.
   */
  async otpRequest(dto: OtpRequestDto, auditCtx?: AuditContext): Promise<OtpRequestResult> {
    const curp = dto.curp.toUpperCase();
    const channel: 'email' | 'sms' = dto.channel ?? 'email';
    // El sessionId es opaco: 32 bytes hex (64 chars) — alta entropía, puede ir
    // en URL/QueryString sin problema. Lo generamos ANTES del lookup para
    // poder devolverlo aún cuando el CURP no exista (anti-enumeration).
    const session = crypto.randomBytes(32).toString('hex');

    // Rate limit interno por CURP (defense-in-depth además del global por IP).
    const overLimit = await this.checkCurpRateLimit(curp);
    if (overLimit) {
      this.log.warn({ curpHash: this.hashForLog(curp) }, 'OTP request rate limited by CURP');
      // Respuesta indistinguible: el atacante no debe poder mapear "200 sin
      // email enviado" vs "200 con email" para inferir nada del estado.
      return { session, channel, expiresIn: this.env.OTP_TTL_SECONDS };
    }

    // Lockout activo: silent block.
    const locked = await this.redis.get(`${CURP_LOCKOUT_PREFIX}${curp}`);
    if (locked) {
      this.log.warn({ curpHash: this.hashForLog(curp) }, 'OTP request blocked by CURP lockout');
      return { session, channel, expiresIn: this.env.OTP_TTL_SECONDS };
    }

    // Lookup cross-tenant del insured (la API pública NO conoce tenant). Usa
    // el cliente BYPASSRLS porque el endpoint es Public (sin auth) y necesita
    // leer cualquier insured para identificarlo por CURP.
    const insured = await this.findInsuredByCurp(curp);
    if (!insured) {
      // CURP desconocido: idéntica respuesta, sin email, sin Redis. Loguemos
      // en pino para observabilidad/threat hunting (NO en audit log porque
      // el insured no existe — no hay tenant válido).
      this.log.warn({ curpHash: this.hashForLog(curp) }, 'OTP requested for unknown CURP');
      return { session, channel, expiresIn: this.env.OTP_TTL_SECONDS };
    }

    if (!insured.email) {
      // Insured sin email registrado — no podemos enviar OTP. Mismo response.
      this.log.warn(
        { insuredId: insured.id, tenantId: insured.tenantId },
        'OTP requested for insured without email; cannot deliver',
      );
      return { session, channel, expiresIn: this.env.OTP_TTL_SECONDS };
    }

    // SMS no implementado: fallback a email + warning. Sprint 5 cablea Pinpoint.
    const effectiveChannel: 'email' | 'sms' = channel === 'sms' ? 'email' : channel;
    if (channel === 'sms') {
      this.log.warn({ insuredId: insured.id }, 'SMS not implemented in MVP, falling back to email channel');
    }

    // Genera código y lo persiste hasheado.
    const code = this.generateOtpCode();
    const codeHash = this.hashCode(session, code);
    const sessionData: OtpSession = {
      insuredId: insured.id,
      tenantId: insured.tenantId,
      email: insured.email,
      codeHash,
      attemptsLeft: this.env.OTP_MAX_ATTEMPTS,
      channel: effectiveChannel,
      issuedAt: new Date().toISOString(),
    };
    await this.redis.set(
      `${OTP_KEY_PREFIX}${session}`,
      JSON.stringify(sessionData),
      this.env.OTP_TTL_SECONDS,
    );

    // Renderiza y envía el email.
    try {
      const tpl = await this.templates.load('otp-code');
      const ctx = { code, insured: { fullName: insured.fullName } };
      const html = tpl.html(ctx);
      const text = tpl.text(ctx);
      await this.ses.send({
        to: insured.email,
        from: this.env.EMAIL_FROM_CERT,
        subject: 'Tu código de acceso a Mi Membresía MAC',
        html,
        text,
        tags: { kind: 'otp', insuredId: insured.id },
      });
    } catch (err) {
      // El email falló pero la session ya está en Redis. Loguemos warning;
      // el usuario igual puede pedir reenvío. NO borramos la session porque
      // si el email se entregó parcialmente, queremos que el usuario aún
      // pueda usarlo.
      this.log.error(
        { err: err instanceof Error ? err.message : String(err), insuredId: insured.id },
        'OTP email delivery failed',
      );
    }

    // Audit log (F6 iter 2 H-01): action='otp_requested' (enum extendido en
    // migration 20260428_audit_action_enum_extend). Antes usábamos
    // action='login' + resourceType='auth.otp.requested' (overload semántico
    // del enum) lo que rompía queries SQL eficientes por action. Ahora el
    // enum es first-class. ip/userAgent/traceId vienen del AuditContext que
    // el controller deriva via AuditContextFactory.fromRequest().
    if (this.audit) {
      void this.audit.record({
        tenantId: insured.tenantId,
        actorId: insured.id,
        action: 'otp_requested',
        resourceType: 'auth',
        resourceId: insured.id,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        traceId: auditCtx?.traceId,
        payloadDiff: { channel: effectiveChannel, sessionPrefix: session.slice(0, 8) },
      });
    }

    return { session, channel: effectiveChannel, expiresIn: this.env.OTP_TTL_SECONDS };
  }

  /**
   * Verifica el OTP. Retorna AuthTokens (idToken Cognito) en éxito; lanza
   * UnauthorizedException con mensaje accionable en error.
   *
   * Mensajes UX:
   *   - "Código expirado o inválido" — session inexistente (TTL vencido o nunca).
   *   - "Demasiados intentos. Solicita un nuevo código." — attempts agotados.
   *   - "Código incorrecto. Te quedan N intentos." — fallo con attempts > 0.
   *
   * `auditCtx` (F6 iter 2 H-01): contexto canónico desde `AuditContextFactory`
   * para que el row de audit `otp_verified` lleve ip/userAgent/traceId. Opcional
   * para retrocompat con specs.
   */
  async otpVerify(dto: OtpVerifyDto, auditCtx?: AuditContext): Promise<AuthTokens> {
    // Rate limit interno por session (defensa adicional al per-IP del decorator).
    const overSessionLimit = await this.checkSessionRateLimit(dto.session);
    if (overSessionLimit) {
      this.log.warn({ sessionPrefix: dto.session.slice(0, 8) }, 'OTP verify rate limited by session');
      throw new UnauthorizedException('Demasiados intentos en poco tiempo. Espera unos segundos.');
    }

    const raw = await this.redis.get(`${OTP_KEY_PREFIX}${dto.session}`);
    if (!raw) {
      throw new UnauthorizedException('Código expirado o inválido. Solicita uno nuevo.');
    }
    let parsed: OtpSession;
    try {
      parsed = JSON.parse(raw) as OtpSession;
    } catch {
      // Datos corruptos: borramos para no quedar ciclando.
      await this.redis.del(`${OTP_KEY_PREFIX}${dto.session}`);
      throw new UnauthorizedException('Código expirado o inválido. Solicita uno nuevo.');
    }

    // Comparación timing-safe del hash. Computamos hash(provided) y comparamos
    // con el persistido. `timingSafeEqual` requiere buffers del mismo length.
    const expected = Buffer.from(parsed.codeHash, 'hex');
    const provided = Buffer.from(this.hashCode(dto.session, dto.code), 'hex');
    const isMatch = expected.length === provided.length && crypto.timingSafeEqual(expected, provided);

    if (!isMatch) {
      const attemptsLeft = parsed.attemptsLeft - 1;
      if (attemptsLeft <= 0) {
        // Session quemada. Acumula una ronda fallida en el contador del CURP
        // (el lookup del CURP ya no es posible — el session ya no llevará el
        // CURP, así que usamos el insuredId para reverso → tenant + curp).
        await this.redis.del(`${OTP_KEY_PREFIX}${dto.session}`);
        await this.bumpFailedRoundsForInsured(parsed.insuredId, parsed.tenantId);
        throw new UnauthorizedException('Demasiados intentos. Solicita un nuevo código.');
      }
      // Persiste el decremento (mismo TTL restante: usamos el sessionData
      // intacto y dejamos que Redis preserve el TTL existente con KEEPTTL,
      // pero `RedisService.set` no expone el flag — re-set con TTL completo
      // sería un reset, así que persistimos el decremento sin tocar TTL via
      // un comando crudo).
      const updated: OtpSession = { ...parsed, attemptsLeft };
      await this.redis.raw.set(`${OTP_KEY_PREFIX}${dto.session}`, JSON.stringify(updated), 'KEEPTTL');
      throw new UnauthorizedException(
        `Código incorrecto. Te quedan ${attemptsLeft} ${attemptsLeft === 1 ? 'intento' : 'intentos'}.`,
      );
    }

    // Match: limpia la session ANTES de emitir el token (idempotencia: un
    // replay del mismo `code` sobre la misma `session` ya no encuentra nada).
    await this.redis.del(`${OTP_KEY_PREFIX}${dto.session}`);
    // Reset del contador de rondas: el insured volvió a autenticarse.
    await this.redis.del(`${CURP_FAILED_ROUNDS_PREFIX}${parsed.insuredId}`);

    // Emite tokens vía Cognito (insured pool).
    const tokens = await this.cognito.loginInsuredWithSystemPassword(
      parsed.email,
      this.env.INSURED_DEFAULT_PASSWORD,
    );

    // C-03 — persistir `insureds.cognito_sub` la primera vez que el insured
    // verifica OTP (o re-sincronizarlo si la pool insured fue rotada y el
    // sub cambió). Sin esto, todos los lookups posteriores de la API que
    // hacen `findFirst({ where: { cognitoSub } })` devolverían 404 al cerrar
    // C-02 — el portal queda funcionalmente roto post-fix de la cookie.
    //
    // Decodificamos el idToken (NO el access token: el sub vive en ambos
    // pero el idToken también lleva email/given_name si los necesitamos
    // luego). Como el token acaba de ser emitido por nuestro propio Cognito
    // pool y aún no atravesó la red pública, basta `decodeJwt` (read-only,
    // sin verificación de firma). El JwtAuthGuard sí verifica firma vía
    // JWKS en cada request subsiguiente — defense-in-depth.
    await this.persistCognitoSubFromTokens(parsed.insuredId, parsed.tenantId, tokens);

    // Audit log éxito (F6 iter 2 H-01): action='otp_verified' (enum extendido).
    // ip/userAgent/traceId provienen del AuditContext derivado por el
    // controller (AuditContextFactory.fromRequest()).
    if (this.audit) {
      void this.audit.record({
        tenantId: parsed.tenantId,
        actorId: parsed.insuredId,
        action: 'otp_verified',
        resourceType: 'auth',
        resourceId: parsed.insuredId,
        ip: auditCtx?.ip,
        userAgent: auditCtx?.userAgent,
        traceId: auditCtx?.traceId,
        payloadDiff: { channel: parsed.channel },
      });
    }

    return tokens;
  }

  /**
   * Decodifica el idToken (o accessToken como fallback) y persiste el `sub`
   * Cognito en `insureds.cognito_sub` si todavía no estaba o si cambió.
   *
   * Cualquier fallo aquí es WARNING, NO ERROR: el OTP ya fue exitoso y el
   * usuario tiene tokens válidos. Si la persistencia falla, el próximo login
   * la reintenta. Lo que NO podemos hacer es romper el flow happy path por
   * un upsert de claims.
   */
  private async persistCognitoSubFromTokens(
    insuredId: string,
    tenantId: string,
    tokens: AuthTokens,
  ): Promise<void> {
    try {
      const tokenForClaims = tokens.idToken ?? tokens.accessToken;
      if (!tokenForClaims) return;
      const claims = decodeJwt(tokenForClaims);
      const sub = typeof claims.sub === 'string' ? claims.sub : null;
      if (!sub) {
        this.log.warn({ insuredId, tenantId }, 'Cognito idToken sin claim `sub`; skip persistencia');
        return;
      }
      if (!this.prismaBypass.isEnabled()) {
        // Sin BYPASSRLS no hay forma de update sin tenant context. En dev
        // local con la env var, este path corre. En CI sin BYPASS los tests
        // de integración deben configurarla.
        return;
      }
      // `update().where` admite sólo campos `@unique` o el PK. Usamos `id`
      // (PK uuid). `tenantId` lo conservamos en logs/audit para trazabilidad
      // pero no participa del filtro porque la PK ya es globalmente única.
      // updateMany se descarta porque queremos el throw del UNIQUE conflict
      // en cognito_sub (ver catch debajo).
      await this.prismaBypass.client.insured.update({
        where: { id: insuredId },
        data: { cognitoSub: sub },
      });
    } catch (err) {
      // Conflict en `cognito_sub @unique` significa que ESE sub ya pertenece
      // a OTRO insured — escenario imposible en el modelo correcto pero
      // posible en dev tras reset de pool. Logueamos y NO escalamos.
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), insuredId, tenantId },
        'persistCognitoSubFromTokens fallo (no bloqueante; el OTP fue exitoso)',
      );
    }
  }

  async refresh(dto: RefreshDto): Promise<AuthTokens> {
    return this.cognito.refresh(dto.refreshToken);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) {
      await this.cognito.revoke(refreshToken);
    }
  }

  // ============================================================================
  // Helpers privados — extraídos para testability + lectura clara.
  // ============================================================================

  /**
   * 6 dígitos cripto-secure. `crypto.randomInt(min, max)` está disponible desde
   * Node 14.10 — distribución uniforme garantizada (a diferencia de
   * `Math.floor(Math.random() * 1e6)` que tiene sesgo).
   */
  private generateOtpCode(): string {
    const n = crypto.randomInt(0, 1_000_000);
    return n.toString().padStart(6, '0');
  }

  /** sha256 hex del par sessionId+code. El sessionId actúa como salt único. */
  private hashCode(sessionId: string, code: string): string {
    return crypto.createHash('sha256').update(`${sessionId}:${code}`).digest('hex');
  }

  /** Hash truncado para logs/observabilidad sin exponer el CURP. */
  private hashForLog(curp: string): string {
    return crypto.createHash('sha256').update(curp).digest('hex').slice(0, 12);
  }

  private async findInsuredByCurp(
    curp: string,
  ): Promise<{ id: string; tenantId: string; email: string | null; fullName: string } | null> {
    if (!this.prismaBypass.isEnabled()) {
      // Sin BYPASSRLS no podemos hacer cross-tenant lookup. En dev sin la env
      // var configurada, esto degrada a "CURP desconocido" (anti-enum).
      return null;
    }
    const row = await this.prismaBypass.client.insured.findFirst({
      where: { curp, deletedAt: null },
      select: { id: true, tenantId: true, email: true, fullName: true },
    });
    return row ?? null;
  }

  /**
   * Rate limit per CURP: 5 OTP/min. Bucket fijo en Redis con TTL = ventana.
   * Devuelve true si la cuota se excedió.
   */
  private async checkCurpRateLimit(curp: string): Promise<boolean> {
    const key = `${CURP_RATELIMIT_PREFIX}${curp}`;
    const count = await this.redis.raw.incr(key);
    if (count === 1) {
      // Primera vez en la ventana: setear expiración. Carrera benigna: si dos
      // requests entran en paralelo el segundo expire es no-op.
      await this.redis.raw.expire(key, 60);
    }
    return count > CURP_REQUESTS_PER_MINUTE;
  }

  /**
   * Rate limit per session en el verify: 5/min. Misma lógica que CURP. El
   * primer request crea la ventana de 60s.
   */
  private async checkSessionRateLimit(sessionId: string): Promise<boolean> {
    const key = `${SESSION_RATELIMIT_PREFIX}${sessionId}`;
    const count = await this.redis.raw.incr(key);
    if (count === 1) {
      await this.redis.raw.expire(key, 60);
    }
    return count > CURP_REQUESTS_PER_MINUTE;
  }

  /**
   * Cuando una session se quema por brute force, incrementamos un contador
   * persistente por insured. Cuando supera MAX_FAILED_ROUNDS, instalamos un
   * lockout sobre el CURP. Necesitamos resolver el CURP a partir del
   * insuredId (forward lookup vía Prisma).
   */
  private async bumpFailedRoundsForInsured(insuredId: string, tenantId: string): Promise<void> {
    const key = `${CURP_FAILED_ROUNDS_PREFIX}${insuredId}`;
    const rounds = await this.redis.raw.incr(key);
    // El contador se resetea cuando hay un OTP exitoso o tras un día.
    if (rounds === 1) {
      await this.redis.raw.expire(key, 86_400);
    }
    if (rounds >= MAX_FAILED_ROUNDS_BEFORE_LOCKOUT) {
      // Instalar lockout temporal sobre el CURP.
      if (!this.prismaBypass.isEnabled()) return;
      const insured = await this.prismaBypass.client.insured.findFirst({
        where: { id: insuredId, tenantId },
        select: { curp: true },
      });
      if (insured) {
        await this.redis.set(`${CURP_LOCKOUT_PREFIX}${insured.curp}`, '1', this.env.OTP_LOCKOUT_SECONDS);
        this.log.warn(
          { insuredId, tenantId, lockoutSeconds: this.env.OTP_LOCKOUT_SECONDS },
          'CURP lockout installed after repeated OTP brute force',
        );
      }
    }
  }
}
