# [DS-1 iter 1] 2026-04-28

## Plan

Publicar la API que MT-2, MT-3 y S5-3 consumen en iter 2:

1. `<LordIcon>` SSR-safe con catálogo de 30 íconos (algunos con TODO_ID).
2. Primitives GSAP: `<GsapFade>`, `<GsapStagger>`, `<PageTransition>`,
   `<GsapHover>`, hook `useGsap`, hook `usePrefersReducedMotion`.
3. `applyBrandableTheme({primaryHex, accentHex, bgImageUrl})` +
   `getContrastColor` + `escapeUrl` whitelisted + `clearBrandableTheme`.
4. ADRs 0012 (motion design GSAP) + 0013 (brandable theming).
5. UAT script (10 escenarios) y Code Freeze checklist.
6. Playground page exportado por `@segurasist/ui`, montado en admin
   `/dev/ui-playground` con env-gate.

## Hechos

### Componentes publicados

| Path | Export | Consumer |
| --- | --- | --- |
| `packages/ui/src/lord-icon/lord-icon.tsx` | `<LordIcon>` | MT-2 / MT-3 / S5-3 |
| `packages/ui/src/lord-icon/catalog.ts` | `LORD_ICON_CATALOG`, `resolveLordIconUrl`, `listUnresolvedIcons` | iter 2 resolver |
| `packages/ui/src/animations/gsap-fade.tsx` | `<GsapFade>` | MT-2 / MT-3 / S5-3 |
| `packages/ui/src/animations/gsap-stagger.tsx` | `<GsapStagger>` | MT-2 / MT-3 / S5-3 |
| `packages/ui/src/animations/page-transition.tsx` | `<PageTransition routeKey>` | MT-3 (layout portal) |
| `packages/ui/src/animations/gsap-hover.tsx` | `<GsapHover>` | MT-2 / MT-3 / S5-3 |
| `packages/ui/src/animations/use-gsap.ts` | `useGsap`, `usePrefersReducedMotion`, `gsap` | DS-1 internals + escape hatch |
| `packages/ui/src/theme/brandable-tokens.ts` | `applyBrandableTheme`, `clearBrandableTheme`, `getContrastColor`, `escapeUrl`, `isValidHex` | MT-3 (TenantProvider) |
| `packages/ui/src/playground/page.tsx` | `UiPlaygroundPage` | admin `/dev/ui-playground` |

### API contracts (locked iter 1)

```ts
<LordIcon
  name?: LordIconName
  src?: string
  trigger?: 'hover' | 'click' | 'loop' | ...
  colors?: { primary: string; secondary?: string }
  size?: number
  loop?: boolean
  delay?: number
  ariaLabel?: string
  fallback?: ReactNode
/>

<GsapFade duration={0.5} delay={0} y={20} ease="power2.out" />
<GsapStagger staggerDelay={0.1} duration={0.45} y={20} />
<PageTransition routeKey={pathname} duration={0.25} />
<GsapHover scale={1.05} duration={0.2} />

applyBrandableTheme({
  primaryHex: string,    // /^#[0-9a-fA-F]{6}$/
  accentHex: string,
  bgImageUrl?: string    // whitelisted host or rejected silently
}): boolean
```

### Reduced-motion

- Cubierto en TODAS las primitives (`usePrefersReducedMotion` hook).
- Test verde: render con MQ `(prefers-reduced-motion: reduce)` →
  `gsap.set` en lugar de `gsap.fromTo`.

### Tokens y Tailwind

- `tokens.css` añade defaults `--tenant-primary/-fg/-accent/-fg`.
- `packages/config/tailwind.preset.js` extiende
  `colors.tenant.{primary,primary-fg,accent,accent-fg}`.

### Tests añadidos

- `src/lord-icon/lord-icon.spec.tsx` — fallback SSR, ariaLabel, register.
- `src/animations/gsap-fade.spec.tsx` — animate vs reduced-motion, cleanup.
- `src/theme/brandable-tokens.spec.ts` — hex validation, host whitelist,
  CSS-injection rejection, contrast, set/clear vars.

### Deps añadidas (`packages/ui/package.json`)

- `@lordicon/react@1.10.1`
- `lord-icon-element@5.1.0`
- `lottie-web@5.12.2` (peer del web component)
- `gsap@3.12.5` (free, sin plugins pagos)

## NEW-FINDING

### NF-DS1-1 — CSP `script-src` + `connect-src` deben aceptar cdn.lordicon.com

**Owner**: MT-1 (admin CSP) + MT-3 (portal CSP).

`@lordicon/react` y `lord-icon-element` cargan el JSON Lottie via `fetch`
contra `https://cdn.lordicon.com/<id>.json` y dynamic-import del módulo
del web component (mismo bundle, no script externo). Necesitamos:

```
script-src 'self' https://cdn.lordicon.com;
connect-src 'self' https://cdn.lordicon.com;
```

`img-src` no requiere cambio (no usamos `<img>` para Lottie).

### NF-DS1-2 — Catálogo Lordicon con TODO_IDs

20 / 30 íconos del catálogo están marcados `<TODO_ID_*>`. Resolver con
`packages/ui/scripts/fetch-lord-icons.ts` en iter 2 (ejecutar manualmente
y validar visualmente). No bloquea iter 1: el helper soporta `src` como
escape hatch.

### NF-DS1-3 — Whitelist hosts background image

`escapeUrl` whitelist actual:

- `*.cloudfront.net`
- `cdn.segurasist.com`
- `branding-assets-*.s3.amazonaws.com`

Si MT-1 aprovisiona el bucket con otro nombre o usa otra distribución,
debe avisar para sincronizar la whitelist (defensa en profundidad anti
CSS injection).

### NF-DS1-4 — Reduced-motion en CSS global ya existente

`tokens.css` ya tenía bloque `@media (prefers-reduced-motion: reduce)`
que pisa todas las animaciones CSS. Las primitives GSAP NO usan CSS
animations (todo es JS), por lo que no colisiona. Documentado para
evitar que MT-2/MT-3 dupliquen el bloque.

## Bloqueos

Ninguno bloqueante. Ítems pendientes son responsabilidad iter 2.

## Para iter 2 / cross-cutting

1. **Resolver TODO_IDs Lordicon** (DS-1, ~1h con script + verificación
   visual).
2. **Aplicar Lordicons + GSAP en nav admin/portal** — DS-1 puede asistir
   a MT-2/MT-3 si tienen tiempo libre, pero por ownership lo aplican
   ellos.
3. **MT-1 / MT-3 / MT-2**: aplicar CSP changes (NF-DS1-1) en
   `packages/security/src/csp.ts` + per-app middleware.
4. **G-2**: cuando publique baseline real, sustituir `<G-2 TBD>` y
   `TODO` en `docs/qa/UAT_SCRIPT.md` (sección performance).
5. **MT-4 + DS-1**: consolidar `docs/qa/SPRINT5_DOR_DOD.md` con
   referencias a ADR-0012 / 0013.
6. **DS-1**: runbook RB-021 (tenant branding onboarding) coautoría con
   MT-1 + MT-2 — pendiente iter 2.

## Métricas

- Componentes publicados: 8 (LordIcon, GsapFade, GsapStagger,
  PageTransition, GsapHover, useGsap, applyBrandableTheme,
  UiPlaygroundPage).
- Tests añadidos: 3 spec files, ~25 casos.
- LOC nuevas: ~1100 (excluye docs).
- Tests existentes 1222/1222: NO tocados (verificable con
  `pnpm --filter @segurasist/ui test:unit`).
