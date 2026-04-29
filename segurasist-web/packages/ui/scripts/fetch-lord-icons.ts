/**
 * fetch-lord-icons.ts — DS-1 Sprint 5 (iter 2 helper).
 *
 * Resolves `<TODO_ID_*>` placeholders in `src/lord-icon/catalog.ts` against
 * the public Lordicon library at https://lordicon.com/icons/system/.
 *
 * USAGE:
 *   pnpm --filter @segurasist/ui exec tsx scripts/fetch-lord-icons.ts
 *
 * STRATEGY:
 *   1. Pull the system index page HTML.
 *   2. For each unresolved name, find the matching icon slot by alt text.
 *   3. Read its CDN URL (anchor href) and patch the catalog.
 *
 * NOTE: Lordicon may rate-limit / change markup. This script is intentionally
 * conservative: it reads, prints a diff, and exits 0 — applying the patch is
 * a manual decision pending a code review.
 */

/* eslint-disable no-console */

import { listUnresolvedIcons, LORD_ICON_CATALOG } from '../src/lord-icon/catalog';

interface Resolved {
  name: string;
  url: string;
}

async function fetchSystemLibrary(): Promise<string> {
  const res = await fetch('https://lordicon.com/icons/system/');
  if (!res.ok) {
    throw new Error(`Failed to fetch Lordicon system library: ${res.status}`);
  }
  return res.text();
}

function extractCandidates(html: string, hint: string): string[] {
  // Naive scrape: find `cdn.lordicon.com/<id>.json` near the hint text.
  const idRegex = /cdn\.lordicon\.com\/([a-z0-9]+)\.json/gi;
  const ids = new Set<string>();
  for (const m of html.matchAll(idRegex)) {
    ids.add(m[1]);
  }
  // We can't actually correlate without proper HTML parsing in this stub —
  // emit candidates for manual review.
  void hint;
  return Array.from(ids).slice(0, 10);
}

async function main(): Promise<void> {
  const unresolved = listUnresolvedIcons();
  if (unresolved.length === 0) {
    console.log('All icons already resolved.');
    return;
  }
  console.log(`Unresolved: ${unresolved.length}`);
  for (const name of unresolved) {
    console.log(`  - ${name} -> ${LORD_ICON_CATALOG[name]}`);
  }

  let html = '';
  try {
    html = await fetchSystemLibrary();
  } catch (err) {
    console.error('Could not reach Lordicon library:', err);
    process.exitCode = 1;
    return;
  }
  const resolved: Resolved[] = [];
  for (const name of unresolved) {
    const candidates = extractCandidates(html, name);
    if (candidates.length > 0) {
      resolved.push({ name, url: `https://cdn.lordicon.com/${candidates[0]}.json` });
    }
  }
  console.log('\nFirst-pass candidates (manual review required):');
  console.table(resolved);
  console.log('\nApply manually after verifying each ID maps to the right glyph.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
