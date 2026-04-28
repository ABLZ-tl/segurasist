# Fix Report — F1 B-PDF

## Iter 1 (resumen)

### Issues cerrados

- **C-01** (Critical, integridad) — `segurasist-api/src/workers/pdf-worker.service.ts:316,357`
  - Pre-fix: `Certificate.hash` y `qrPayload` usaban un `provisionalHash` derivado de `randomUUID()` (NO era SHA-256 del PDF). El SHA real se calculaba (`pdfHash = createHash('sha256').update(pdf).digest('hex')`) pero se descartaba con `void pdfHash;` — solo viajaba a S3 metadata como `x-hash`.
  - Post-fix: refactor a **2-pass render**:
    1. PASS-1: render con QR placeholder → buffer P1.
    2. `realHash = SHA-256(P1)`.
    3. PASS-2: re-render con QR apuntando a `/verify/{realHash}` → buffer P2.
    4. Upload P2 a S3 con `Metadata: { 'x-hash': realHash, 'x-sha256-content': SHA(P2) }`.
    5. Persistir `Certificate { hash: realHash, qrPayload: URL with realHash }`.
  - Resultado: `Certificate.hash` ES SHA-256 de un PDF Puppeteer real, el QR escaneado matchea el lookup en BD, el evento `certificate.issued` lleva el hash real.
- **H-10** (cerrado por C-01) — `Certificate.hash` field schema. El campo `varchar(128)` siempre soportó SHA-256 hex; el bug era el contenido, no el schema. Cerrado por la misma refactor.

### Tests añadidos

- **`segurasist-api/test/integration/cert-integrity.spec.ts`** (NUEVO, 6 tests):
  - `Certificate.hash === SHA-256(buffer Puppeteer PASS-1)` — invariante crítico C-01: recomputa SHA del buffer mockeado y compara contra el `data.hash` enviado a `prisma.certificate.create`.
  - `PASS-1 y PASS-2 ambos invocados` — verifica que `puppeteer.renderPdf` se llama 2 veces con `ref` distintos (`-pass1` / `-pass2`).
  - `hash NO depende de randomUUID() — buffers iguales producen mismo hash` — pre-fix esto fallaba (hashes random distintos por ejecución); post-fix el hash es función pura del buffer.
  - `verify endpoint encuentra cert por hash real (lookup matchea PASS-1 SHA)` — flujo end-to-end: emisión + lookup vía `CertificatesService.verify(hash)`.
  - `verify endpoint NO encuentra cert con hash random (defensa pre-fix)` — verifica que un hash random no devuelve filas (defensa contra el comportamiento pre-fix que persistía hashes random).
  - `verify endpoint rechaza hash mal formado sin filtrar info` — anti-enumeration.
- **`segurasist-api/test/unit/modules/certificates/pdf-worker.spec.ts`** (extendido):
  - Test nuevo: `Fix C-01: Certificate.hash === SHA-256(buffer Puppeteer PASS-1)` — equivalente unit del invariante con verificaciones adicionales sobre S3 metadata + evento SQS.
  - Test existente actualizado: `handleEvent insured.created → ...` ahora espera `renderPdf` invocado 2 veces (PASS-1 + PASS-2).

### Tests existentes corridos

- `pnpm run test:unit -- --testPathPattern certificates`: **30 pass / 0 fail** (5 suites: pdf-worker, certificates.service, qr-generator, template-resolver, verify-endpoint).
- `pnpm run test:integration -- --testPathPattern cert-integrity`: **6 pass / 0 fail**.
- `pnpm run test:unit` (full): **506 pass / 0 fail / 1 skipped** entre tests; **4 suites FAIL** por TS errors en `batches.service.ts`, `layout-worker.service.ts`, `insureds-creation-worker.service.ts`, `insureds.service.ts` (`Expected 2 arguments, but got 3` y `queuedCount` desconocido). **Causa raíz**: F5 está refactorizando `SqsService.sendMessage` para eliminar el tercer parametro `dedupeId` (cierre C-09/P1) y F4 está agregando columna `queuedCount` (cierre C-08); ninguno relacionado con archivos de F1. Confirmado out-of-scope F1.
- `pnpm run test:integration -- --testPathPattern cert-email-flow`: FAIL por la misma cadena TS (`AppModule` importa transitivamente `batches.service`). El test `cert-integrity` evita este coupling al instanciar workers/services directos sin `Test.createTestingModule`.

### Cross-cutting findings (registrados en feed)

