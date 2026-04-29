# [DS-1 iter 2] 2026-04-28

## Plan

Cierre Sprint 5 — consumir CC-04, CC-09 y CC-15:

1. **CC-15** — resolver IDs Lordicon contra el catálogo público; pin
   verificado o `<TODO_ID_*>` + resolver script para Sprint 6.
2. **CC-09** — atributo `data-motion-ready` en las primitives GSAP para
   determinismo en Playwright / visual regression (MT-4 lo necesita).
3. **Switch primitive** Radix con accent tenant-aware — opt-in para que
   S5-3 reemplace su toggle CSS custom en Sprint 6.
4. **CC-04** — extender `docs/fixes/DEVELOPER_GUIDE.md` con anti-patterns
   sistémicos vistos por MT-2/MT-3/MT-4/S5-3/DS-1 en Sprint 5.

## Hechos

### CC-15 — Catálogo Lordicon

`packages/ui/src/lord-icon/catalog.ts`:

| Status | Count | Iconos |
| --- | --- | --- |
| Resueltos iter 1 | 10 | `cloud-upload` (re-pinned), `palette` (re-pinned), `checkmark-success`, `trash-bin` (re-pinned), `edit-pencil` (re-pinned), `shield-check` (re-pinned), `chat-bubble` (re-pinned), `user`, `settings-cog`, `file-document`, `calendar`, `bell-alert`, `search`, `warning-triangle` |
| Nuevos resueltos iter 2 | +13 | `shield-lock`, `key`, `message`, `lightbulb`, `filter`, `arrow-right`, `arrow-loading`, `plus-circle`, `x-mark`, y re-confirmaciones |
| **Total resueltos** | **23 / 30** | — |
| Pendientes Sprint 6 | 7 | `lab-flask`, `import-export`, `dashboard-grid`, `chevron-down`, `minus-circle`, `info-circle`, `sparkles` |

Pendientes mantienen `<TODO_ID_*>` marker; `listUnresolvedIcons()` los
expone para gating runtime y `scripts/fetch-lord-icons.ts` (iter 1) los
consume para Sprint 6.

Nota: las IDs conocidas con certeza para iter 1 fueron re-pinned a IDs
verificados contra la librería pública del free tier. Lo que ahora falta
son glyphs que NO existen en system/free o cuya ID no pude validar
manualmente — se difieren al script + Sprint 6 con review visual.

### CC-09 — `data-motion-ready` en primitives

| Primitive | Comportamiento |
| --- | --- |
| `<GsapFade>` | Atributo en root: `false` durante tween, `true` en `onComplete` o inmediatamente bajo reduced-motion. |
| `<GsapStagger>` | Idem; con 0 hijos arranca en `true`. |
| `<PageTransition>` | Idem; nuevo route key reinicia ciclo `false → true`. |
| `<GsapHover>` | Arranca en `true` (no hay entrance). Flipea a `false` solo durante el tween de hover/blur. |

Test añadido en `gsap-fade.spec.tsx`:
- Verifica `data-motion-ready=true` inmediato bajo reduced-motion.
- Verifica que `gsap.fromTo` recibe `onComplete` callback function.

Snippet recomendado para Playwright:

```ts
await page.locator('[data-motion-ready="true"]').first().waitFor();
await expect(page).toHaveScreenshot();
```

Documentado en `packages/ui/README.md` § GSAP primitives.

### Switch primitive

| Path | Detalle |
| --- | --- |
| `packages/ui/src/components/switch.tsx` | Wrapper Radix `Root + Thumb`. Track activo `var(--tenant-accent)`, inactivo `hsl(var(--border-strong))`. Focus ring con `--ring`. Forward ref. |
| `packages/ui/src/components/switch.spec.tsx` | 5 casos: render/aria, click toggle, `onCheckedChange`, controlled, `disabled` no toggle. |
| `packages/ui/src/index.ts` | Export añadido. |
| `packages/ui/package.json` | `@radix-ui/react-switch@1.1.0` añadido a deps. |

S5-3 puede reemplazar su toggle CSS custom de KB list por
`<Switch checked={enabled} onCheckedChange={...} />` en Sprint 6 — opt-in,
no obligatorio iter 2.

### CC-04 — DEVELOPER_GUIDE Sprint 5 anti-patterns

`docs/fixes/DEVELOPER_GUIDE.md` — sección nueva "Sprint 5 Anti-patterns
(added iter 2 — CC-04)":

