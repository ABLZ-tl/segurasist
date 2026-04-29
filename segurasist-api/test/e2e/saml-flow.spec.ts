/**
 * SAML SP-init E2E (S5-1 Sprint 5 iter 2 — DEFERRED stub).
 *
 * This file is intentionally `it.skip` for the duration of Sprint 5. The
 * full E2E flow requires either:
 *   (a) the mock IdP fixture under `test/fixtures/mock-idp/` AND a Nest
 *       app boot with `SAML_TENANT_CONFIGS` populated from the fixture
 *       public key, OR
 *   (b) a Playwright run pointed at the staging Okta dev tenant
 *       (https://dev-XXXXXX.okta.com — owned by SegurAsist).
 *
 * Sprint 6 — TODO:
 *   1. Boot the API with `SamlModule` + `SAML_TENANT_CONFIGS=[{tenantId, idpEntityId, idpSsoUrl, idpX509Cert}]` resolved from `idp-public.pem`.
 *   2. GET /v1/auth/saml/login?tenantId=...  → expect 302 + `sa_saml_relay` cookie.
 *   3. Use `signAssertion({...})` to mint a SAMLResponse with the relay
 *      from the cookie as `inResponseTo`.
 *   4. POST /v1/auth/saml/acs with the SAMLResponse + cookie → expect
 *      200 ok=true, `sa_session` cookie set, audit_log row with
 *      `action='saml_login_succeeded'`.
 *   5. Repeat with a tampered signature → expect ok=false, audit_log
 *      row with `action='saml_login_failed'` and `payloadDiff.reason`
 *      hashed.
 *   6. (Playwright only) drive the IdP login form on the Okta dev tenant
 *      and assert the redirect lands on `/dashboard` with a session.
 *
 * Why deferred: cognito-local cannot stand in for an IdP, and the staging
 * Okta dev tenant is provisioned but the trust relationship requires
 * SecOps review (NEW-FINDING-S5-1-02 — `samlify` + `xml-crypto` audit).
 */
import { describe, it } from '@jest/globals';

describe('SAML SP-init E2E (S5-1 iter 2 — DEFERRED to Sprint 6)', () => {
  it.skip(
    'TODO Sprint 6: full SP-init flow against mock IdP fixture',
    async () => {
      // 1) ensureKeypair() — see test/fixtures/mock-idp/keys/generate-keys.mjs
      // 2) Build TenantSamlConfigSnapshot from idp-public.pem
      // 3) GET /v1/auth/saml/login?tenantId=...
      // 4) signAssertion({...}) → POST /v1/auth/saml/acs
      // 5) assert sa_session cookie + audit_log saml_login_succeeded
    },
  );

  it.skip(
    'TODO Sprint 6: tampered signature triggers saml_login_failed audit',
    async () => {
      // signWithPrivatePem: a different keypair → expect ok=false +
      // audit_log row action=saml_login_failed.
    },
  );

  it.skip(
    'TODO Sprint 6: Playwright happy path against Okta dev tenant',
    async () => {
      // Requires STAGING_OKTA_USER + STAGING_OKTA_PASSWORD secrets in CI.
    },
  );
});
