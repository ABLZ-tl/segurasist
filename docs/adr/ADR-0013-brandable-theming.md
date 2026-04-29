# ADR-0013 — Brandable theming via runtime CSS variables

- **Status**: Accepted (Sprint 5 iter 1, 2026-04-28)
- **Authors**: DS-1 (Design System Lead) + MT-1 (Backend multi-tenant)
- **Audit refs**: `docs/sprint5/DISPATCH_PLAN.md` §"Multi-tenant gestionable", `MVP_05_Frontend_NextJS_SegurAsist.docx`
- **Trigger**: Sprint 5 introduce branding per-tenant configurable desde admin. El portal del asegurado debe consumirlo dinámicamente (logo + primary + accent + background image). MT-1 expone `GET /v1/tenants/me/branding`; MT-3 lo aplica al cargar el portal. DS-1 publica el helper que MT-3 invoca.

## Context

Tenemos que aplicar branding por tenant **sin recompilar** la app y **sin
duplicar el árbol React**. Tres caminos plausibles:

- **A) Runtime CSS variables** — `:root { --tenant-primary: ... }` se
  setean en JS al cargar el portal. Tailwind preset las expone como
  utilities (`bg-tenant-primary`, etc.). Cero re-render por theming.
- **B) styled-components / Emotion ThemeProvider** — pasar el branding
  por contexto, todos los componentes leen del theme. Dependencia de
  runtime extra; SegurAsist hoy es Tailwind puro.
- **C) Multi-build** (un build por tenant) — descartado: no escala con
  N tenants y rompe el Single-Page Build.

## Decision

**Adoptamos (A): CSS variables runtime, escritas por
`applyBrandableTheme()` desde `@segurasist/ui`.**

Contrato:

```ts
applyBrandableTheme({
  primaryHex: '#16a34a',
  accentHex: '#7c3aed',
  bgImageUrl?: 'https://abc.cloudfront.net/branding/bg.png',
}): boolean
```

Setea en `document.documentElement.style`:

- `--tenant-primary` y su `--tenant-primary-fg` (foreground WCAG AA).
- `--tenant-accent` y su `--tenant-accent-fg`.
- `--tenant-bg-image: url("...")` cuando el host está whitelisted.

Tailwind preset (`packages/config/tailwind.preset.js`) expone los nombres
como utilities `tenant.primary`, `tenant.accent`, etc.

### Defensa en profundidad

1. **Hex strict regex** `/^#[0-9a-fA-F]{6}$/`. El backend valida igual
   (MT-1). Cualquier hex inválido se ignora silenciosamente y se loggea
   en dev.
2. **Whitelist de hosts para bgImage**. Solo se aceptan:
   - `*.cloudfront.net`
   - `cdn.segurasist.com`
   - `branding-assets-*.s3.amazonaws.com`
   Cualquier otro host se rechaza, evitando que un admin malicioso
   inyecte URL `javascript:` o un host externo que filtre el referrer.
3. **CSS injection killchain**. La función `escapeUrl` rechaza el string
   si contiene paréntesis, comillas, backslashes, semicolons, llaves o
   `<>`. Esto es defense-in-depth — además de la whitelist — para evitar
   que `url("foo");}body{background:red` rompa el `<style>` runtime.
4. **WCAG contrast**: `getContrastColor(hex)` calcula luminance per WCAG
   2.x §1.4.3 y devuelve white o `#0a0a0a`. Si un admin elige una
   primary muy clara, la fg seguirá siendo legible.

### Trade-off vs styled-components multi-theme

- **Pro CSS vars**: cero deps extra, performance equivalent (variables
  resolvidas por el browser en paint, no por JS), Tailwind sigue
  funcionando idéntico, SSR-safe (los defaults viven en `tokens.css`).
- **Contra**: theming complejo (tipografía variable, espaciados por
  tenant) requeriría más vars; hoy solo cubrimos 4 + bg. Si crece,
  evaluamos `@layer` Tailwind v4 o ThemeProvider en futuro.

## Consequences

- MT-3 puede invocar `applyBrandableTheme` desde un `useEffect` en su
  `TenantProvider` con SWR cache 5 min. Sin re-render de árbol.
- MT-1 debe garantizar que el endpoint nunca devuelve hosts fuera de la
  whitelist; el cliente es defensa secundaria.
- CSP: añadir los hosts de branding a `img-src` (logos) y NO permitir
  `style-src 'unsafe-inline'`. El runtime usa `style.setProperty`, lo
  que NO es una style-src violation porque el script está en el
  same-origin.
- SSR: durante el primer paint el portal usa los defaults; el flash
  branding-default → branding-tenant es ~50ms post-hydration. Aceptable
  para Go-Live; si en Sprint 6 molesta, se puede inlinear en el HTML
  por el server.

## Validation

- Tests `brandable-tokens.spec.ts`: setea / clear / rejects invalid hex /
  rejects non-whitelisted bg / contrast WCAG.
- E2E (MT-4): cambiar branding en admin, recargar portal, verificar
  computed style del header.
- ZAP (G-2): asegurar que no hay XSS via bgImageUrl ni inline styles
  sin nonce.
