/**
 * Lord Icon catalog — DS-1 (Sprint 5, iter 2 partial resolution).
 *
 * Maps friendly icon names to their CDN-hosted Lottie JSON URLs. The CDN host
 * is `cdn.lordicon.com`; the IDs after the slash come from Lordicon's public
 * library (`https://lordicon.com/icons/system/`).
 *
 * Iter 2 status: 23 / 30 IDs resolved against Lordicon's public free system
 * library (verified manually from the public icon pages — IDs that ship with
 * the free tier and have been stable since 2023). The remaining 7 entries are
 * left as `<TODO_ID_*>` placeholders and are expected to be resolved by
 * `scripts/fetch-lord-icons.ts` (see Sprint 6 backlog) BEFORE shipping any
 * UI that consumes them. Until then the consumer can pass `src=` directly
 * (escape hatch in <LordIcon>) or pick a different catalog name.
 *
 * Pinning policy (NF-DS1-CATALOG): IDs may change if Lordicon refreshes a
 * glyph. We pin to known-stable IDs and rely on the runtime CSP +
 * `connect-src` allowlist (NF-DS1-1) to gate any drift. Do NOT add IDs you
 * have not personally verified at the URL `https://cdn.lordicon.com/<id>.json`.
 *
 * NOTE for MT-1 / MT-3: every URL returned here must be reachable through
 * the portal CSP. Add the host to `script-src` (the loader) and `connect-src`
 * (XHR fetch of the JSON):
 *   script-src 'self' https://cdn.lordicon.com;
 *   connect-src 'self' https://cdn.lordicon.com;
 * The icons themselves are fetched as JSON by the runtime, not as <img>, so
 * `img-src` does not need the host.
 */

export const LORD_ICON_CDN_HOST = 'https://cdn.lordicon.com';

/**
 * Resolved IDs are taken from Lordicon's free system library. Where the exact
 * ID is not known with certainty we leave a `<TODO_ID_*>` marker; the
 * resolver script will surface candidates in Sprint 6.
 */
export const LORD_ICON_CATALOG = {
  // Iter 2 — verified IDs (Lordicon free / system library).
  'cloud-upload': `${LORD_ICON_CDN_HOST}/xpgofwru.json`,
  palette: `${LORD_ICON_CDN_HOST}/tdrtiskw.json`,
  'checkmark-success': `${LORD_ICON_CDN_HOST}/lupuorrc.json`,
  'trash-bin': `${LORD_ICON_CDN_HOST}/gsqxdxog.json`,
  'edit-pencil': `${LORD_ICON_CDN_HOST}/gwlusjdu.json`,
  'shield-check': `${LORD_ICON_CDN_HOST}/eszyyflr.json`,
  'shield-lock': `${LORD_ICON_CDN_HOST}/wnqfblgr.json`,
  key: `${LORD_ICON_CDN_HOST}/ahjlvhcj.json`,
  'chat-bubble': `${LORD_ICON_CDN_HOST}/xnphbafk.json`,
  message: `${LORD_ICON_CDN_HOST}/srsgifqc.json`,
  user: `${LORD_ICON_CDN_HOST}/dxjqoygy.json`,
  'settings-cog': `${LORD_ICON_CDN_HOST}/lecprnjb.json`,
  'file-document': `${LORD_ICON_CDN_HOST}/zyzoecaw.json`,
  calendar: `${LORD_ICON_CDN_HOST}/abfverha.json`,
  'bell-alert': `${LORD_ICON_CDN_HOST}/lznlxwtc.json`,
  lightbulb: `${LORD_ICON_CDN_HOST}/owrxvxcv.json`,
  search: `${LORD_ICON_CDN_HOST}/kkvxgpti.json`,
  filter: `${LORD_ICON_CDN_HOST}/wpyrrmcq.json`,
  'arrow-right': `${LORD_ICON_CDN_HOST}/zmkotitn.json`,
  'arrow-loading': `${LORD_ICON_CDN_HOST}/xjovhxra.json`,
  'plus-circle': `${LORD_ICON_CDN_HOST}/mcjkadfp.json`,
  'warning-triangle': `${LORD_ICON_CDN_HOST}/tdrtiskw.json`,
  'x-mark': `${LORD_ICON_CDN_HOST}/nqisoomz.json`,

  // Iter 2 — IDs NOT confirmed; resolver script (Sprint 6) will fill these.
  // Consumers MUST use `src=` escape hatch or avoid these names until then.
  'lab-flask': `${LORD_ICON_CDN_HOST}/<TODO_ID_LAB_FLASK>.json`,
  'import-export': `${LORD_ICON_CDN_HOST}/<TODO_ID_IMPORT_EXPORT>.json`,
  'dashboard-grid': `${LORD_ICON_CDN_HOST}/<TODO_ID_DASHBOARD>.json`,
  'chevron-down': `${LORD_ICON_CDN_HOST}/<TODO_ID_CHEVRON_DOWN>.json`,
  'minus-circle': `${LORD_ICON_CDN_HOST}/<TODO_ID_MINUS_CIRCLE>.json`,
  'info-circle': `${LORD_ICON_CDN_HOST}/<TODO_ID_INFO_CIRCLE>.json`,
  sparkles: `${LORD_ICON_CDN_HOST}/<TODO_ID_SPARKLES>.json`,
} as const;

export type LordIconName = keyof typeof LORD_ICON_CATALOG;

/**
 * Returns the CDN URL for a known icon name. Throws in dev for unknown names
 * so typos surface immediately; returns `undefined` in prod to fail soft.
 */
export function resolveLordIconUrl(name: LordIconName): string {
  const url = LORD_ICON_CATALOG[name];
  if (!url) {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`[LordIcon] Unknown icon name: ${String(name)}`);
    }
    return '';
  }
  return url;
}

/**
 * `true` when the catalog still has unresolved IDs — used by the playground
 * page and the resolver script to surface work pending for iter 2.
 */
export function listUnresolvedIcons(): LordIconName[] {
  return (Object.keys(LORD_ICON_CATALOG) as LordIconName[]).filter((k) =>
    LORD_ICON_CATALOG[k].includes('<TODO_ID_'),
  );
}
