# MT-2 iter 2 — 2026-04-28

## Plan

Cerrar Sprint 5 cross-cutting de MT-2:

1. **CC-21**: eliminar `_stubs.tsx` y consumir `<LordIcon>`, `<GsapFade>`,
   `<GsapStagger>` desde `@segurasist/ui` (DS-1 ya publicado).
2. **CC-03**: exportar `apiMultipart()` global en `@segurasist/api-client`,
   refactorizar `useUploadLogoMutation` para usarlo (eliminar `fetch()`
   directo del bypass iter 1) y dejarlo listo para que S5-3 finisher lo
   reutilice en CSV import.
3. Lordicon `arrow-loading` dentro del botón Guardar cuando `isSubmitting`.
4. 11/11 (en realidad 14/14, ver NEW-FINDING #2) tests del editor verdes.

## Hechos

### Stubs eliminados (CC-21)

- **Eliminado**: `segurasist-web/apps/admin/components/branding-editor/_stubs.tsx`.
- **Swap a `@segurasist/ui`** en:
  - `branding-editor.tsx`: `LordIcon`, `GsapFade`, `GsapStagger` ahora del barrel
    `@segurasist/ui`. Convertí `delay` y `stagger` de ms a segundos (la API real
    de DS-1 toma segundos, no ms): `<GsapStagger staggerDelay={0.06}>` y
    `<GsapFade delay={0.06|0.12|0.18}>`. Removido prop `aria-hidden` del
    `<LordIcon>` (la API real auto-aplica `aria-hidden` cuando no hay
    `ariaLabel`; pasarlo causaría un warning de prop desconocido).
  - `logo-dropzone.tsx`: idem para `LordIcon` (cloud-upload, trash-bin).
  - `preview-pane.tsx`: idem para `GsapFade`.
  - `color-picker-card.tsx`: no consumía stubs (no requirió cambio).

### `apiMultipart()` shipped (CC-03)

- `segurasist-web/packages/api-client/src/client.ts`:
  - **Nuevo export** `apiMultipart<T>(path, formData, opts?: { method?, signal?, headers? }): Promise<T>`.
  - Mismo path-routing por `/api/proxy/*`, `x-trace-id`, override S3-08 que
    `api()`. **No** setea `content-type: application/json` (el browser
    calcula el boundary). Errores → `ProblemDetailsError` (igual contrato
    uniforme que el resto de hooks).
  - Soporta `signal` (React Query unmount aborts) y `headers` extra.
- `segurasist-web/packages/api-client/src/hooks/admin-tenants.ts`:
  - `useUploadLogoMutation` refactorizado: eliminado el `fetch()` directo +
    el manual `ProblemDetails-like` parsing; ahora 6 líneas que delegan a
    `apiMultipart`. Mismo onSuccess/invalidación cruzada
    (`tenant-branding/:id` + `tenant-branding-self`).

### Tests (CC-03)

- `segurasist-web/packages/api-client/test/api.spec.ts` (nuevo, 10 tests):
  1. Path `/api/proxy/<...>` y `x-trace-id` UUID v4.
  2. **No** inyecta `content-type` (case-insensitive check).
  3. `body` es la misma instancia de `FormData` (incluye un campo extra y
     verifica `.get('meta')`).
  4. Verbo default POST; override a PUT.
  5. Propaga `AbortSignal` a `fetch`.
  6. Inyecta `x-tenant-override` cuando hay getter (S3-08).
  7. non-2xx → `ProblemDetailsError` con `.status` preservado.
  8. 204 → `undefined` sin `.json()`.
  9. Headers extra del caller respetados sin pisar la regla de no-CT.
  10. Integración con `useUploadLogoMutation`: el hook real entrega
      FormData con campo `file`, POST al path correcto, sin content-type.

### Lordicon `arrow-loading` (UI premium)

- `branding-editor.tsx`: el botón `<Button data-testid="branding-save-btn">`
  ya no usa el prop `loading={isPending}` (que renderiza `Loader2` de Lucide
  vía el Button); ahora renderiza `<LordIcon name="arrow-loading"
  trigger="loop" size={20} />` inline cuando `updateMutation.isPending` y
  marca `aria-busy`. Reduced-motion lo gobierna DS-1 dentro del wrapper.

### Test setup (`vitest.setup.ts`)

- `segurasist-web/apps/admin/test/setup.ts`:
  - **Mock global** de `gsap`, `lord-icon-element` y `lottie-web` (no-ops)
    para que los tests que ahora consumen los componentes reales del
    `@segurasist/ui` no toquen `requestAnimationFrame`/Lottie en jsdom.
  - **Polyfill** de `URL.createObjectURL` y `URL.revokeObjectURL` (jsdom 24
    no los provee, los necesita el `onUploadLogo` y `validateFile` del
    dropzone).

## Verificación

```text
pnpm --filter admin test --run branding-editor
   → PASS (14/14)  [iter 1 reportó "11" pero el archivo tiene 14 it() blocks]

pnpm --filter @segurasist/api-client test
   → PASS (61/61) — incluye api.spec.ts (10 nuevos)

pnpm --filter admin test
   → PASS (241), FAIL (3) — los 3 son S5-3 (kb-list.spec.tsx) NO MT-2.
     (`<KbCsvImport>` y `<KbTestMatch>`); ver NEW-FINDING #1.
```

## NEW-FINDING

1. **`user-event@14.5.2 + jsdom 24` filtran `accept` en `upload()`**: el
   test `rechaza tipo no soportado (text/plain)` quedaba colgado porque
   `userEvent.upload(input, badFile)` filtra silenciosamente el archivo si
   su `type` no matchea el `accept` del `<input>`. `applyAccept: false` no
   surte efecto consistente en esta combo. Migrar a `fireEvent.change` para
   bypassear el filtro y testear la validación cliente-side propia. **Lo
   mismo aplica a los tests fallando en `apps/admin/test/integration/kb-list.spec.tsx`**
   (`<KbCsvImport>` rechaza .txt y acepta .csv) que NO toqué porque
   pertenecen a S5-3 — proponer al finisher S5-3 que aplique el mismo
   patrón (`fireEvent.change`/`DataTransfer` directo).
2. **Conteo de tests del editor**: el iter 1 feed dice "11 tests" pero el
   archivo tiene 14 (`grep -c "  it(" branding-editor.spec.tsx` → 14). No
   es bloqueo; sólo nota para evitar drift en docs.
3. **`@radix-ui/react-switch` faltaba en node_modules**: DS-1 publicó
   `packages/ui/src/components/switch.tsx` (radix-switch) en iter 2 pero
   `pnpm install` no se había corrido. Corrió `pnpm install` (sin
   modificar package.json — sólo el lockfile auto-resolvió las
   transitivas). Nota para G-2/CI: agregar `pnpm install --frozen-lockfile`
   en el pipeline para detectar este drift antes.
4. **`apiMultipart` listo para S5-3**: el helper acepta cualquier path
   (`/v1/admin/chatbot-kb/import` u otro). El finisher de S5-3 puede:
   ```ts
   const fd = new FormData();
   fd.append('file', csvFile);
   await apiMultipart<KbImportResult>('/v1/admin/chatbot-kb/import', fd);
   ```
   No necesita cambios extra. La integración entre `apiMultipart` y
   `ProblemDetailsError` ya unifica el error handling con el resto de
   hooks.
5. **LordIcon `arrow-loading` URL aún tiene `<TODO_ID_ARROW_LOADING>`** en
   `catalog.ts` (DS-1 owner: CC-15). El render es funcional (usa el
   placeholder span hasta que el web component carga el JSON), pero hasta
   que DS-1 resuelva el ID el icono no animará en producción real.
6. **`Button` de `@segurasist/ui` sigue usando `Loader2` de Lucide** cuando
   `loading=true` (no es MT-2 territory). Si DS-1 quiere uniformar, podría
   internalizar `<LordIcon name="arrow-loading">` ahí — abre la puerta a
   eliminar la dep transitiva de Lucide para spinners.

## Bloqueos

Ninguno crítico. Los 3 tests fallando en `kb-list.spec.tsx` son S5-3
ownership y misma raíz (NEW-FINDING #1).

## Para iter 3 / cross-cutting

- **CC-15** (DS-1): resolver `<TODO_ID_ARROW_LOADING>` en `catalog.ts`.
- **S5-3 finisher**: consumir `apiMultipart()` en KB CSV import +
  migrar tests de upload a `fireEvent.change` (ver NEW-FINDING #1).
- **MT-1** (cuando publique OpenAPI): reemplazar `TenantBranding` /
  `UpdateTenantBrandingDto` / `UploadLogoResult` en
  `admin-tenants.ts` por los tipos generados.
- **CC-09** (DS-1 ya implementado en gsap-fade): los tests E2E de MT-4
  pueden esperar `[data-motion-ready="true"]` en lugar de hardcoded
  timeouts ahora que GsapFade/GsapStagger lo emiten.
