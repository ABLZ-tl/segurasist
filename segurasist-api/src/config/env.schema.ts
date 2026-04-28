import { z } from 'zod';

const booleanString = z.enum(['true', 'false', '0', '1']).transform((v) => v === 'true' || v === '1');

const logLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;

/**
 * Regex que valida la URL del JWKS oficial de Cognito en cualquier región AWS.
 * Cualquier override de `COGNITO_ENDPOINT` que NO matchee este patrón es
 * tratado como hostil bajo `NODE_ENV=production` (M4 — footgun: un atacante
 * con acceso a Secrets Manager podría apuntar JWKS a un host bajo su control).
 */
const COGNITO_AWS_PROD_PATTERN = /^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com(\/.*)?$/;

const PostgresUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('postgres://') || u.startsWith('postgresql://'), {
    message: 'must be a postgres connection string',
  });

export const EnvSchema = z
  .object({
    // Runtime
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    TRACE_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.05),

    // Database
    DATABASE_URL: PostgresUrl.refine((u) => u.length > 0, {
      message: 'DATABASE_URL must be a postgres connection string',
    }),

    /**
     * URL al rol DB con BYPASSRLS (`segurasist_admin`). Se usa para paths
     * superadmin (cross-tenant) y opcionalmente para el writer de auditoría
     * (la pista append-only del otro agente puede reusar este DSN). El cliente
     * normal sigue usando `DATABASE_URL` con rol `segurasist_app` (NOBYPASSRLS).
     * Nullable: si está ausente, los services superadmin lanzan
     * `NotImplementedException` en lugar de leer cross-tenant.
     */
    DATABASE_URL_BYPASS: PostgresUrl.optional(),

    /**
     * URL al writer de auditoría. Si ausente: degradación a pino-only.
     * Si presente: postgres URL válida (puede ser la misma que DATABASE_URL_BYPASS).
     */
    DATABASE_URL_AUDIT: PostgresUrl.optional(),

    // Cache
    REDIS_URL: z.string().url(),

    // AWS — region and Cognito user pools
    AWS_REGION: z.string().min(1).default('mx-central-1'),
    COGNITO_REGION: z.string().min(1),
    COGNITO_USER_POOL_ID_ADMIN: z.string().min(1),
    COGNITO_USER_POOL_ID_INSURED: z.string().min(1),
    COGNITO_CLIENT_ID_ADMIN: z.string().min(1),
    COGNITO_CLIENT_ID_INSURED: z.string().min(1),
    // Override del endpoint Cognito para dev local (cognito-local).
    // Si está presente, JwtAuthGuard arma issuer/JWKS contra esta base en lugar de
    // `https://cognito-idp.<region>.amazonaws.com`. Producción: dejar vacío.
    COGNITO_ENDPOINT: z.string().url().optional(),

    // S3 buckets
    S3_BUCKET_UPLOADS: z.string().min(1),
    S3_BUCKET_CERTIFICATES: z.string().min(1),
    S3_BUCKET_AUDIT: z.string().min(1),
    S3_BUCKET_EXPORTS: z.string().min(1),

    // SQS
    SQS_QUEUE_LAYOUT: z.string().url(),
    SQS_QUEUE_PDF: z.string().url(),
    SQS_QUEUE_EMAIL: z.string().url(),
    SQS_QUEUE_REPORTS: z.string().url(),
    /**
     * F4 + F5 coordination (iter 2): cola dedicada para `InsuredsCreationWorker`
     * post-`confirm()` del batch. La cola standard `insureds-creation` (con DLQ)
     * vive en `scripts/localstack-bootstrap.sh` (dev) y los 3 envs Terraform
     * (`segurasist-infra/envs/{dev,staging,prod}/main.tf`). Idempotencia
     * DB-side: `batch_processed_rows (tenant_id, batch_id, row_number)` UNIQUE
     * + CAS atómico sobre `Batch.completedEventEmittedAt`. La cola NO es FIFO.
     */
    SQS_QUEUE_INSUREDS_CREATION: z.string().url(),

    /**
     * S4-04 — Cola del cron mensual (EventBridge → SQS → MonthlyReportsHandler).
     * Standard (NO FIFO). EventBridge rule `segurasist-<env>-cron-monthly-reports`
     * publica un mensaje el día 1 a las 14:00 UTC; el handler NestJS hace
     * polling, itera tenants activos y genera reporte mensual + envía email.
     * Idempotencia DB-side: tabla `monthly_report_runs` UNIQUE
     * `(tenant_id, period_year, period_month)`.
     */
    SQS_QUEUE_MONTHLY_REPORTS: z.string().url(),

    /**
     * S4-04 — Lista CSV de destinatarios del PDF mensual. Mínimo 1 email.
     * En MVP es estático (operations + product owner del cliente Hospitales
     * MAC); Sprint 5 lo migrará a una tabla `tenant_subscriptions` con
     * override por tenant. Validamos cada item como email.
     */
    MONTHLY_REPORT_RECIPIENTS: z
      .string()
      .min(1)
      .transform((s) =>
        s
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.string().email()).min(1)),

    // SES
    SES_SENDER_DOMAIN: z.string().min(1),
    SES_CONFIGURATION_SET: z.string().min(1),

    /**
     * Adapter SES — `smtp` usa nodemailer apuntando a `SMTP_HOST:SMTP_PORT`
     * (Mailpit en dev). `aws` usa SES real (`@aws-sdk/client-ses`). Default
     * `smtp` en development/test, `aws` en staging/production. Resolución
     * en `SesService` según NODE_ENV; este flag es override explícito.
     */
    EMAIL_TRANSPORT: z.enum(['smtp', 'aws']).optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),

    /**
     * Base URL pública del API — se incrusta en el QR de los certificados
     * (`https://{CERT_BASE_URL}/v1/certificates/verify/{hash}`). En dev:
     * `http://localhost:3000`. En prod: `https://api.segurasist.app`.
     */
    CERT_BASE_URL: z.string().url().default('http://localhost:3000'),

    /** From de los emails de certificado (override por tenant si está set). */
    EMAIL_FROM_CERT: z.string().email().default('cert@segurasist.app'),

    /**
     * Re-emisión a demanda + tracking Mailpit son sólo dev. En prod no se
     * arranca el polling tracker (SES → SNS webhook real). Flag opcional
     * para matar el tracker manualmente sin cambiar NODE_ENV.
     */
    MAILPIT_API_URL: z.string().url().default('http://localhost:8025'),

    // KMS
    KMS_KEY_ID: z.string().min(1),

    // CORS / endpoints
    CORS_ALLOWED_ORIGINS: z
      .string()
      .min(1)
      .transform((s) =>
        s
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      ),

    // Optional
    AWS_ENDPOINT_URL: z.string().url().optional(),
    ENABLE_SWAGGER: booleanString.optional().default('false'),

    /**
     * Política de enforcement de MFA en `JwtAuthGuard` para roles admin
     * (`admin_segurasist`/`admin_mac`).
     *
     *  - `'strict'`: rechaza tokens admin sin `amr=['mfa']` (o `cognito:mfa_enabled=true`).
     *    Default en `NODE_ENV=production`.
     *  - `'log'`: solo loguea warning cuando un admin entra sin MFA — útil en
     *    `development`/`test` porque cognito-local NO emite `amr` claim.
     *    Default fuera de producción.
     *  - `'off'`: ningún check (escape hatch). Logged on guard init.
     *
     * El default lo decide el código según `NODE_ENV` cuando el var no está
     * definido (Zod marca opcional). Cuando está definido, gana el valor
     * explícito.
     */
    MFA_ENFORCEMENT: z.enum(['strict', 'log', 'off']).optional(),

    /**
     * S3-01 — Portal asegurado.
     * Password compartida que el bootstrap de cognito-local le pone a todos los
     * insureds del pool. AuthService la usa para invocar AdminInitiateAuth tras
     * verificar el OTP en nuestro propio Redis. En producción este flujo se
     * reemplaza por CUSTOM_AUTH (cognito Lambda triggers); en MVP/dev local es
     * el atajo más simple sin perder seguridad: el atacante necesita el OTP que
     * jamás abandona el correo del titular.
     *
     * C-04 — NO default value. La variable es obligatoria y NO puede ser un
     * valor hardcoded conocido (`Demo123!`, `Password123!`, etc) en producción.
     * El cross-validation `superRefine` abajo enforces:
     *   - longitud mínima 8 (siempre).
     *   - en `NODE_ENV=production`: longitud >=14 + presencia de símbolo + NO en
     *     blocklist de hardcodeds conocidos.
     */
    INSURED_DEFAULT_PASSWORD: z.string().min(8),

    /**
     * S3-01 — TTL del OTP en Redis. 5 minutos es el balance recomendado por
     * NIST SP 800-63B (>=60s, <=10min). Se mantiene como env override para
     * poder bajarlo a 60s en pentests.
     */
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),

    /** S3-01 — Máximo de intentos de OTP por sesión antes de invalidarla. */
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),

    /** S3-01 — Lockout temporal por CURP tras superar OTP_MAX_ATTEMPTS varias veces (segundos). */
    OTP_LOCKOUT_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),

    /**
     * S4-08 — Inbox del equipo MAC que recibe escalamientos del chatbot
     * (history-in-the-loop). Cada vez que un asegurado pide "hablar con humano",
     * `EscalationService` envía un email a este destinatario con el histórico
     * de la conversación. En dev/test apunta a Mailpit (`mac-support@segurasist.local`),
     * en prod debe ser una distribución gestionada por MAC (e.g. soporte@mac.com.mx).
     */
    MAC_SUPPORT_EMAIL: z.string().email().default('mac-support@segurasist.local'),
  })
  .superRefine((env, ctx) => {
    // M4 — Cross-validation: en producción no se permite un COGNITO_ENDPOINT
    // que no apunte a `cognito-idp.<region>.amazonaws.com`. Si la env var queda
    // accesible para un atacante con acceso a Secrets Manager, podría redirigir
    // todo el JWKS y montar un bypass de auth.
    if (env.NODE_ENV === 'production' && env.COGNITO_ENDPOINT !== undefined) {
      if (!COGNITO_AWS_PROD_PATTERN.test(env.COGNITO_ENDPOINT)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COGNITO_ENDPOINT'],
          message: `COGNITO_ENDPOINT con valor no-AWS no es permitido en producción. Detected: ${env.COGNITO_ENDPOINT}`,
        });
      }
    }

    // C-04 — INSURED_DEFAULT_PASSWORD: hardcoded blocklist + prod-strength.
    // El valor `Demo123!` (y similares) era el default histórico del schema.
    // Si llegan a producción, atacante puede saltarse OTP via AdminInitiateAuth
    // con la password compartida. Bloqueamos en boot.
    const HARDCODED_BLOCKLIST = new Set([
      'Demo123!',
      'demo123!',
      'Password123!',
      'password',
      'Password1!',
      'Changeme123!',
      'Admin123!',
      'Test123!',
      'Welcome1!',
      'Welcome123!',
    ]);
    if (HARDCODED_BLOCKLIST.has(env.INSURED_DEFAULT_PASSWORD)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['INSURED_DEFAULT_PASSWORD'],
        message:
          'INSURED_DEFAULT_PASSWORD contiene un valor hardcoded conocido (e.g. "Demo123!"). ' +
          'Cambia el valor por uno aleatorio (>=14 chars con símbolos en producción). ' +
          'Ver C-04 en docs/audit/01-auth-rbac-v2.md.',
      });
    }
    if (env.NODE_ENV === 'production') {
      const pwd = env.INSURED_DEFAULT_PASSWORD;
      if (pwd.length < 14) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['INSURED_DEFAULT_PASSWORD'],
          message: `INSURED_DEFAULT_PASSWORD debe ser >=14 caracteres en producción (recibido: ${pwd.length}).`,
        });
      }
      // Al menos un símbolo no-alfanumérico (NIST SP 800-63B "memorized secret"
      // — no es estrictamente requerido por NIST, pero defendemos contra
      // valores tipo `Password1234567` triviales).
      if (!/[^A-Za-z0-9]/.test(pwd)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['INSURED_DEFAULT_PASSWORD'],
          message:
            'INSURED_DEFAULT_PASSWORD debe contener al menos un símbolo no-alfanumérico en producción.',
        });
      }
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`[BOOT FATAL] Invalid environment variables:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}
