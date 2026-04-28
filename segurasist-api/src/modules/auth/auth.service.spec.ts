import * as crypto from 'node:crypto';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { ENV_TOKEN } from '@config/config.module';
import type { Env } from '@config/env.schema';
import { CognitoService, type AuthTokens } from '@infra/aws/cognito.service';
import { SesService } from '@infra/aws/ses.service';
import { RedisService } from '@infra/cache/redis.service';
import { AuditWriterService } from '@modules/audit/audit-writer.service';
import { EmailTemplateResolver } from '@modules/email/email-template-resolver';
import { NotImplementedException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mock, type MockProxy } from 'jest-mock-extended';
import { AuthService } from './auth.service';
import type { OtpRequestDto } from './dto/auth.dto';

/**
 * Builders de mocks reutilizados entre describe-blocks. La factoría asegura
 * que cada test arranque con un grafo limpio (los counters de rate-limit no
 * se filtran entre tests, las plantillas mock devuelven contenido determinista,
 * etc.). H-09 cierre — el `describe.skip` previo dejaba los flows OTP sin
 * cobertura unitaria; los tests integration `otp-flow.spec.ts` cubren C-03
 * (cognito_sub persist) pero no el árbol de decisiones del request/verify.
 */
function buildJwt(payload: Record<string, unknown>): string {
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url('fake-signature');
  return `${header}.${body}.${sig}`;
}

interface MockedRedis {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  raw: {
    incr: jest.Mock;
    expire: jest.Mock;
    get: jest.Mock;
    set: jest.Mock;
    del: jest.Mock;
    ttl: jest.Mock;
  };
}

