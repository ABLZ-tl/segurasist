import { Module } from '@nestjs/common';
import { AwsModule } from '@infra/aws/aws.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { BrandingAdminController } from '@modules/admin/tenants/branding-admin.controller';
import { BrandingUploadService } from '@modules/admin/tenants/branding-upload.service';
import { BrandingController } from './branding.controller';
import { BrandingService } from './branding.service';

/**
 * Sprint 5 — MT-1. Módulo de branding multi-tenant.
 *
 * Wireup:
 *   - `BrandingService`: cache in-memory + lectura/escritura BD (PrismaBypassRlsService).
 *   - `BrandingUploadService`: S3 upload (AwsModule).
 *   - `BrandingController` (insured + admin readers): GET /v1/tenants/me/branding.
 *   - `BrandingAdminController`: GET/PUT/POST logo/DELETE logo bajo /v1/admin/tenants/:id/branding.
 *
 * AuditPersistenceModule es @Global (provee `AuditWriterService` + `AuditContextFactory`).
 */
@Module({
  imports: [PrismaModule, AwsModule],
  controllers: [BrandingController, BrandingAdminController],
  providers: [BrandingService, BrandingUploadService],
  exports: [BrandingService],
})
export class BrandingModule {}