- `pdf-worker.service.ts` PASS-1 fail path mantiene hash random (no hubo buffer); aceptable porque queda `status='revoked'` y nunca se sube a S3, pero queries downstream deben filtrar `status='issued'` (el verify endpoint ya lo hace).
- `certificates.service.ts:209-212` (`urlForSelf`) confirma B4-V2-16: no filtra `status='issued'`. Out-of-scope iter 1 (cross-cut F6 audit ctx). Anotado para iter 2.
- `pdf-worker.service.ts` evento `certificate.issued` se envía a `SQS_QUEUE_EMAIL` sin `dedupeId` (B4-V2-01). Out-of-scope iter 1 — F5 owns la decisión arquitectónica idempotencia DB-side vs FIFO en el bundle B-INFRA-SQS.

## Iter 2

### Issues cerrados

- **B4-V2-16** — `segurasist-api/src/modules/certificates/certificates.service.ts:219-225` (`urlForSelf`)
  - Pre-fix: el `where` del `findFirst` solo filtraba `{ insuredId, deletedAt: null }`. Un cert con `status='revoked'` (revocación administrativa) o `status='replaced'` (cuando una reemisión queda en flight) podía ser servido al asegurado, igual que el placeholder `revoked` que el PASS-1 fail path persiste con hash random (NEW-FINDING F1 iter 1).
  - Post-fix: `where: { insuredId, deletedAt: null, status: 'issued' }`. Comentario inline justifica el filter referenciando el cross-cut con C-01 PASS-1 fail path.
  - Audit completa de los demás métodos del service: `findOne`/`presignedUrl` son admin (no aplica filter), `reissue`/`resendEmail` ya bloquean `status='revoked'`, `verify` ya filtra `status='issued'`. **Solo `urlForSelf` tenía el gap.**

- **H-16 cast cleanup** — verificación segurasist-api/src/modules/certificates/certificates.service.ts:199-207. **Cerrado por F10 iter 1** (F10-iter1.md:11). Confirmé leyendo el file que ya NO existe el cast `as unknown as Prisma.InsuredWhereInput` ni el import `type { Prisma } from '@prisma/client'`. No-op para F1 iter 2.

### Tests añadidos

- **`segurasist-api/test/integration/cert-integrity.spec.ts`** (extendido):
  - Nuevo `describe('Fix B4-V2-16 — urlForSelf filtra status="issued"')` con 2 specs:
    1. `urlForSelf incluye status="issued" en where clause (no devuelve revoked)` — inspecciona los args pasados a `mockClient.certificate.findFirst`, asegura `where.status === 'issued'`. La invariante vive en la query, no en el resultado.
    2. `urlForSelf 404 cuando único cert del asegurado está revoked` — mock que respeta filtros Prisma realisticamente: si la BD solo tiene un cert `revoked` y el query pide `status='issued'`, devuelve null → service lanza `NotFoundException`.

### Tests existentes corridos

- `pnpm run test:unit -- --testPathPattern certificates`: **22 pass / 0 fail** entre los 3 suites que compilan (pdf-worker, qr-generator, template-resolver). 2 suites (certificates.service.spec, verify-endpoint.spec) BLOCKED por TS error upstream en `audit-writer.service.ts:228` — F6 extendió `AuditEventAction` a 13 valores pero el Prisma client `AuditAction` enum sigue con 8 (migration `20260428_audit_action_enum_extend` existe pero `prisma generate` no corrió en sandbox). `npx tsc --noEmit` confirma 13 TS errors en 9 files, NINGUNO en `src/modules/certificates/*` ni en mis tests.
- `pnpm run test:integration -- --testPathPattern cert-integrity`: BLOCKED por la misma cadena TS upstream (transitively imports `audit-writer.service`). Cuando F6 sync Prisma↔TS en iter 2, esta suite + las 2 unit suites bloqueadas corren verde sin cambios adicionales en mi código.

### Coordinaciones con otros agentes

- **F6 audit ctx** — confirmé que NO toqué `certificates.service.ts:227-244` (bloque audit `auditWriter.record({...})`). Mi edit del `where` clause está en línea 219-225, separado físicamente. F6 migra a `AuditContextFactory.fromRequest()` + `action: 'read_downloaded'` (enum nuevo). Delta de mi cambio: +6 líneas (1 línea filter + 5 líneas comentario inline) — F6 deberá actualizar refs de línea hacia abajo en su iter 2.
- **F10 H-16** — verificado cerrado por F10. No-op redundante evitado.

