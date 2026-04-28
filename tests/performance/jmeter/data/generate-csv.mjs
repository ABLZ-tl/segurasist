#!/usr/bin/env node
// Sprint 4 — S4-10. Generador determinista de fixtures para JMeter.
// Sintetiza 1000 CURPs portal + 100 admins. Determinista (seed fija) para
// reproducibilidad. NO usar en producción: estos CURPs son sintéticos
// (RENAPO no los reconoce); los admins son seed staging.
//
// Uso:  node generate-csv.mjs
// Output:
//   - insureds.csv  (1000 filas)
//   - admins.csv    (100 filas)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// xorshift32 determinista
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGIT = '0123456789';
function pick(s, r, n) {
  let out = '';
  for (let i = 0; i < n; i++) out += s[Math.floor(r() * s.length)];
  return out;
}
function fakeCurp(r) {
  return (
    pick(ALPHA, r, 4) +
    pick(DIGIT, r, 6) +
    (r() < 0.5 ? 'H' : 'M') +
    pick(ALPHA, r, 5) +
    pick(DIGIT, r, 2)
  );
}

const r = rng(42);
const insuredsLines = ['curp,otp_code'];
for (let i = 0; i < 1000; i++) insuredsLines.push(`${fakeCurp(r)},000000`);
writeFileSync(join(here, 'insureds.csv'), insuredsLines.join('\n') + '\n');

const r2 = rng(7);
const adminsLines = ['email,password,target_curp,target_insured_id'];
for (let i = 0; i < 100; i++) {
  const idx = String(i).padStart(3, '0');
  adminsLines.push(
    `perf-admin-${idx}@staging.segurasist.local,Perf!Test#2026,${fakeCurp(r2)},insured-perf-${idx}`,
  );
}
writeFileSync(join(here, 'admins.csv'), adminsLines.join('\n') + '\n');

console.log('insureds.csv: 1000 filas');
console.log('admins.csv: 100 filas');
