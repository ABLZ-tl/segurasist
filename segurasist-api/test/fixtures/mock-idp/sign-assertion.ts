/**
 * Mock IdP — assertion signer (S5-1 Sprint 5 iter 2).
 *
 * Takes the template at `assertion-template.xml`, substitutes
 * placeholders, signs the inner `<saml:Assertion>` element with the
 * fixture private key (RSA-SHA256 — same algorithm `SamlService.verifySignature`
 * checks), and returns the **base64-encoded `<samlp:Response>`** that an
 * E2E test can POST to `/v1/auth/saml/acs` as the `SAMLResponse` form
 * field.
 *
 * SECURITY:
 *   - This helper is `import`-able ONLY from `test/**`. There is no
 *     production caller.
 *   - The private key is read from disk — `keys/generate-keys.mjs` makes
 *     sure the fixture exists before `signAssertion(...)` runs.
 *   - We never log the assertion XML; the test asserts on the response
 *     shape from the controller, not on the bytes we sent.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

// CommonJS — tsconfig.module = "commonjs". `__dirname` is the Node global.

export interface SignAssertionInput {
  /**
   * Map of `{{placeholder}}` → value. The template ships these slots:
   *   tenantId, email, role, nameId, issuer, notBefore, notOnOrAfter,
   *   inResponseTo.
   * Any extra keys are interpolated literally.
   */
  values: Record<string, string>;
  /**
   * Optional override for the path to `assertion-template.xml`. Defaults
   * to the sibling file in this directory.
   */
  templatePath?: string;
  /**
   * Optional override for the private key. Defaults to
   * `keys/idp-private.pem`. The caller is responsible for ensuring the
   * file exists (call `ensureKeypair()` from `keys/generate-keys.mjs`
   * in a `beforeAll`).
   */
  privateKeyPath?: string;
}

/**
 * Returns the base64 of the full `<samlp:Response>` element with the
 * placeholders substituted and `<ds:SignatureValue>` filled with an
 * RSA-SHA256 signature over the canonical `<saml:Assertion>` block.
 */
export function signAssertion(input: SignAssertionInput): string {
  const templatePath = input.templatePath ?? join(__dirname, 'assertion-template.xml');
  const privateKeyPath = input.privateKeyPath ?? join(__dirname, 'keys', 'idp-private.pem');

  const rawTemplate = readFileSync(resolvePath(templatePath), 'utf8');
  const privatePem = readFileSync(resolvePath(privateKeyPath), 'utf8');

  // 1) Substitute every placeholder EXCEPT the signature one.
  let xml = rawTemplate;
  for (const [k, v] of Object.entries(input.values)) {
    xml = xml.split(`{{${k}}}`).join(escapeXml(v));
  }

  // 2) Extract the `<saml:Assertion>...</saml:Assertion>` block. We sign
  //    the bytes of THIS block — same canonicalization the SP uses when
  //    it pulls the assertion via the `pickFirst(/Assertion/)` regex in
  //    `SamlService.verifySignature`. Iter 3 swaps to xml-c14n.
  const assertionMatch = xml.match(/<saml:Assertion[\s\S]*?<\/saml:Assertion>/);
  if (!assertionMatch) {
    throw new Error('mock-idp: template missing <saml:Assertion> block');
  }
  const assertionXml = assertionMatch[0];

  // 3) Sign the assertion bytes with the fixture private key.
  const signer = createSign('RSA-SHA256');
  signer.update(assertionXml, 'utf8');
  signer.end();
  const signatureB64 = signer.sign(privatePem, 'base64');

  // 4) Inject the signature into the `<ds:SignatureValue>` placeholder.
  const finalXml = xml.split('{{signatureValue}}').join(signatureB64);

  // 5) Strip the leading XML declaration line if present (the SP is
  //    tolerant either way) and base64-encode the response.
  return Buffer.from(finalXml, 'utf8').toString('base64');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
