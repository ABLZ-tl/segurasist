import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './common/health.controller';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { TenantOverrideAuditInterceptor } from './common/interceptors/tenant-override-audit.interceptor';
import { PrismaModule } from './common/prisma/prisma.module';
import { ThrottlerGuard } from './common/throttler/throttler.guard';
import { ThrottlerModule } from './common/throttler/throttler.module';
import { scrubSensitiveDeep } from './common/utils/scrub-sensitive';
import { AppConfigModule } from './config/config.module';
import { AwsModule } from './infra/aws/aws.module';
import { CacheModule } from './infra/cache/cache.module';
import { AuditPersistenceModule } from './modules/audit/audit-persistence.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { SamlModule } from './modules/auth/saml/saml.module';
import { BatchesModule } from './modules/batches/batches.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { ChatModule } from './modules/chat/chat.module';
import { ChatbotModule } from './modules/chatbot/chatbot.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { CoveragesModule } from './modules/coverages/coverages.module';
import { EmailModule } from './modules/email/email.module';
import { InsuredsModule } from './modules/insureds/insureds.module';
import { PackagesModule } from './modules/packages/packages.module';
import { ReportsCronModule } from './modules/reports/cron/reports-cron.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ScimModule } from './modules/scim/scim.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { BrandingModule } from './modules/tenants/branding/branding.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
        autoLogging: true,
        customProps: (req) => ({
          traceId: req.id,
          tenantId: (req as unknown as { tenant?: { id: string } }).tenant?.id,
        }),
        // M5 — redact recursivo. fast-redact (motor de pino) NO soporta
        // wildcard recursivo `**`; sólo soporta `*` al final / intermedio.
        // Para garantizar que claves sensibles queden redactadas en CUALQUIER
        // profundidad, hacemos el scrubbing como custom serializer en
        // `formatters.log`: clonamos el merging-object antes de serializar
        // y reemplazamos cada match por '[REDACTED]'. Combinado con el
        // `redact.paths` clásico para los headers de request (que no entran
        // por log obj sino por pino-http), cubrimos todos los vectores.
        //
        // Mantener `SENSITIVE_KEYS` sincronizado con
        // `src/common/interceptors/audit.interceptor.ts`.
        //
        // Perf: el clone profundo agrega ~1-3µs por log line. Aceptable para
        // un API REST con tráfico operacional; si en futuro hot-paths caen
        // dentro del p99, considerar mover el scrubbing al borde (interceptor)
        // para que pino reciba ya redacted.
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie'],
          censor: '[REDACTED]',
        },
        formatters: {
          log: (obj: Record<string, unknown>): Record<string, unknown> =>
            scrubSensitiveDeep(obj) as Record<string, unknown>,
        },
      },
    }),
    TerminusModule,
    PrismaModule,
    AwsModule,
    CacheModule,
    // H1 — rate limiter global. CacheModule arriba expone RedisService que
    // el storage Redis del throttler reusa. Default 60 req/min por
    // (userId+IP) ó IP cuando no hay sesión. Overrides por endpoint vía
    // `@Throttle({ ttl, limit })`. Health endpoints exentos vía
    // `@SkipThrottle()` (ver HealthController).
    //
    // En NODE_ENV=test los e2e específicos del throttler ya verifican el
    // bloqueo con un module test aislado; los demás e2e levantan AppModule
    // real y golpean /v1/auth/login decenas de veces. Para evitar que el
    // rate limiter contamine esos suites, usamos un limit alto en test.
    // Si querés probar bloqueos fuera del integration spec, override por
    // env var `THROTTLE_LIMIT_DEFAULT`.
    ThrottlerModule.forRoot({
      ttl: 60_000,
      limit: process.env.NODE_ENV === 'test' ? 10_000 : Number(process.env.THROTTLE_LIMIT_DEFAULT ?? 60),
    }),
    // H2 — writer de audit_log con PrismaClient propio (DATABASE_URL_AUDIT).
    AuditPersistenceModule,
    AuthModule,
    // S5-1 — admin SAML SSO (SP-init). Mounts /v1/auth/saml/{metadata,login,acs}.
    SamlModule,
    // S5-1 — SCIM 2.0 user provisioning. Mounts /v1/scim/v2/Users (+ Groups stub).
    ScimModule,
    TenantsModule,
    // Sprint 5 MT-1 — endpoints de branding multi-tenant. Mounts
    // GET /v1/tenants/me/branding (insured) y CRUD admin /v1/admin/tenants/:id/branding.
    BrandingModule,
    UsersModule,
    PackagesModule,
    CoveragesModule,
    InsuredsModule,
    BatchesModule,
    EmailModule,
    CertificatesModule,
    ClaimsModule,
    ReportsModule,
    // S1 iter 2 — wireup del handler SQS del cron mensual S4-04 (owner S3) +
    // provider real del generator de PDF (owner S1). El módulo NO arranca el
    // poll loop en NODE_ENV=test ni con WORKERS_ENABLED!=true.
    ReportsCronModule,
    ChatModule,
    ChatbotModule,
    AuditModule,
    WebhooksModule,
    // S2-01 — workers SQS (layout-validation + insureds-creation). Pollers
    // se inician sólo si `WORKERS_ENABLED=true` (default off para tests/e2e).
    WorkersModule,
  ],
  controllers: [HealthController],
  providers: [
    // H1 — guardian global. NOTA: el orden de declaración aquí no controla
    // el orden de ejecución a nivel handler; los `@UseGuards(JwtAuthGuard)`
    // declarados en cada controller corren ANTES del APP_GUARD global, por
    // lo que `req.user` ya estará populado para usar `userId+IP` como key.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // H2 — interceptor global que persiste mutaciones en audit_log.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // S3-08 — interceptor global que registra `tenant.override.used` en cada
    // request del superadmin con `X-Tenant-Override` (cubre los reads, donde
    // el AuditInterceptor estándar no escribe nada).
    { provide: APP_INTERCEPTOR, useClass: TenantOverrideAuditInterceptor },
  ],
})
export class AppModule {}
