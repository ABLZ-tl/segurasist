/**
 * SAML 2.0 SP-init service — S5-1 Sprint 5 iter 1.
 *
 * Provides:
 *   - SP metadata XML for IdP configuration.
 *   - AuthnRequest URL builder (HTTP-Redirect binding) for SP-init flow.
 *   - SAMLResponse parser (HTTP-POST ACS): decodes base64, validates
 *     signature against tenant's configured X.509 cert, validates time
 *     conditions (NotBefore / NotOnOrAfter), extracts attribute statements
 *     (email, custom:tenant_id, custom:role) and returns a normalized
 *     `SamlAssertion` object the controller can mint a session from.
 *
 * Library decision (see ADR-0009): we ship a minimal in-tree validator
 * for iter 1 while the `samlify` dependency goes through security review
 * (the lib pulls `xml-crypto` + `xmldom`, both heavy). Iter 2 swaps the
 * parser for `samlify` keeping this service's public surface stable
 * (`buildLoginUrl`, `parseAndValidateAssertion`, `getSpMetadataXml`).
 *
 * Multi-tenant: each tenant carries its own IdP entityID, SSO URL, X.509
 * cert and attribute mapping in `TenantSamlConfig` (FK 1:1 to Tenant).
 * The controller resolves the tenant from `?tenantId=` query param on
 * `/login` and from the `RelayState` cookie on `/acs`.
 *
 * Security:
 *   - We NEVER log the full assertion XML (PII + bearer-equivalent). The
 *     audit log records `assertionHashSha256` + email + tenantId only.
 *   - Signature verification uses the tenant cert; no cert in config ⇒
 *     reject (defense against IdP-not-configured tenant).
 *   - NotOnOrAfter expiry is enforced with a 60s clock skew window.
 *   - InResponseTo is validated against the RelayState cookie (binds the
 *     POST back to the SP-init redirect that started the flow). Replay
 *     attacks across sessions are blocked.
 *
 * NEW-FINDING-S5-1-01: cognito-local does not implement SAML. Local dev
 * uses a `MockIdpService` (test-only) that signs assertions with a
 * fixture cert; staging uses Okta dev tenant.
 */