## Iter 2 — Compliance impact (delta)

- **OWASP A04 (Insecure Design)**: el "happy path" de `urlForSelf` ahora rechaza certs revocados, alineando el portal asegurado con el mismo principio del verify endpoint público (sólo certificados emitidos válidos cruzan el threshold). Cierra una vía de vector reputacional: un asegurado descargaba un PDF con seal `revoked` interno y lo presentaba a un proveedor médico que lo verificaba en `/verify/<hash>` → mismatch silencioso pre-fix.
- **3.13 Audit Sprint 1 M5**: el filtro `status='issued'` evita que el placeholder hash-random (PASS-1 fail path) llegue a un audit row `read_downloaded` futuro (F6) — el AuditWriter hubiera registrado un `payloadDiff.hash` random como evidencia, contaminando la chain integrity.

## Lecciones para `DEVELOPER_GUIDE.md` (F10 iter 2 las integra)

(Adicionales a las 5 de iter 1.)

6. **Filtros `status` en queries de lectura asimétricos por rol**: endpoints admin (`findOne`, `presignedUrl` con scope admin) deben permitir ver `revoked`/`replaced` (auditoría/forensics); endpoints de end-user (`urlForSelf`, `verify`) deben filtrar `status='issued'` por defecto. Documentar la regla como decision matrix en sección "RBAC + state queries". Considerar lint custom: cualquier `certificate.findFirst({ where: { insuredId } })` sin `status` filter requiere comentario `// admin scope` o ESLint flag.
7. **Cross-cut de fail paths que persisten estado parcial**: cuando un worker falla y persiste un placeholder con `status='revoked'` (en lugar de no persistir nada), todos los queries downstream deben asumir que el placeholder existe y filtrarlo. Documentar el patrón "fail-with-placeholder" como antipattern condicional — preferible "fail-without-persist" cuando el caller puede reintentar idempotente. Si se mantiene el placeholder (para audit chain), agregar tests scoped que verifican que cada query downstream filtra explícitamente.
8. **Coordinación cross-agent en files compartidos**: cuando dos agentes editan el mismo file en olas distintas (F1 → urlForSelf where; F6 → audit fire-and-forget block), separar físicamente las líneas (mínimo 5 líneas + comentario delimitador) reduce conflictos de merge. Mi delta dejó el bloque audit intacto en posición relativa, F6 solo actualiza line refs en su feed entry.


## Compliance impact

- **3.13 OWASP A08 (Software & Data Integrity Failures)**: el invariante "QR del cert apunta al SHA real del PDF" se restablece. El caso de uso "tercero verifica QR" ya NO está roto end-to-end (CORR-01 resuelto desde el lado A4; complementario al fix H-05 portal CSP del F2).
- **Audit Sprint 1 M5 (audit consolidado)**: `Certificate.hash` ahora es deterministic input válido para hash chain integrity downstream (F6 audit chain verifier puede reclamar `hash` como fuente trustworthy).

## Lecciones para `DEVELOPER_GUIDE.md` (F10 las integra)

1. **`createHash` calculate-and-discard es un antipattern**: si computas un SHA, persistilo o emitilo. El comentario `void pdfHash;` es señal de bug — agregar lint rule custom o pre-commit grep para `void.*[Hh]ash`.
2. **Render 2-pass para QR cíclicos**: cuando el contenido (QR) depende del SHA del contenedor (PDF), los renders single-pass producen hashes inconsistentes con la verificación pública. Documentar el patrón 2-pass como solución estándar (PASS-1 sin upload, SHA(PASS-1) = identidad, PASS-2 con upload).
3. **S3 metadata para auditoría off-band**: usar `x-hash` (lookup BD) y `x-sha256-content` (SHA real del archivo en bucket) como campos separados; permite a operadores forenses detectar tampering del bucket sin tocar BD.
4. **Tests de invariantes de hash deben recomputar, no regex-match**: `expect(hash).toMatch(/^[a-f0-9]{64}$/)` pasa con CUALQUIER hex de 64 chars (random o real). Test correcto: `expect(hash).toBe(createHash('sha256').update(buffer).digest('hex'))`.
5. **Cross-coupling auditoría visible**: el bug C-01 (hash random) y H-05 (CSP frame-src bloqueando preview) se enmascaraban mutuamente. Lección: cuando dos bugs de áreas distintas crean un caso de uso roto end-to-end, el dispatch de fixes debe coordinar (D1 pareando F1 + F2 en revisión cruzada de smoke).
