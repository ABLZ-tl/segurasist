# @segurasist/ui

Design system de SegurAsist. Componentes, tokens, animaciones GSAP, Lordicons
SSR-safe y theming brandable por tenant.

## Quick start

```ts
import { Button, LordIcon, GsapFade, applyBrandableTheme } from '@segurasist/ui';
```

## Lordicons (Sprint 5 — DS-1)

`<LordIcon>` envuelve el web component `lord-icon` registrandolo solo en
cliente (web components NO son SSR-safe). Antes de la hidratación se renderiza
un fallback `<span>` del tamaño exacto, evitando layout shift.

```tsx
import { LordIcon } from '@segurasist/ui';

<LordIcon
  name="cloud-upload"
  trigger="hover"
  colors={{ primary: '#16a34a', secondary: '#7c3aed' }}
  size={48}
  ariaLabel="Subir logo"
/>;
```

Props:

| Prop        | Tipo                           | Default     | Notas                             |
| ----------- | ------------------------------ | ----------- | --------------------------------- |
| `name`      | `LordIconName`                 | —           | Catálogo en `lord-icon/catalog.ts`|
| `src`       | `string`                       | —           | URL Lottie directa (override)     |
| `trigger`   | `'hover' \| 'click' \| 'loop'` | `'hover'`   | Web component triggers oficiales  |
| `colors`    | `{ primary, secondary? }`      | —           | Hex en runtime                    |
| `size`      | `number`                       | `32`        | px (cuadrado)                     |
| `loop`      | `boolean`                      | `false`     |                                   |
| `delay`     | `number`                       | —           | ms                                |
| `ariaLabel` | `string`                       | —           | Si se omite el icono es decorativo|
| `fallback`  | `ReactNode`                    | placeholder | Render mientras hidrata           |

### CSP (responsabilidad MT-1 / MT-3)

Se requiere actualizar la CSP del portal y admin:

```
script-src 'self' https://cdn.lordicon.com;
connect-src 'self' https://cdn.lordicon.com;
```

(El JSON Lottie se obtiene vía `fetch` desde la CDN.)

## GSAP primitives

Todos los componentes respetan `prefers-reduced-motion: reduce` (WCAG 2.3.3).
GSAP carga sólo client-side (los módulos están bajo `'use client'`).

```tsx
import { GsapFade, GsapStagger, PageTransition, GsapHover } from '@segurasist/ui';

<GsapFade duration={0.5} delay={0.1} y={20}>
  <p>Aparezco con fade + slide up.</p>
</GsapFade>;

<GsapStagger staggerDelay={0.08}>
  {items.map((it) => <Card key={it.id} {...it} />)}
</GsapStagger>;

<PageTransition routeKey={pathname}>{children}</PageTransition>;

<GsapHover scale={1.04}>
  <Button>Hover scale</Button>
</GsapHover>;
```

`useGsap({ plugins: [...] })` registra plugins idempotentemente. Para
ScrollTrigger, importarlo desde `gsap/ScrollTrigger` y pasarlo en `plugins`.

### `data-motion-ready` (Sprint 5 iter 2 — CC-09)

Cada primitive (`<GsapFade>`, `<GsapStagger>`, `<PageTransition>`,
`<GsapHover>`) escribe el atributo `data-motion-ready` en su elemento raíz:

- `false` mientras la animación de entrada está corriendo.
- `true` cuando GSAP dispara `onComplete`, **o** inmediatamente si el
  usuario tiene `prefers-reduced-motion: reduce` (WCAG 2.3.3).

Esto permite a Playwright esperar de forma determinística antes de hacer
snapshots o asserts visuales:

```ts
await page.locator('[data-motion-ready="true"]').first().waitFor();
await expect(page).toHaveScreenshot('insureds-list.png');
```

Para `<GsapHover>` el atributo arranca en `true` (no hay animación de
entrada) y solo flipea a `false` durante el tween de hover.

## Switch

Wrapper Radix Switch con accent tenant-aware. Reemplaza toggles CSS
custom (S5-3 KB list usa `data-state` propio; iter 2 puede swappearlo).

```tsx
import { Switch } from '@segurasist/ui';

<Switch
  aria-label="Habilitar artículo"
  checked={article.enabled}
  onCheckedChange={(v) => updateArticle({ id, enabled: v })}
/>;
```

Activo: track `--tenant-accent`. Inactivo: `--border-strong`. Soporta
`disabled`, controlled / uncontrolled, focus visible con `--ring`.

## Brandable theming

```ts
import { applyBrandableTheme, clearBrandableTheme } from '@segurasist/ui';

applyBrandableTheme({
  primaryHex: '#16a34a',
  accentHex: '#7c3aed',
  bgImageUrl: 'https://abc.cloudfront.net/branding/bg.png',
});
```

Setea las variables CSS:

- `--tenant-primary` / `--tenant-primary-fg`
- `--tenant-accent` / `--tenant-accent-fg`
- `--tenant-bg-image`

Tailwind las expone como `tenant.primary`, `tenant.accent`, etc. (ver
`packages/config/tailwind.preset.js`).

`bgImageUrl` se valida contra una whitelist de hosts (CloudFront, S3 branding,
`cdn.segurasist.com`). Cualquier URL fuera de la lista se ignora — defensa
en profundidad contra CSS injection. Hex se valida con `/^#[0-9a-fA-F]{6}$/`.

`getContrastColor(hex)` calcula el foreground (blanco o `#0a0a0a`) según WCAG.

## UI Playground (dev only)

Ruta `/dev/ui-playground` en admin (gated `NODE_ENV !== 'production'`).
Importa `UiPlaygroundPage` desde `@segurasist/ui`. Muestra el catálogo
Lordicon, las primitives GSAP y los color pickers de branding.

## Testing

```bash
pnpm --filter @segurasist/ui test:unit
```

Vitest + jsdom + @testing-library. Coverage thresholds 60/55/60/60 (sin
contar Storybook/index/styles).