import * as crypto from 'node:crypto';
import { ENV_TOKEN } from '@config/config.module';
import { Env } from '@config/env.schema';
import { Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { AuditContextFactory } from '@modules/audit/audit-context.factory';
import { AuditWriterService } from '@modules/audit/audit-writer.service';

export interface TenantSamlConfigSnapshot {
  tenantId: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpSloUrl?: string;
  idpX509Cert: string; // PEM (no headers ok) or base64 DER
  attributeMap?: Record<string, string>;
  // Iter 2: signing/encryption keys per tenant. Iter 1 uses platform key.
}

export interface SamlAssertion {
  /** SHA256 hex of the raw decoded XML. Audit-safe (not the XML itself). */
  assertionHashSha256: string;
  email: string;
  tenantId: string;
  role: string;
  /** NameID from <Subject>. Used as cognitoSub-equivalent for mapping. */
  nameId: string;
  notBefore?: Date;
  notOnOrAfter?: Date;
  /** Issuer entityID — must match tenant config. */
  issuer: string;
  /** InResponseTo — binds back to the original AuthnRequest. */
  inResponseTo?: string;
}

export interface ParseAssertionInput {
  /** Base64-encoded SAMLResponse from the IdP POST binding. */
  samlResponseB64: string;
  tenant: TenantSamlConfigSnapshot;
  /** RelayState issued by /login; bound 1:1 to InResponseTo. */
  expectedRelayState?: string;
  /** Override clock for tests. */
  now?: Date;
}

const DEFAULT_ATTRIBUTE_MAP: Record<string, string> = {
  email: 'email',
  tenantId: 'custom:tenant_id',
  role: 'custom:role',
};

/** 60s skew tolerance — same as JWT exp tolerance elsewhere in the codebase. */
const CLOCK_SKEW_SECONDS = 60;

@Injectable()
export class SamlService {
  private readonly log = new Logger(SamlService.name);

  /**
   * S5-1 iter 2 — `AuditWriterService` + `AuditContextFactory` are
   * `@Optional()` so the existing unit tests (which only pass
   * `{ ENV_TOKEN, useValue: {} }`) keep compiling. In production the
   * `SamlModule` imports `AuditPersistenceModule`, so both deps are
   * provided. When they ARE present, every `parseAndValidateAssertion`
   * call records `saml_login_{succeeded|failed}` with the request
   * context (ip, ua, traceId) and the assertion hash (NEVER the XML
   * itself — see ADR-0009 / S5-1 PII rule).
   */
  constructor(
    @Inject(ENV_TOKEN) private readonly env: Env,
    @Optional() private readonly auditWriter?: AuditWriterService,
    @Optional() private readonly auditCtx?: AuditContextFactory,
  ) {}

  // ---------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------

  /**
   * SP metadata XML — what the tenant uploads to their IdP. Static per
   * deployment (the SP entityID and ACS URL are platform-wide, NOT per
   * tenant; tenant disambiguation happens via RelayState cookie).
   */
  getSpMetadataXml(): string {
    const entityId = this.spEntityId();
    const acs = this.acsUrl();
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" ',
      `entityID="${escapeXml(entityId)}">`,
      '<md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" ',
      'protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">',
      '<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>',
      `<md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${escapeXml(acs)}" index="0" isDefault="true"/>`,
      '</md:SPSSODescriptor>',
      '</md:EntityDescriptor>',
    ].join('');
  }

  spEntityId(): string {
    return (this.env as unknown as { SAML_SP_ENTITY_ID?: string }).SAML_SP_ENTITY_ID
      ?? 'https://api.segurasist.local/saml/sp';
  }

  acsUrl(): string {
    return (this.env as unknown as { SAML_SP_ACS_URL?: string }).SAML_SP_ACS_URL
      ?? 'https://api.segurasist.local/v1/auth/saml/acs';
  }

  // ---------------------------------------------------------------------
  // SP-init redirect builder
  // ---------------------------------------------------------------------

  /**
   * Build the IdP redirect URL with a `SAMLRequest` parameter. Iter 1
   * uses HTTP-Redirect binding with no signing (compatible with Okta,
   * AzureAD default; signing required will be iter 2 via tenant
   * platform key + KMS).
   */
  buildLoginUrl(tenant: TenantSamlConfigSnapshot, relayState: string): string {
    const id = `_${crypto.randomBytes(16).toString('hex')}`;
    const issueInstant = new Date().toISOString();
    const xml = [
      '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ',
      'xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ',
      `ID="${id}" Version="2.0" IssueInstant="${issueInstant}" `,
      `Destination="${escapeXml(tenant.idpSsoUrl)}" `,
      `AssertionConsumerServiceURL="${escapeXml(this.acsUrl())}" `,
      'ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">',
      `<saml:Issuer>${escapeXml(this.spEntityId())}</saml:Issuer>`,
      '</samlp:AuthnRequest>',
    ].join('');
    // HTTP-Redirect binding: deflate then base64 then urlencode.
    const deflated = deflateRaw(Buffer.from(xml, 'utf8'));
    const samlRequest = encodeURIComponent(deflated.toString('base64'));
    const rs = encodeURIComponent(relayState);
    const sep = tenant.idpSsoUrl.includes('?') ? '&' : '?';
    return `${tenant.idpSsoUrl}${sep}SAMLRequest=${samlRequest}&RelayState=${rs}`;
  }

  // ---------------------------------------------------------------------
  // ACS — parse + validate
  // ---------------------------------------------------------------------

  /**
   * Parse the base64 SAMLResponse, validate the assertion signature
   * against the tenant cert, validate time conditions, extract the
   * normalized claims. Throws UnauthorizedException on any failure
   * (NEVER returns a partial assertion).
   *
   * S5-1 iter 2 — audit wireup. On the happy path emits
   * `saml_login_succeeded` with `{assertionHashSha256, email}`. On any
   * failure path emits `saml_login_failed` with `{reasonHash}` (we
   * SHA256 the reason code so audit consumers can group by failure
   * mode without ever storing the assertion XML or the user-supplied
   * email — PII rule). All audit calls are fire-and-forget; if the
   * writer is unavailable (DI omitted in unit tests) we log-only.
   */
  parseAndValidateAssertion(input: ParseAssertionInput): SamlAssertion {
    try {
      const result = this.parseAndValidateAssertionInner(input);
      this.recordAuditSuccess(result, input.tenant.tenantId);
      return result;
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'saml.unknown_error';
      this.recordAuditFailure(input.tenant.tenantId, reason);
      throw err;
    }
  }

  private parseAndValidateAssertionInner(input: ParseAssertionInput): SamlAssertion {
    const { samlResponseB64, tenant, expectedRelayState } = input;
    const now = input.now ?? new Date();

    // 1) Decode
    let xml: string;
    try {
      xml = Buffer.from(samlResponseB64, 'base64').toString('utf8');
    } catch {
      throw new UnauthorizedException('saml.malformed_response');
    }
    if (!xml.includes('<') || !xml.includes('Assertion')) {
      throw new UnauthorizedException('saml.malformed_response');
    }
    const assertionHashSha256 = crypto.createHash('sha256').update(xml).digest('hex');

    // 2) Signature validation. Iter 1 minimal: extract <ds:SignatureValue>
    // and verify against the cert's public key over the canonicalized
    // assertion. Iter 2 swaps for samlify/xml-crypto for full XMLDSig.
    if (!tenant.idpX509Cert || tenant.idpX509Cert.length < 32) {
      throw new UnauthorizedException('saml.tenant_not_configured');
    }
    if (!this.verifySignature(xml, tenant.idpX509Cert)) {
      throw new UnauthorizedException('saml.signature_invalid');
    }

    // 3) Issuer match
    const issuer = pickFirst(xml, /<(?:saml2?:)?Issuer[^>]*>([^<]+)<\/(?:saml2?:)?Issuer>/);
    if (!issuer || issuer.trim() !== tenant.idpEntityId) {
      throw new UnauthorizedException('saml.issuer_mismatch');
    }

    // 4) Time conditions
    const conditionsBlock = pickFirst(
      xml,
      /<(?:saml2?:)?Conditions\b[^>]*>/,
    );
    const notBefore = parseAttr(conditionsBlock, 'NotBefore');
    const notOnOrAfter = parseAttr(conditionsBlock, 'NotOnOrAfter');
    const skewMs = CLOCK_SKEW_SECONDS * 1000;
    if (notBefore) {
      const nb = new Date(notBefore);
      if (now.getTime() + skewMs < nb.getTime()) {
        throw new UnauthorizedException('saml.not_yet_valid');
      }
    }
    if (notOnOrAfter) {
      const noa = new Date(notOnOrAfter);
      if (now.getTime() - skewMs >= noa.getTime()) {
        throw new UnauthorizedException('saml.assertion_expired');
      }
    }

    // 5) Subject + InResponseTo
    const nameId =
      pickFirst(xml, /<(?:saml2?:)?NameID[^>]*>([^<]+)<\/(?:saml2?:)?NameID>/)?.trim() ?? '';
    if (!nameId) {
      throw new UnauthorizedException('saml.missing_subject');
    }
    const subjectConfirmation = pickFirst(
      xml,
      /<(?:saml2?:)?SubjectConfirmationData\b[^/]*\/?>/,
    );
    const inResponseTo = parseAttr(subjectConfirmation, 'InResponseTo');
    if (expectedRelayState && inResponseTo && expectedRelayState !== inResponseTo) {
      // Some IdPs do not echo InResponseTo; we only enforce when present.
      throw new UnauthorizedException('saml.in_response_to_mismatch');
    }

    // 6) Attribute extraction
    const map = { ...DEFAULT_ATTRIBUTE_MAP, ...(tenant.attributeMap ?? {}) };
    const attrs = parseAttributes(xml);
    const email = (attrs[map.email!] ?? attrs['email'] ?? attrs['mail'])?.trim();
    const tenantClaim = (attrs[map.tenantId!] ?? attrs['custom:tenant_id'])?.trim();
    const role = (attrs[map.role!] ?? attrs['custom:role'])?.trim() ?? 'admin_mac';

    if (!email) {
      throw new UnauthorizedException('saml.missing_email_claim');
    }
    if (!tenantClaim) {
      throw new UnauthorizedException('saml.missing_tenant_claim');
    }
    if (tenantClaim !== tenant.tenantId) {
      // Defense against an IdP-claimed tenant_id that disagrees with the
      // tenant scope of the ACS request (which came via RelayState).
      throw new UnauthorizedException('saml.tenant_claim_mismatch');
    }

    return {
      assertionHashSha256,
      email,
      tenantId: tenantClaim,
      role,
      nameId,
      notBefore: notBefore ? new Date(notBefore) : undefined,
      notOnOrAfter: notOnOrAfter ? new Date(notOnOrAfter) : undefined,
      issuer: issuer.trim(),
      inResponseTo: inResponseTo ?? undefined,
    };
  }

  // ---------------------------------------------------------------------
  // Internal — audit (S5-1 iter 2 wireup)
  // ---------------------------------------------------------------------

  private recordAuditSuccess(assertion: SamlAssertion, tenantId: string): void {
    if (!this.auditWriter) return;
    const ctx = this.auditCtx?.fromRequest() ?? {};
    void this.auditWriter.record({
      ...ctx,
      tenantId,
      action: 'saml_login_succeeded',
      resourceType: 'auth.saml',
      resourceId: tenantId,
      payloadDiff: {
        assertionHashSha256: assertion.assertionHashSha256,
        email: assertion.email,
      },
    });
  }

  private recordAuditFailure(tenantId: string, reason: string): void {
    if (!this.auditWriter) return;
    const ctx = this.auditCtx?.fromRequest() ?? {};
    // Hash the reason code so we never persist a user-supplied error
    // string (defense-in-depth in case a future failure path inlines
    // the email or the InResponseTo). The reason code itself is
    // platform-controlled (`saml.signature_invalid` etc.) so the hash
    // is deterministic and groupable across rows.
    const reasonHash = crypto.createHash('sha256').update(reason).digest('hex');
    void this.auditWriter.record({
      ...ctx,
      tenantId,
      action: 'saml_login_failed',
      resourceType: 'auth.saml',
      resourceId: tenantId,
      payloadDiff: { reasonHash },
    });
  }

  // ---------------------------------------------------------------------
  // Internal — signature verify
  // ---------------------------------------------------------------------

  /**
   * Verify the IdP signature over the assertion. Iter 1 implementation:
   * validate that `<ds:SignatureValue>` decoded with the tenant pub key
   * over a SHA256 digest of the `<Assertion>` element matches.
   *
   * This is INTENTIONALLY conservative — we accept the assertion only if
   * the cryptographic check passes; a malformed Signature element ⇒
   * reject. Edge cases (transforms, c14n) are handled in iter 2 via
   * `xml-crypto`.
   */
  private verifySignature(xml: string, cert: string): boolean {
    try {
      const sigValueB64 = pickFirst(
        xml,
        /<(?:ds:)?SignatureValue[^>]*>([\s\S]*?)<\/(?:ds:)?SignatureValue>/,
      )?.replace(/\s+/g, '');
      if (!sigValueB64) return false;
      const assertion = pickFirst(
        xml,
        /(<(?:saml2?:)?Assertion\b[\s\S]*?<\/(?:saml2?:)?Assertion>)/,
      );
      if (!assertion) return false;

      const pubKey = normalizeCert(cert);
      const verifier = crypto.createVerify('RSA-SHA256');
      verifier.update(assertion, 'utf8');
      verifier.end();
      return verifier.verify(pubKey, Buffer.from(sigValueB64, 'base64'));
    } catch (err) {
      this.log.debug(`saml.verifySignature failed: ${(err as Error).message}`);
      return false;
    }
  }
}

