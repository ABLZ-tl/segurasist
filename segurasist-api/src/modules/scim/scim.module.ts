import { Module } from '@nestjs/common';
import { AuditPersistenceModule } from '../audit/audit-persistence.module';
import { ScimController } from './scim.controller';
import { ScimService } from './scim.service';

/**
 * SCIM 2.0 module — IdP-driven user provisioning (S5-1 Sprint 5 iter 1).
 *
 * Mounted under `/v1/scim/v2`. Auth is a per-tenant bearer token resolved
 * inside the controller, NOT the platform JWT — IdPs (Okta, AzureAD)
 * authenticate as a service principal, not a user. This is why the
 * routes are `@Public()` from the platform's perspective.
 */
@Module({
  imports: [AuditPersistenceModule],
  controllers: [ScimController],
  providers: [ScimService],
  exports: [ScimService],
})
export class ScimModule {}
