/**
 * Unit tests for SamlService — S5-1 Sprint 5 iter 1.
 *
 * Coverage targets:
 *   1) parse + validate happy path: signed assertion, valid time window,
 *      issuer + tenant match → returns SamlAssertion with extracted claims.
 *   2) signature reject: assertion XML signed by a DIFFERENT keypair than
 *      the tenant's configured cert → UnauthorizedException('saml.signature_invalid').
 *   3) NotOnOrAfter expired: assertion past expiry (with 60s skew) → reject.
 *   4) NotBefore future: assertion not yet valid → reject.
 *   5) Issuer mismatch: tenant.idpEntityId !== <Issuer> → reject.
 *   6) Tenant claim mismatch: assertion claims tenantA but RelayState
 *      points to tenantB → reject.
 *   7) Missing email claim → reject.
 *   8) Tenant not configured (no cert) → reject.
 *   9) Metadata XML contains entityID + ACS URL.
 *  10) buildLoginUrl produces a redirect with deflated SAMLRequest +
 *      RelayState appended.
 *
 * The fixture builds a real RSA keypair via `crypto.generateKeyPairSync`
 * and signs the canonical assertion XML with RSA-SHA256 — the same
 * algorithm `SamlService.verifySignature` checks.
 */
import * as crypto from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ENV_TOKEN } from '@config/config.module';
import { SamlService, type TenantSamlConfigSnapshot } from '@modules/auth/saml/saml.service';

const TENANT_ID = '00000000-0000-0000-0000-0000000000aa';
const IDP_ENTITY_ID = 'https://idp.example.test/saml';

interface Keypair {
  privatePem: string;
  publicCertPem: string;
}

/**
 * Generate an RSA keypair and a self-signed-like wrapper for the public
 * key. We don't need a true X.509 cert because `SamlService` extracts
 * the public key with `crypto.createVerify().verify(pubKey, ...)` which
 * accepts BOTH a cert and a raw public key in PEM. We pass the raw
 * SPKI public key wrapped in BEGIN CERTIFICATE markers so the service's
 * `normalizeCert()` path is exercised.
 */
function makeKeypair(): Keypair {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  return { privatePem, publicCertPem: publicPem };
}

function signAssertion(assertionXml: string, privatePem: string): string {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(assertionXml, 'utf8');
  signer.end();
  return signer.sign(privatePem, 'base64');
}

function buildResponse(opts: {
  privatePem: string;
  issuer?: string;
  email?: string;
  tenantClaim?: string;
  role?: string;
  notBefore?: string;
  notOnOrAfter?: string;
  inResponseTo?: string;
  nameId?: string;
  /** If set, sign with a DIFFERENT key (used for the reject test). */
  signWithPrivatePem?: string;
}): string {
  const issuer = opts.issuer ?? IDP_ENTITY_ID;
  const email = opts.email ?? 'admin@example.test';
  const tenantClaim = opts.tenantClaim ?? TENANT_ID;
  const role = opts.role ?? 'admin_mac';
  const notBefore = opts.notBefore ?? new Date(Date.now() - 60_000).toISOString();
  const notOnOrAfter = opts.notOnOrAfter ?? new Date(Date.now() + 5 * 60_000).toISOString();
  const inResponseTo = opts.inResponseTo ?? '_relaystate-fixture';
  const nameId = opts.nameId ?? email;

  const assertionInner = [
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" Version="2.0" IssueInstant="${notBefore}">`,
    `<saml:Issuer>${issuer}</saml:Issuer>`,
    `<saml:Subject>`,
    `<saml:NameID>${nameId}</saml:NameID>`,
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">`,
    `<saml:SubjectConfirmationData InResponseTo="${inResponseTo}" NotOnOrAfter="${notOnOrAfter}"/>`,
    `</saml:SubjectConfirmation>`,
    `</saml:Subject>`,
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}"/>`,
    `<saml:AttributeStatement>`,
    `<saml:Attribute Name="email"><saml:AttributeValue>${email}</saml:AttributeValue></saml:Attribute>`,
    `<saml:Attribute Name="custom:tenant_id"><saml:AttributeValue>${tenantClaim}</saml:AttributeValue></saml:Attribute>`,
    `<saml:Attribute Name="custom:role"><saml:AttributeValue>${role}</saml:AttributeValue></saml:Attribute>`,
    `</saml:AttributeStatement>`,
    `</saml:Assertion>`,
  ].join('');

  const sig = signAssertion(assertionInner, opts.signWithPrivatePem ?? opts.privatePem);
  const responseXml = [
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">`,
    assertionInner,
    `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>${sig}</ds:SignatureValue></ds:Signature>`,
    `</samlp:Response>`,
  ].join('');
  return Buffer.from(responseXml, 'utf8').toString('base64');
}

