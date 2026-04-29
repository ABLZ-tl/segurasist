import { Module } from '@nestjs/common';
import { AuditPersistenceModule } from '../../audit/audit-persistence.module';
import { SamlController } from './saml.controller';
import { SamlService } from './saml.service';

/**
 * SAML SSO module — admin federation (S5-1 Sprint 5 iter 1).
 *
 * Wired separately from `AuthModule` so the SAML provider tree (signing
 * keys, IdP metadata cache, multi-tenant config resolver) stays
 * isolated from the OTP/Cognito flow that lives in AuthService. Both
 * mount under `/v1/auth/...` but represent independent identity stacks.
 *
 * `AuditPersistenceModule` is imported for `AuditContextFactory`
 * (request-scoped). The actual `AuditWriterService` recording is wired
 * in iter 2 once the `audit_action` enum is extended with
 * `saml_login_succeeded` / `saml_login_failed`.
 */
@Module({
  imports: [AuditPersistenceModule],
  controllers: [SamlController],
  providers: [SamlService],
  exports: [SamlService],
})
export class SamlModule {}
