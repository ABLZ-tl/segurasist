import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { PrismaBypassRlsService } from '@common/prisma/prisma-bypass-rls.service';
import { Module } from '@nestjs/common';
import { AuditPersistenceModule } from '../audit/audit-persistence.module';
import { EmailModule } from '../email/email.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * AuthModule.
 *
 * S3-01 — pulled `AuditPersistenceModule` y `EmailModule` para que `AuthService`
 * pueda registrar audit events del flujo OTP y enviar el email del código.
 * `RedisService` viene del `CacheModule` global, no requiere import explícito.
 * `PrismaBypassRlsService` también es global vía `PrismaModule` pero lo
 * declaramos como provider local para ser explícitos sobre la dependencia.
 */
@Module({
  imports: [AuditPersistenceModule, EmailModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, PrismaBypassRlsService],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