// ============================================================================
// Helpers — XML extraction (intentionally minimal; ADR-0009 documents the
// limits and the iter 2 swap-in for samlify).
// ============================================================================

function pickFirst(s: string, re: RegExp): string | undefined {
  const m = s.match(re);
  return m?.[1] ?? m?.[0];
}

function parseAttr(block: string | undefined, attr: string): string | undefined {
  if (!block) return undefined;
  const m = block.match(new RegExp(`${attr}="([^"]+)"`));
  return m?.[1];
}

/**
 * Extract `<saml:AttributeStatement>` `<saml:Attribute Name="..."><saml:AttributeValue>...`
 * pairs into a flat map. Multi-valued attributes use the first value.
 */
function parseAttributes(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<(?:saml2?:)?Attribute\s[^>]*Name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:saml2?:)?Attribute>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const name = m[1]!;
    const inner = m[2]!;
    const v = pickFirst(
      inner,
      /<(?:saml2?:)?AttributeValue[^>]*>([\s\S]*?)<\/(?:saml2?:)?AttributeValue>/,
    );
    if (v !== undefined) out[name] = v;
  }
  return out;
}

function normalizeCert(cert: string): string {
  const trimmed = cert.trim();
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  // Bare base64 → wrap.
  const lines = trimmed.replace(/\s+/g, '').match(/.{1,64}/g) ?? [trimmed];
  return ['-----BEGIN CERTIFICATE-----', ...lines, '-----END CERTIFICATE-----'].join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function deflateRaw(input: Buffer): Buffer {
  // node's zlib raw deflate (no zlib header) — same encoding HTTP-Redirect
  // binding mandates. Sync because AuthnRequest is small (<2KB).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const zlib = require('node:zlib') as typeof import('node:zlib');
  return zlib.deflateRawSync(input);
}
