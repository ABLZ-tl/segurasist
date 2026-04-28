import { EnvSchema, loadEnv } from './env.schema';

const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  HOST: '0.0.0.0',
  LOG_LEVEL: 'info',
  TRACE_SAMPLE_RATE: '0.1',
  DATABASE_URL: 'postgres://u:p@localhost:5432/d',
  REDIS_URL: 'redis://localhost:6379',
  AWS_REGION: 'mx-central-1',
  COGNITO_REGION: 'mx-central-1',
  COGNITO_USER_POOL_ID_ADMIN: 'pa',
  COGNITO_USER_POOL_ID_INSURED: 'pi',
  COGNITO_CLIENT_ID_ADMIN: 'ca',
  COGNITO_CLIENT_ID_INSURED: 'ci',
  S3_BUCKET_UPLOADS: 'b1',
  S3_BUCKET_CERTIFICATES: 'b2',
  S3_BUCKET_AUDIT: 'b3',
  S3_BUCKET_EXPORTS: 'b4',
  SQS_QUEUE_LAYOUT: 'http://q1',
  SQS_QUEUE_PDF: 'http://q2',
  SQS_QUEUE_EMAIL: 'http://q3',
  SQS_QUEUE_REPORTS: 'http://q4',
  SQS_QUEUE_INSUREDS_CREATION: 'http://q5',
  // S4-04 — cron mensual.
  SQS_QUEUE_MONTHLY_REPORTS: 'http://q6',
  MONTHLY_REPORT_RECIPIENTS: 'ops@segurasist.local,admin@hospitalesmac.local',
  SES_SENDER_DOMAIN: 'mac.local',
  SES_CONFIGURATION_SET: 'cs',
  KMS_KEY_ID: 'alias/test',
  CORS_ALLOWED_ORIGINS: 'http://localhost,http://app.local',
  // C-04 — INSURED_DEFAULT_PASSWORD ya NO tiene default; los tests deben
  // proveer un valor que pase el blocklist + reglas prod.
  INSURED_DEFAULT_PASSWORD: 'TestPwd-StrongRandom_123!',
};

