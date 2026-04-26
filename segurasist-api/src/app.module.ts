import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import { HealthController } from './common/health.controller';
import { PrismaModule } from './common/prisma/prisma.module';
import { AppConfigModule } from './config/config.module';
import { AwsModule } from './infra/aws/aws.module';
import { CacheModule } from './infra/cache/cache.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BatchesModule } from './modules/batches/batches.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { ChatModule } from './modules/chat/chat.module';
import { ClaimsModule } from './modules/claims/claims.module';
import { CoveragesModule } from './modules/coverages/coverages.module';
import { InsuredsModule } from './modules/insureds/insureds.module';
import { PackagesModule } from './modules/packages/packages.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

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
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
          censor: '[REDACTED]',
        },
      },
    }),
    TerminusModule,
    PrismaModule,
    AwsModule,
    CacheModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    PackagesModule,
    CoveragesModule,
    InsuredsModule,
    BatchesModule,
    CertificatesModule,
    ClaimsModule,
    ReportsModule,
    ChatModule,
    AuditModule,
    WebhooksModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
