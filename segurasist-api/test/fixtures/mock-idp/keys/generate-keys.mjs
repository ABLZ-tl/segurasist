#!/usr/bin/env node
/**
 * Mock IdP keypair generator — S5-1 Sprint 5 iter 2.
 *
 * Generates an RSA 2048 keypair into `idp-private.pem` / `idp-public.pem`
 * (and `.local.pem` mirrors that match the gitignore rule). Idempotent:
 * if the files already exist, exits 0 without overwriting.
 *
 * SECURITY:
 *   - This keypair is for test fixtures ONLY. NEVER use it in production.
 *   - Anyone reading the repo can derive equivalent keys; do NOT trust an
 *     assertion signed with these keys outside the CI/test environment.
 *   - The `.gitignore` next to this script keeps the generated PEMs out of
 *     version control even if they end up on a developer's disk.
 *
 * Usage:
 *   node test/fixtures/mock-idp/keys/generate-keys.mjs
 *   # or, on the fly from a Jest beforeAll: import('./generate-keys.mjs')
 */
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function ensureKeypair() {
  const priv = join(__dirname, 'idp-private.pem');
  const pub = join(__dirname, 'idp-public.pem');
  const privLocal = join(__dirname, 'idp-private.local.pem');
  const pubLocal = join(__dirname, 'idp-public.local.pem');

  if (existsSync(priv) && existsSync(pub)) {
    return { privatePath: priv, publicPath: pub, regenerated: false };
  }

  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

  // Write both the canonical names (in .gitignore) and the .local mirror
  // so callers that grep for either suffix find them.
  writeFileSync(priv, privatePem, { mode: 0o600 });
  writeFileSync(pub, publicPem, { mode: 0o644 });
  writeFileSync(privLocal, privatePem, { mode: 0o600 });
  writeFileSync(pubLocal, publicPem, { mode: 0o644 });

  return { privatePath: priv, publicPath: pub, regenerated: true };
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = ensureKeypair();
  if (result.regenerated) {
    console.log(`[mock-idp] Generated fresh keypair at ${result.privatePath}`);
  } else {
    console.log(`[mock-idp] Keypair already present at ${result.privatePath}`);
  }
}