describe('EnvSchema', () => {
  it('parsea un env válido y aplica defaults/coerciones', () => {
    const parsed = EnvSchema.parse(VALID_ENV);
    expect(parsed.NODE_ENV).toBe('test');
    expect(parsed.PORT).toBe(3000); // coerce number
    expect(parsed.TRACE_SAMPLE_RATE).toBe(0.1);
    expect(parsed.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost', 'http://app.local']);
    expect(parsed.ENABLE_SWAGGER).toBe(false);
  });

  it('CORS_ALLOWED_ORIGINS limpia espacios y entradas vacías', () => {
    const parsed = EnvSchema.parse({ ...VALID_ENV, CORS_ALLOWED_ORIGINS: ' http://a , , http://b ' });
    expect(parsed.CORS_ALLOWED_ORIGINS).toEqual(['http://a', 'http://b']);
  });

  it('rechaza DATABASE_URL no-postgres', () => {
    const r = EnvSchema.safeParse({ ...VALID_ENV, DATABASE_URL: 'mysql://x:y@z/w' });
    expect(r.success).toBe(false);
  });

  it('rechaza PORT fuera de rango', () => {
    expect(EnvSchema.safeParse({ ...VALID_ENV, PORT: '0' }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...VALID_ENV, PORT: '99999' }).success).toBe(false);
  });

  it('TRACE_SAMPLE_RATE fuera de [0,1] falla', () => {
    expect(EnvSchema.safeParse({ ...VALID_ENV, TRACE_SAMPLE_RATE: '2' }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...VALID_ENV, TRACE_SAMPLE_RATE: '-0.1' }).success).toBe(false);
  });

  it('ENABLE_SWAGGER acepta "true"/"false"/"0"/"1" y lo transforma a boolean', () => {
    expect(EnvSchema.parse({ ...VALID_ENV, ENABLE_SWAGGER: 'true' }).ENABLE_SWAGGER).toBe(true);
    expect(EnvSchema.parse({ ...VALID_ENV, ENABLE_SWAGGER: '1' }).ENABLE_SWAGGER).toBe(true);
    expect(EnvSchema.parse({ ...VALID_ENV, ENABLE_SWAGGER: 'false' }).ENABLE_SWAGGER).toBe(false);
    expect(EnvSchema.parse({ ...VALID_ENV, ENABLE_SWAGGER: '0' }).ENABLE_SWAGGER).toBe(false);
  });

  it('COGNITO_ENDPOINT opcional pero si presente debe ser URL', () => {
    expect(EnvSchema.safeParse({ ...VALID_ENV, COGNITO_ENDPOINT: 'http://localhost:9229' }).success).toBe(
      true,
    );
    expect(EnvSchema.safeParse({ ...VALID_ENV, COGNITO_ENDPOINT: 'not-a-url' }).success).toBe(false);
  });

  // M4 — Cross-validation: footgun de COGNITO_ENDPOINT en producción.
  describe('COGNITO_ENDPOINT prod-guard (M4)', () => {
    it('NODE_ENV=production + COGNITO_ENDPOINT apuntando a un host atacante → falla', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'production',
        COGNITO_ENDPOINT: 'https://attacker.example/',
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const msg = r.error.issues.map((i) => i.message).join('|');
        expect(msg).toMatch(/COGNITO_ENDPOINT con valor no-AWS/);
        expect(msg).toMatch(/https:\/\/attacker\.example\//);
      }
    });

    it('NODE_ENV=production + COGNITO_ENDPOINT cognito-idp AWS (con path) → ok', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'production',
        COGNITO_ENDPOINT: 'https://cognito-idp.mx-central-1.amazonaws.com/foo',
      });
      expect(r.success).toBe(true);
    });

    it('NODE_ENV=production + COGNITO_ENDPOINT undefined → ok (default AWS)', () => {
      const env: Record<string, string | undefined> = { ...VALID_ENV, NODE_ENV: 'production' };
      delete env.COGNITO_ENDPOINT;
      const r = EnvSchema.safeParse(env);
      expect(r.success).toBe(true);
    });

    it('NODE_ENV=development + COGNITO_ENDPOINT cognito-local → ok', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'development',
        COGNITO_ENDPOINT: 'http://0.0.0.0:9229/',
      });
      expect(r.success).toBe(true);
    });

    it('NODE_ENV=production + COGNITO_ENDPOINT con http (no https) cognito-idp → falla', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'production',
        COGNITO_ENDPOINT: 'http://cognito-idp.mx-central-1.amazonaws.com/',
      });
      expect(r.success).toBe(false);
    });
  });

  describe('DATABASE_URL_BYPASS / DATABASE_URL_AUDIT (M2/M4)', () => {
    it('ausente → ok (degradación documentada)', () => {
      const env: Record<string, string | undefined> = { ...VALID_ENV };
      delete env.DATABASE_URL_BYPASS;
      delete env.DATABASE_URL_AUDIT;
      const r = EnvSchema.safeParse(env);
      expect(r.success).toBe(true);
    });

    it('presente con URL postgres válida → ok', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        DATABASE_URL_BYPASS: 'postgresql://segurasist_admin:pwd@localhost:5432/segurasist',
        DATABASE_URL_AUDIT: 'postgresql://segurasist_admin:pwd@localhost:5432/segurasist',
      });
      expect(r.success).toBe(true);
    });

    it('presente pero NO postgres → falla', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        DATABASE_URL_BYPASS: 'mysql://x:y@host/db',
      });
      expect(r.success).toBe(false);
    });
  });

  it('aplica defaults para NODE_ENV/PORT/HOST/LOG_LEVEL cuando faltan', () => {
    const minimal = { ...VALID_ENV };
    delete minimal.NODE_ENV;
    delete minimal.PORT;
    delete minimal.HOST;
    delete minimal.LOG_LEVEL;
    delete minimal.TRACE_SAMPLE_RATE;
    delete minimal.AWS_REGION;
    const r = EnvSchema.parse(minimal);
    expect(r.NODE_ENV).toBe('development');
    expect(r.PORT).toBe(3000);
    expect(r.HOST).toBe('0.0.0.0');
    expect(r.LOG_LEVEL).toBe('info');
    expect(r.TRACE_SAMPLE_RATE).toBe(0.05);
    expect(r.AWS_REGION).toBe('mx-central-1');
  });

  // C-04 — INSURED_DEFAULT_PASSWORD: blocklist + prod-strength rules.
  describe('INSURED_DEFAULT_PASSWORD prod-guard (C-04)', () => {
    it('NO tiene default — ausente ⇒ falla la validación', () => {
      const env: Record<string, string | undefined> = { ...VALID_ENV };
      delete env.INSURED_DEFAULT_PASSWORD;
      const r = EnvSchema.safeParse(env);
      expect(r.success).toBe(false);
    });

    it('rechaza password "Demo123!" en cualquier NODE_ENV (blocklist global)', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'development',
        INSURED_DEFAULT_PASSWORD: 'Demo123!',
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const msg = r.error.issues.map((i) => i.message).join('|');
        expect(msg).toMatch(/hardcoded conocido/);
      }
    });

    it('rechaza password "Demo123!" en NODE_ENV=production', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'production',
        // Cognito region → AWS pattern para que NO falle por el otro guard.
        INSURED_DEFAULT_PASSWORD: 'Demo123!',
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const issues = r.error.issues.filter((i) => i.path.includes('INSURED_DEFAULT_PASSWORD'));
        expect(issues.length).toBeGreaterThan(0);
      }
    });

    it('rechaza otros hardcoded conocidos (Password123!, Welcome123!)', () => {
      for (const pwd of ['Password123!', 'Welcome123!', 'Admin123!', 'Test123!']) {
        const r = EnvSchema.safeParse({ ...VALID_ENV, INSURED_DEFAULT_PASSWORD: pwd });
        expect(r.success).toBe(false);
      }
    });

    it('NODE_ENV=production + password <14 chars ⇒ falla', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'production',
        INSURED_DEFAULT_PASSWORD: 'Short1!a',
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const msg = r.error.issues.map((i) => i.message).join('|');
        expect(msg).toMatch(/>=14 caracteres en producción/);
      }
    });

    it('NODE_ENV=production + password sin símbolo ⇒ falla', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'production',
        INSURED_DEFAULT_PASSWORD: 'aaaaaaaaaaaaaaaa1B',
      });
      expect(r.success).toBe(false);
      if (!r.success) {
        const msg = r.error.issues.map((i) => i.message).join('|');
        expect(msg).toMatch(/símbolo no-alfanumérico/);
      }
    });

    it('NODE_ENV=production + password fuerte (>=14, símbolo, no blocklist) ⇒ ok', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'production',
        INSURED_DEFAULT_PASSWORD: 'StrongRandom-Prod!92xkz',
      });
      expect(r.success).toBe(true);
    });

    it('NODE_ENV=development + password mínima (8 chars, no blocklist) ⇒ ok', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        NODE_ENV: 'development',
        INSURED_DEFAULT_PASSWORD: 'devlocal',
      });
      expect(r.success).toBe(true);
    });

    it('rechaza password <8 chars (regla base z.string().min(8))', () => {
      const r = EnvSchema.safeParse({
        ...VALID_ENV,
        INSURED_DEFAULT_PASSWORD: 'tiny',
      });
      expect(r.success).toBe(false);
    });
  });
});

describe('loadEnv', () => {
  it('devuelve el env parseado en happy path', () => {
    const env = loadEnv(VALID_ENV);
    expect(env.PORT).toBe(3000);
  });

  it('proceso muere con exit(1) si el env es inválido', () => {
    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('process.exit called');
    }) as never);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => loadEnv({ ...VALID_ENV, DATABASE_URL: 'not-url' })).toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy).toHaveBeenCalled();
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });
});
