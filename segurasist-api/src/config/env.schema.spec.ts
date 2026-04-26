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
  SES_SENDER_DOMAIN: 'mac.local',
  SES_CONFIGURATION_SET: 'cs',
  KMS_KEY_ID: 'alias/test',
  CORS_ALLOWED_ORIGINS: 'http://localhost,http://app.local',
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