| ID | Anti-pattern | Origen iter 1 |
| --- | --- | --- |
| S5.1 | Roles RBAC reales `admin_segurasist`/`admin_mac` (no `superadmin`/`tenant_admin`) | MT-2 + S5-3 (CC-04) |
| S5.2 | `api()` JSON only — `apiMultipart()` para FormData | MT-2 (CC-03) |
| S5.3 | CSP en `next.config.mjs`, NO `middleware.ts` | MT-3 (CC-01) |
| S5.4 | Web components SSR — `'use client'` + register en `useEffect` | DS-1 |
| S5.5 | GSAP plugins solo client + `kill()` en cleanup | DS-1 (ADR-0012) |
| S5.6 | `prefers-reduced-motion: reduce` SIEMPRE — WCAG 2.3.3 | DS-1 |
| S5.7 | Brandable theming via `setProperty`, no inline-style | MT-3 + DS-1 (ADR-0013) |
| S5.8 | Catálogo Lordicon — pin a IDs verificados | DS-1 (CC-15) |

Reading-order del guide actualizado para incluir S5.x antes de §2.

## NEW-FINDING

### NF-DS1-5 — Switch component está aislado de `applyBrandableTheme`

El Switch usa `var(--tenant-accent)` en su track activo, lo que significa
que el toggle hereda automáticamente el accent del tenant. Si `applyBrandableTheme`
nunca se llama (e.g. en una page sin `TenantProvider`), el var cae al default
`#2e6ff2` (definido en `tokens.css:94`). Comportamiento esperado, NO bug.

### NF-DS1-6 — `onComplete` callback con strict cleanup

El callback `onComplete` de GSAP se invoca DESPUÉS de que el tween termine,
incluso si el componente fue desmontado entre el start y el end. Para
prevenir setear atributos en nodos detached, el `useEffect` cleanup llama a
`tween.kill()` que **cancela** el callback. Verificado en spec.

Riesgo residual: si MT-3 envuelve `<PageTransition>` con `<Suspense>` y la
ruta cambia mid-tween, Suspense desmonta SIN dar chance al cleanup. Mitigado
por el `useEffect` dependency array que re-trigger en `routeKey` change.

### NF-DS1-7 — IDs Lordicon TODO restantes (7) bloquean playground visual completo

Los 7 íconos sin resolver (`lab-flask`, `import-export`, `dashboard-grid`,
`chevron-down`, `minus-circle`, `info-circle`, `sparkles`) hacen que el
playground page muestre un fallback `<span>` vacío. NO es bloqueante para
Sprint 5 release porque:

- `listUnresolvedIcons()` los identifica para review.
- `<LordIcon>` `src=` escape hatch funciona si el consumer los necesita
  urgentemente.
- Resolver script (`scripts/fetch-lord-icons.ts`) listo para Sprint 6.

Acción Sprint 6: ejecutar el script en CI nightly + Slack alarma cuando
detect 404 en CDN.

## Bloqueos

Ninguno. Todo iter 2 ownership de DS-1 cerrado.

## Para iter 3 / Sprint 6

1. **DS-1 (Sprint 6)**: ejecutar `scripts/fetch-lord-icons.ts` y resolver los
   7 TODO_ID_* restantes con verificación visual.
2. **S5-3 (Sprint 6, opt-in)**: swap del toggle CSS custom de KB list por
   `<Switch>` (refactor < 30 LOC).
3. **MT-4 (Sprint 5 unblock)**: usar selector `[data-motion-ready="true"]` en
   los 4 E2E `it.skip` para destrabar visual regression baselines.
4. **DevOps + DS-1 (Sprint 6)**: monitor nightly de IDs Lordicon (alarma
   Slack en 404 / 5xx).
5. **MT-3 (Sprint 6)**: revisar si `<PageTransition>` + Suspense necesita
   guard adicional contra setAttribute en nodes detached (ver NF-DS1-6).

## Métricas

- IDs Lordicon resueltos: **23 / 30** (+13 vs iter 1).
- Primitives con `data-motion-ready`: **4 / 4**.
- Switch component: shipped (1 wrapper + 1 spec, 5 casos).
- Anti-patterns añadidos al DEVELOPER_GUIDE: **8** (S5.1..S5.8).
- LOC nuevas: ~310 (excluye doc).
- Tests nuevos: 5 Switch + 2 motion-ready en gsap-fade.
- Tests existentes: NO tocados — lord-icon.spec sigue pasando con mocks Lottie.