function buildRedisMock(): MockedRedis {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    raw: {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(60),
    },
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let cognito: MockProxy<CognitoService>;

  const tokens: AuthTokens = {
    accessToken: 'access-x',
    refreshToken: 'refresh-x',
    idToken: 'id-x',
    expiresIn: 3600,
  };

  beforeEach(async () => {
    cognito = mock<CognitoService>();
    const env = {
      OTP_TTL_SECONDS: 300,
      OTP_MAX_ATTEMPTS: 5,
      OTP_LOCKOUT_SECONDS: 900,
    } as unknown as Env;
    // RedisService usa `redis.raw.incr/expire/get/set`; mockeamos esos
    // métodos retornando contadores que satisfacen rate-limit checks (1 = primera
    // vez en ventana → permitido).
    // RedisService expone DOS APIs: la wrapper de alto nivel (redis.get/set/del)
    // y el cliente raw ioredis (redis.raw.incr/expire/get/set/...). Ambas se
    // usan en AuthService según el caso (rate limit usa raw para INCR atómico).
    const redisMock = buildRedisMock() as unknown as RedisService;
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: ENV_TOKEN, useValue: env },
        { provide: CognitoService, useValue: cognito },
        { provide: RedisService, useValue: redisMock },
        { provide: SesService, useValue: mock<SesService>() },
        { provide: EmailTemplateResolver, useValue: mock<EmailTemplateResolver>() },
        { provide: PrismaBypassRlsService, useValue: mock<PrismaBypassRlsService>() },
        { provide: AuditWriterService, useValue: mock<AuditWriterService>() },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  describe('login()', () => {
    it('delega al adminFlow cuando dto trae email/password', async () => {
      cognito.loginAdmin.mockResolvedValue(tokens);
      const result = await service.login({ email: 'a@b.c', password: 'pwd12345' });
      expect(cognito.loginAdmin).toHaveBeenCalledWith('a@b.c', 'pwd12345');
      expect(cognito.loginAdmin).toHaveBeenCalledTimes(1);
      expect(result).toBe(tokens);
    });

    it('lanza NotImplementedException si dto trae curp (insured flow no implementado vía login)', async () => {
      // El union schema permite curp; login debe redirigir a /otp/request.
      await expect(service.login({ curp: 'AAAA000101HDFXYZ01' } as never)).rejects.toThrow(
        NotImplementedException,
      );
      expect(cognito.loginAdmin).not.toHaveBeenCalled();
    });

    it('propaga errores upstream del CognitoService', async () => {
      cognito.loginAdmin.mockRejectedValue(new Error('upstream down'));
      await expect(service.login({ email: 'a@b.c', password: 'pwd12345' })).rejects.toThrow('upstream down');
    });
  });

  // ============================================================================
  // H-09 — OTP unit suite (S9 Sprint 4 hardening). El describe.skip previo
  // referenciaba un test/integration/otp-flow.spec.ts ahora existente (cubre
  // C-03) pero el flow OTP per se requiere unit coverage del árbol de
  // decisiones: rate-limit, lockout, anti-enumeration, mismatch, expiry,
  // attempts depletion, throttle de session.
  // ============================================================================

  describe('otpRequest() / otpVerify() — H-09 unit coverage', () => {
    const CURP = 'HEGM900101HDFRRR01';
    const SESSION_ID = 'a'.repeat(64);
    const VALID_CODE = '654321';
    const INSURED_ID = '00000000-0000-0000-0000-0000000000aa';
    const TENANT_ID = '00000000-0000-0000-0000-0000000000bb';
    const COGNITO_SUB = 'cog-sub-deadbeef-0001';

    let prismaBypass: MockProxy<PrismaBypassRlsService>;
    let ses: MockProxy<SesService>;
    let templates: MockProxy<EmailTemplateResolver>;
    let audit: MockProxy<AuditWriterService>;
    let redisMock: MockedRedis;
    let insuredFindFirst: jest.Mock;
    let insuredUpdate: jest.Mock;

    /**
     * Construye un service nuevo por test con el `prismaBypass.client.insured`
     * cableado para que los flows OTP encuentren al asegurado.
     */
    async function buildService(
      opts: {
        insured?: {
          id: string;
          tenantId: string;
          email: string | null;
          fullName: string;
          curp?: string;
        } | null;
        bypassEnabled?: boolean;
      } = {},
    ) {
      const insured =
        opts.insured === undefined
          ? {
              id: INSURED_ID,
              tenantId: TENANT_ID,
              email: 'maria@example.test',
              fullName: 'María H.',
              curp: CURP,
            }
          : opts.insured;

      cognito = mock<CognitoService>();
      cognito.loginInsuredWithSystemPassword.mockResolvedValue({
        ...tokens,
        idToken: buildJwt({ sub: COGNITO_SUB, token_use: 'id' }),
        accessToken: buildJwt({ sub: COGNITO_SUB, token_use: 'access' }),
      });
      prismaBypass = mock<PrismaBypassRlsService>();
      prismaBypass.isEnabled.mockReturnValue(opts.bypassEnabled ?? true);
      insuredFindFirst = jest.fn().mockResolvedValue(insured);
      insuredUpdate = jest.fn().mockResolvedValue({ id: insured?.id, cognitoSub: COGNITO_SUB });
      Object.defineProperty(prismaBypass, 'client', {
        get: () =>
          ({
            insured: { findFirst: insuredFindFirst, update: insuredUpdate },
          }) as unknown as PrismaBypassRlsService['client'],
      });
      ses = mock<SesService>();
      ses.send.mockResolvedValue(undefined as never);
      templates = mock<EmailTemplateResolver>();
      templates.load.mockResolvedValue({
        html: ((ctx: Record<string, unknown>) => `<b>${(ctx as { code: string }).code}</b>`) as never,
        text: ((ctx: Record<string, unknown>) => `code:${(ctx as { code: string }).code}`) as never,
      } as never);
      audit = mock<AuditWriterService>();
      audit.record.mockResolvedValue(undefined as never);
      redisMock = buildRedisMock();

      const env = {
        OTP_TTL_SECONDS: 300,
        OTP_MAX_ATTEMPTS: 3,
        OTP_LOCKOUT_SECONDS: 900,
        INSURED_DEFAULT_PASSWORD: 'Demo123!',
        EMAIL_FROM_CERT: 'no-reply@example.test',
      } as unknown as Env;

      const moduleRef = await Test.createTestingModule({
        providers: [
          AuthService,
          { provide: ENV_TOKEN, useValue: env },
          { provide: CognitoService, useValue: cognito },
          { provide: RedisService, useValue: redisMock as unknown as RedisService },
          { provide: SesService, useValue: ses },
          { provide: EmailTemplateResolver, useValue: templates },
          { provide: PrismaBypassRlsService, useValue: prismaBypass },
          { provide: AuditWriterService, useValue: audit },
        ],
      }).compile();
      service = moduleRef.get(AuthService);
    }

    /** Carga una sesión OTP ya emitida en el "Redis" mock para tests de verify. */
    function preloadSession(opts: { code?: string; attemptsLeft?: number; channel?: 'email' | 'sms' } = {}) {
      const code = opts.code ?? VALID_CODE;
      const codeHash = crypto.createHash('sha256').update(`${SESSION_ID}:${code}`).digest('hex');
      const session = {
        insuredId: INSURED_ID,
        tenantId: TENANT_ID,
        email: 'maria@example.test',
        codeHash,
        attemptsLeft: opts.attemptsLeft ?? 3,
        channel: opts.channel ?? ('email' as const),
        issuedAt: new Date().toISOString(),
      };
      redisMock.get.mockResolvedValue(JSON.stringify(session));
    }

    // ----- otpRequest() ----- //

    describe('otpRequest()', () => {
      it('happy path: persiste sesión en Redis, envía email y registra audit `otp_requested`', async () => {
        await buildService();
        const result = await service.otpRequest(
          { curp: CURP, channel: 'email' },
          { ip: '10.0.0.5', userAgent: 'jest', traceId: 'tr-1' },
        );
        expect(result.session).toMatch(/^[a-f0-9]{64}$/);
        expect(result.channel).toBe('email');
        expect(result.expiresIn).toBe(300);
        // Redis: rate-limit incr + lockout get + persistir sesión.
        expect(redisMock.raw.incr).toHaveBeenCalled();
        expect(redisMock.set).toHaveBeenCalledWith(expect.stringContaining('otp:'), expect.any(String), 300);
        // Email enviado con tags + from configurado.
        expect(ses.send).toHaveBeenCalledTimes(1);
        const sendArgs = ses.send.mock.calls[0]![0] as unknown as Record<string, unknown>;
        expect(sendArgs.to).toBe('maria@example.test');
        expect(sendArgs.from).toBe('no-reply@example.test');
        expect(sendArgs.tags).toMatchObject({ kind: 'otp', insuredId: INSURED_ID });
        // Audit log con ctx canónico (forensics).
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'otp_requested',
            resourceType: 'auth',
            ip: '10.0.0.5',
            userAgent: 'jest',
            traceId: 'tr-1',
            tenantId: TENANT_ID,
          }),
        );
      });

      it('anti-enumeration: CURP desconocido devuelve 200 idempotente, sin Redis ni email', async () => {
        await buildService({ insured: null });
        const result = await service.otpRequest({ curp: CURP, channel: 'email' });
        expect(result.session).toMatch(/^[a-f0-9]{64}$/);
        expect(redisMock.set).not.toHaveBeenCalledWith(
          expect.stringContaining('otp:'),
          expect.any(String),
          expect.any(Number),
        );
        expect(ses.send).not.toHaveBeenCalled();
        // Sin tenant válido, no hay audit log (intencional — defense-in-depth).
        expect(audit.record).not.toHaveBeenCalled();
      });

      it('anti-enumeration: insured sin email NO envía y NO persiste sesión', async () => {
        await buildService({
          insured: {
            id: INSURED_ID,
            tenantId: TENANT_ID,
            email: null,
            fullName: 'Sin email',
          },
        });
        const result = await service.otpRequest({ curp: CURP, channel: 'email' });
        expect(result.session).toHaveLength(64);
        expect(ses.send).not.toHaveBeenCalled();
        expect(redisMock.set).not.toHaveBeenCalledWith(
          expect.stringContaining('otp:'),
          expect.any(String),
          expect.any(Number),
        );
      });

      it('throttle: al exceder 5 OTP/min por CURP, response 200 mock pero NO persiste ni envía', async () => {
        await buildService();
        // Forzar el incr a devolver >5 (bucket saturado).
        redisMock.raw.incr.mockResolvedValueOnce(6);
        const result = await service.otpRequest({ curp: CURP, channel: 'email' });
        expect(result.session).toHaveLength(64);
        expect(ses.send).not.toHaveBeenCalled();
        // Importante: la respuesta es indistinguible del happy path para
        // el atacante (mismo shape, sessionId opaco).
      });

      it('lockout activo: silent block si `otp:lock:curp:<CURP>` está seteado', async () => {
        await buildService();
        redisMock.get.mockResolvedValueOnce('1'); // lockout key existe
        const result = await service.otpRequest({ curp: CURP, channel: 'email' });
        expect(result.session).toHaveLength(64);
        expect(ses.send).not.toHaveBeenCalled();
        // findInsuredByCurp NO se llama porque el lockout corta antes (defensa).
        expect(insuredFindFirst).not.toHaveBeenCalled();
      });

      it('canal SMS: fallback a email + warning (Pinpoint sin cablear en MVP)', async () => {
        await buildService();
        const result = await service.otpRequest({ curp: CURP, channel: 'sms' });
        expect(result.channel).toBe('email');
        expect(ses.send).toHaveBeenCalledTimes(1);
      });

      it('email failure: la sesión queda persistida (best-effort delivery), result coherente', async () => {
        await buildService();
        ses.send.mockRejectedValueOnce(new Error('SES down'));
        const result = await service.otpRequest({ curp: CURP, channel: 'email' });
        expect(result.session).toHaveLength(64);
        // Sesión OTP fue persistida ANTES del send (aunque el send falle,
        // permitimos al usuario reintentar).
        expect(redisMock.set).toHaveBeenCalledWith(expect.stringContaining('otp:'), expect.any(String), 300);
      });

      it('CURP normalization: lowercase input se persiste/lookup uppercase', async () => {
        await buildService();
        await service.otpRequest({ curp: CURP.toLowerCase(), channel: 'email' } as OtpRequestDto);
        const findArgs = insuredFindFirst.mock.calls[0]?.[0] as { where: { curp: string } } | undefined;
        expect(findArgs?.where.curp).toBe(CURP);
      });
    });

    // ----- otpVerify() ----- //

    describe('otpVerify()', () => {
      it('happy path: code correcto → emite tokens, limpia sesión, persiste cognitoSub, audit `otp_verified`', async () => {
        await buildService();
        preloadSession();
        const result = await service.otpVerify(
          { session: SESSION_ID, code: VALID_CODE },
          { ip: '10.0.0.5', userAgent: 'jest', traceId: 'tr-2' },
        );
        expect(result.idToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
        // Sesión y rondas reseteadas.
        expect(redisMock.del).toHaveBeenCalledWith(`otp:${SESSION_ID}`);
        expect(redisMock.del).toHaveBeenCalledWith(`otp:rounds:curp:${INSURED_ID}`);
        // cognitoSub persistido (cubre C-03 path; aquí solo verificamos hand-off).
        expect(insuredUpdate).toHaveBeenCalledWith({
          where: { id: INSURED_ID },
          data: { cognitoSub: COGNITO_SUB },
        });
        // Audit con ctx canónico.
        expect(audit.record).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'otp_verified',
            tenantId: TENANT_ID,
            ip: '10.0.0.5',
            traceId: 'tr-2',
          }),
        );
      });

      it('OTP expirado / sesión inexistente → 401 con mensaje accionable', async () => {
        await buildService();
        redisMock.get.mockResolvedValueOnce(null);
        await expect(service.otpVerify({ session: SESSION_ID, code: VALID_CODE })).rejects.toThrow(
          UnauthorizedException,
        );
        await expect(service.otpVerify({ session: SESSION_ID, code: VALID_CODE })).rejects.toThrow(
          /Código expirado o inválido/,
        );
        // Cognito NO se llama → no se emiten tokens en path expirado.
        expect(cognito.loginInsuredWithSystemPassword).not.toHaveBeenCalled();
      });

      it('OTP inválido con attempts restantes → 401 informativo + decrement KEEPTTL', async () => {
        await buildService();
        preloadSession({ attemptsLeft: 3 });
        await expect(service.otpVerify({ session: SESSION_ID, code: '000000' })).rejects.toThrow(
          /Te quedan 2 intentos/,
        );
        // El decrement persiste con KEEPTTL (no resetea TTL existente).
        expect(redisMock.raw.set).toHaveBeenCalledWith(`otp:${SESSION_ID}`, expect.any(String), 'KEEPTTL');
        // Sesión NO borrada — el usuario puede reintentar.
        expect(redisMock.del).not.toHaveBeenCalledWith(`otp:${SESSION_ID}`);
      });

      it('OTP inválido en último intento → quema sesión + bump rondas fallidas + 401 final', async () => {
        await buildService();
        preloadSession({ attemptsLeft: 1 });
        await expect(service.otpVerify({ session: SESSION_ID, code: '000000' })).rejects.toThrow(
          /Demasiados intentos/,
        );
        // Sesión borrada (quemada).
        expect(redisMock.del).toHaveBeenCalledWith(`otp:${SESSION_ID}`);
        // Contador de rondas fallidas incrementado por insuredId.
        expect(redisMock.raw.incr).toHaveBeenCalledWith(`otp:rounds:curp:${INSURED_ID}`);
      });

      it('throttle por sesión: 6º verify sobre la misma sesión → 401 sin tocar Redis OTP', async () => {
        await buildService();
        // El primer raw.incr es el rate-limit por sesión.
        redisMock.raw.incr.mockResolvedValueOnce(6);
        await expect(service.otpVerify({ session: SESSION_ID, code: VALID_CODE })).rejects.toThrow(
          /Demasiados intentos en poco tiempo/,
        );
        // No se llegó a leer la sesión OTP.
        expect(redisMock.get).not.toHaveBeenCalledWith(`otp:${SESSION_ID}`);
      });

      it('sesión corrupta en Redis (JSON inválido) → 401 + auto-clean del bucket', async () => {
        await buildService();
        redisMock.get.mockResolvedValueOnce('{not-json');
        await expect(service.otpVerify({ session: SESSION_ID, code: VALID_CODE })).rejects.toThrow(
          UnauthorizedException,
        );
        expect(redisMock.del).toHaveBeenCalledWith(`otp:${SESSION_ID}`);
      });

      it('persistencia cognitoSub falla (BD down) → tokens igual se devuelven (best-effort)', async () => {
        await buildService();
        preloadSession();
        insuredUpdate.mockRejectedValueOnce(new Error('DB down'));
        const result = await service.otpVerify({ session: SESSION_ID, code: VALID_CODE });
        expect(result.idToken).toBeDefined();
      });
    });
  });

  describe('refresh()', () => {
    it('delega a cognito.refresh con el refreshToken', async () => {
      cognito.refresh.mockResolvedValue(tokens);
      const result = await service.refresh({ refreshToken: 'rt-' + 'x'.repeat(30) });
      expect(cognito.refresh).toHaveBeenCalledWith('rt-' + 'x'.repeat(30));
      expect(result).toBe(tokens);
    });
  });

  describe('logout()', () => {
    it('llama revoke cuando hay refreshToken', async () => {
      cognito.revoke.mockResolvedValue(undefined);
      await service.logout('rt-abc');
      expect(cognito.revoke).toHaveBeenCalledWith('rt-abc');
    });

    it('NO llama revoke si refreshToken es undefined (logout idempotente)', async () => {
      await service.logout(undefined);
      expect(cognito.revoke).not.toHaveBeenCalled();
    });
  });
});