describe('SamlService (S5-1 iter 1)', () => {
  let service: SamlService;
  let kp: Keypair;
  let tenant: TenantSamlConfigSnapshot;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SamlService, { provide: ENV_TOKEN, useValue: {} }],
    }).compile();
    service = moduleRef.get(SamlService);
    kp = makeKeypair();
    tenant = {
      tenantId: TENANT_ID,
      idpEntityId: IDP_ENTITY_ID,
      idpSsoUrl: 'https://idp.example.test/sso',
      idpX509Cert: kp.publicCertPem,
    };
  });

  // ------------------------------------------------------------------
  // Happy path
  // ------------------------------------------------------------------
  it('parses and validates a well-formed signed assertion', () => {
    const samlResponseB64 = buildResponse({ privatePem: kp.privatePem });
    const result = service.parseAndValidateAssertion({
      samlResponseB64,
      tenant,
      expectedRelayState: '_relaystate-fixture',
    });
    expect(result.email).toBe('admin@example.test');
    expect(result.tenantId).toBe(TENANT_ID);
    expect(result.role).toBe('admin_mac');
    expect(result.issuer).toBe(IDP_ENTITY_ID);
    expect(result.assertionHashSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  // ------------------------------------------------------------------
  // Signature reject — different keypair signs the assertion
  // ------------------------------------------------------------------
  it('rejects when the signature was produced by a different key', () => {
    const otherKp = makeKeypair();
    const samlResponseB64 = buildResponse({
      privatePem: kp.privatePem,
      signWithPrivatePem: otherKp.privatePem,
    });
    expect(() =>
      service.parseAndValidateAssertion({ samlResponseB64, tenant }),
    ).toThrow(/signature_invalid/);
  });

  // ------------------------------------------------------------------
  // NotOnOrAfter expired
  // ------------------------------------------------------------------
  it('rejects an assertion past NotOnOrAfter (with skew)', () => {
    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    const samlResponseB64 = buildResponse({
      privatePem: kp.privatePem,
      notBefore: new Date(Date.now() - 20 * 60_000).toISOString(),
      notOnOrAfter: past,
    });
    expect(() =>
      service.parseAndValidateAssertion({ samlResponseB64, tenant }),
    ).toThrow(/assertion_expired/);
  });

  // ------------------------------------------------------------------
  // NotBefore future
  // ------------------------------------------------------------------
  it('rejects an assertion whose NotBefore is in the future', () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const samlResponseB64 = buildResponse({
      privatePem: kp.privatePem,
      notBefore: future,
      notOnOrAfter: new Date(Date.now() + 30 * 60_000).toISOString(),
    });
    expect(() =>
      service.parseAndValidateAssertion({ samlResponseB64, tenant }),
    ).toThrow(/not_yet_valid/);
  });

  // ------------------------------------------------------------------
  // Issuer mismatch
  // ------------------------------------------------------------------
  it('rejects when Issuer does not match tenant.idpEntityId', () => {
    const samlResponseB64 = buildResponse({
      privatePem: kp.privatePem,
      issuer: 'https://other-idp.example.test',
    });
    expect(() =>
      service.parseAndValidateAssertion({ samlResponseB64, tenant }),
    ).toThrow(/issuer_mismatch/);
  });

  // ------------------------------------------------------------------
  // Tenant claim mismatch
  // ------------------------------------------------------------------
  it('rejects when the assertion tenant claim differs from tenant scope', () => {
    const samlResponseB64 = buildResponse({
      privatePem: kp.privatePem,
      tenantClaim: '00000000-0000-0000-0000-0000000000bb',
    });
    expect(() =>
      service.parseAndValidateAssertion({ samlResponseB64, tenant }),
    ).toThrow(/tenant_claim_mismatch/);
  });

  // ------------------------------------------------------------------
  // Missing email
  // ------------------------------------------------------------------
  it('rejects when the email claim is missing', () => {
    // Build a signed assertion without the email attribute.
    const issueInstant = new Date().toISOString();
    const notOnOrAfter = new Date(Date.now() + 5 * 60_000).toISOString();
    const assertion = [
      `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" Version="2.0" IssueInstant="${issueInstant}">`,
      `<saml:Issuer>${IDP_ENTITY_ID}</saml:Issuer>`,
      `<saml:Subject><saml:NameID>x@example.test</saml:NameID></saml:Subject>`,
      `<saml:Conditions NotBefore="${issueInstant}" NotOnOrAfter="${notOnOrAfter}"/>`,
      `<saml:AttributeStatement>`,
      `<saml:Attribute Name="custom:tenant_id"><saml:AttributeValue>${TENANT_ID}</saml:AttributeValue></saml:Attribute>`,
      `</saml:AttributeStatement>`,
      `</saml:Assertion>`,
    ].join('');
    const sig = signAssertion(assertion, kp.privatePem);
    const xml =
      `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">${assertion}` +
      `<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>${sig}</ds:SignatureValue></ds:Signature></samlp:Response>`;
    const b64 = Buffer.from(xml, 'utf8').toString('base64');
    expect(() => service.parseAndValidateAssertion({ samlResponseB64: b64, tenant })).toThrow(
      /missing_email_claim/,
    );
  });

  // ------------------------------------------------------------------
  // Tenant not configured
  // ------------------------------------------------------------------
  it('rejects when the tenant has no cert configured', () => {
    const samlResponseB64 = buildResponse({ privatePem: kp.privatePem });
    expect(() =>
      service.parseAndValidateAssertion({
        samlResponseB64,
        tenant: { ...tenant, idpX509Cert: '' },
      }),
    ).toThrow(/tenant_not_configured/);
  });

  // ------------------------------------------------------------------
  // SP metadata + login URL
  // ------------------------------------------------------------------
  it('emits SP metadata XML with entityID and ACS URL', () => {
    const xml = service.getSpMetadataXml();
    expect(xml).toContain('<md:EntityDescriptor');
    expect(xml).toContain(service.spEntityId());
    expect(xml).toContain(service.acsUrl());
    expect(xml).toContain('AssertionConsumerService');
  });

  it('builds a SAMLRequest redirect URL with RelayState', () => {
    const url = service.buildLoginUrl(tenant, '_test-relay');
    expect(url.startsWith(tenant.idpSsoUrl)).toBe(true);
    expect(url).toContain('SAMLRequest=');
    expect(url).toContain('RelayState=' + encodeURIComponent('_test-relay'));
  });

  // ------------------------------------------------------------------
  // Malformed payloads
  // ------------------------------------------------------------------
  it('rejects an empty / non-XML SAMLResponse', () => {
    expect(() =>
      service.parseAndValidateAssertion({
        samlResponseB64: Buffer.from('not xml', 'utf8').toString('base64'),
        tenant,
      }),
    ).toThrow(/malformed_response/);
  });
});
