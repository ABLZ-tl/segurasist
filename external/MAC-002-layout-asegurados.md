# MAC-002 — Validación del layout oficial con Lucía

**Estado:** ✅ RESUELTO (2026-04-26 — Lucía dio libre albedrío al equipo SegurAsist)
**Bloquea:** ~~S1-04, S1-05, S2-01~~ — desbloqueado.
**Owner:** PO (Alan) + Backend Lead
**Resolución:** Libre albedrío otorgado por Lucía (MAC). El equipo SegurAsist define el layout v1 oficial sin sesión de validación previa. Lucía recibirá el layout final como hecho consumado y dará feedback sólo si encuentra issues operativos en su uso real (Sprint 2 onboarding presencial).
**Referencia:** `MVP_01_PRD_SegurAsist.docx` §4.1 RF-101 + `MVP_02_Plan_Proyecto_SegurAsist.docx` §3 (D-1)
**Layout oficial:** `segurasist-api/docs/contracts/layout_plantilla_v1.xlsx` (generado por endpoint `GET /v1/batches/template`).

## Contexto

El layout Excel/CSV es el contrato de carga masiva entre MAC y SegurAsist. Si lo definimos mal, todas las features F1 (carga), F2 (dashboard), F3 (certificados) y F6 (reportes) se ven afectadas. Necesitamos validar con Lucía la forma exacta del archivo que ella manejaría diariamente.

## Decisiones tomadas (libre albedrío 2026-04-26)

Lucía nos delegó la definición del layout sin sesión previa. Estas son las decisiones que aplican:

### Modelo de carga
- **Altas y bajas en layouts SEPARADOS** (no flag `accion=alta|baja` en mismo archivo). Razón: separar accidentes de bajas masivas no deseadas; auditoría más limpia.
  - Altas: `POST /v1/batches` con archivo `layout_plantilla_v1.xlsx`.
  - Bajas: endpoint distinto `POST /v1/insureds/bulk-cancel` con `bajas_plantilla_v1.xlsx` (CURP + fecha_baja + motivo).
- **Beneficiarios en CSV en celda misma fila del titular** (formato `nombre|fecha_nac|relación`, separados por `;`). Hasta 10. Razón: simplifica parser, evita relaciones multi-fila ambiguas.
- **Cambio de paquete mid-vigencia**: anula la fila vigente (`status=cancelled`, `cancelled_at=now()`, `cancellation_reason='package_change'`) y crea fila nueva con vigencia desde la fecha del cambio. Mantiene historial completo en `audit_log` + tabla `insureds`.
- **Renovación** (mismo CURP con vigencia que se solapa): rechazar con error `INSURED_OVERLAPPING_VALIDITY` y forzar al operador a cancelar la fila previa antes de re-cargar.

### Reglas de validación de fila
- **CURP** obligatorio, regex `^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$`, **mayúsculas obligatorias** (rechazar minúsculas con sugerencia "convertir a mayúsculas en Excel"). Validación de dígito verificador (algoritmo SEGOB).
- **RFC** opcional, regex `^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$`.
- **Email** opcional, RFC 5322. Si presente, sirve como canal preferido para certificado.
- **Teléfono** opcional, E.164 (`+52...`). Si presente, fallback de notificación.
- **Paquete** obligatorio, debe existir en BD del tenant. Match por nombre exacto case-insensitive (rechazar typos con sugerencia top-3 más cercanos via Levenshtein).
- **Vigencias**: `vigencia_inicio < vigencia_fin`, ambas dates ISO `YYYY-MM-DD`.
- **Filas vacías intermedias**: ignoradas con warning visible en preview ("Se omitieron N filas vacías").
- **UTF-8 forzado** (rechazar Latin-1 con error claro). Validar en magic bytes.
- **Acentos y ñ**: aceptados en `nombre_completo` y `entidad`. Normalizados a NFC antes de persistir.

### Email de operador
- **Email del corresponsal**: NO en este layout v1. Si MAC lo necesita después, se agrega como columna 13 en v2 sin breaking changes (parser tolerante).

### Tamaño y performance
- Default máximo: **10,000 filas** por archivo (RNF-PER-04). Configurable por env `BATCH_MAX_ROWS`.
- Tamaño archivo: **25 MB max** (en Helmet config + multer).
- Procesamiento background con SQS+Lambda (S2-01).

### Layout v1 — 12 columnas oficiales

| # | Columna (header en Excel) | Tipo | Obligatorio | Validación |
|---|---|---|---|---|
| 1 | `curp` | string(18) | Sí | Regex CURP + dígito verificador SEGOB |
| 2 | `rfc` | string(13) | No | Regex RFC |
| 3 | `nombre_completo` | string(120) | Sí | min 3 chars, NFC normalizado |
| 4 | `fecha_nacimiento` | date `YYYY-MM-DD` | Sí | edad 0–120 |
| 5 | `email` | string(120) | No | RFC 5322 |
| 6 | `telefono` | string(15) | No | E.164 |
| 7 | `paquete` | string(60) | Sí | match case-insensitive con BD |
| 8 | `vigencia_inicio` | date | Sí | < vigencia_fin |
| 9 | `vigencia_fin` | date | Sí | > vigencia_inicio |
| 10 | `entidad` | string(60) | No | catálogo (SNTE, CATEM, etc.) |
| 11 | `numero_empleado_externo` | string(40) | No | identificador del cliente final |
| 12 | `beneficiarios` | string CSV | No | hasta 10, formato `nombre|YYYY-MM-DD|relación` separados por `;` |

**Hoja Excel**: nombre `asegurados` o primera hoja del workbook. Encabezados en fila 1 (case-insensitive matching).

### Plan de comunicación a Lucía

PO envía a Lucía en el kickoff de Sprint 2:
1. PDF del layout v1 con ejemplos llenados.
2. Acceso al endpoint `GET /v1/batches/template` para descargar la plantilla XLSX viva.
3. Invitación a sesión de **onboarding presencial 90 min** (Sprint 2 día 5) donde ella ejecuta su primera carga real con dataset de prueba que ella misma traiga.
4. Compromiso: cualquier ajuste solicitado por Lucía en esa sesión se prioriza P1 sin necesidad de change request formal.

## Pasos (referencia histórica — no aplican)

### 1. Sesión presencial / Teams con Lucía (45 min) ~~SUPERADO~~

Agenda:
- Mostrar layout propuesto (versión inicial, ver §3 abajo).
- Pedir a Lucía: "Trae el último layout real que recibiste del SNTE (o cualquier sindicato)" — sin datos sensibles, datos de prueba o anonimizados.
- Comparar columnas, formatos, tipos de dato, combinaciones esperadas.
- Recoger reglas implícitas que Lucía aplica mentalmente (ej. "si CURP empieza con XEXX es extranjero, el RFC se construye distinto").

### 2. Layout propuesto (versión 0)

| # | Columna | Tipo | Obligatorio | Validación | Ejemplo |
|---|---|---|---|---|---|
| 1 | `curp` | string(18) | Sí | Regex CURP + dígito verificador | `PEPM800101HDFRRR03` |
| 2 | `rfc` | string(13) | No | Regex RFC | `PEPM800101AAA` |
| 3 | `nombre_completo` | string(120) | Sí | min 3 chars | `María Pérez Pérez` |
| 4 | `fecha_nacimiento` | date (YYYY-MM-DD) | Sí | edad 0–120 | `1980-01-01` |
| 5 | `email` | string(120) | No | RFC 5322 | `maria@ejemplo.com` |
| 6 | `telefono` | string(15) | No | E.164 | `+525555555555` |
| 7 | `paquete` | string(60) | Sí | debe existir en BD del tenant | `Premium` |
| 8 | `vigencia_inicio` | date | Sí | <= vigencia_fin | `2026-05-01` |
| 9 | `vigencia_fin` | date | Sí | > vigencia_inicio | `2027-04-30` |
| 10 | `entidad` | string(60) | No | catálogo (SNTE, CATEM, etc.) | `SNTE` |
| 11 | `numero_empleado_externo` | string(40) | No | identificador del cliente final | `EMP12345` |
| 12 | `beneficiarios` | string (CSV separado por `;`) | No | hasta 10, formato `nombre|fecha|relacion` | `Juan|2010-05-01|hijo;Ana|2008-08-15|hija` |

**Encabezado fijo en fila 1.** Hoja debe llamarse `asegurados` o ser la primera.

### 3. Reglas que necesitamos confirmar con Lucía

- ¿Cómo manejan **bajas**? ¿Llega un layout aparte con `accion=baja` o un layout completo cada vez que es delta?
- ¿**Beneficiarios**: una fila por beneficiario o todos en la misma fila del titular?
- ¿**Cambios de paquete** durante la vigencia? (upgrade/downgrade)
- ¿Qué hacer si llega una **renovación** (mismo CURP con nueva vigencia que se solapa con la anterior)?
- ¿Hay un campo de **email del corresponsal** (familia/RH) distinto al del asegurado?
- ¿Validar **paquete** por nombre exacto o por código interno?
- ¿Tolerancia a **CURPs en minúsculas** o solo MAYÚSCULAS?
- ¿Qué hacer con **filas vacías** intermedias? (ignorar, error, advertencia)
- ¿Cuál es el **tamaño típico** del layout? (1k, 5k, 10k filas)
- ¿Vienen **acentos / ñ** en nombres? (UTF-8 vs Latin-1)

### 4. Layout plantilla descargable (entregable)

Después de la sesión, generamos `layout_plantilla_v1.xlsx` con:
- Hoja 1: `asegurados` (encabezados + 3 filas de ejemplo).
- Hoja 2: `instrucciones` (descripción de cada columna y reglas).
- Hoja 3: `catalogos` (paquetes vigentes y entidades válidas).

Versionado: `layout_plantilla_v{X}_YYYY-MM-DD.xlsx` en `segurasist-api/docs/contracts/`.

### 5. Bajas: definir flujo separado

Si confirma Lucía que las bajas vienen aparte:
- Layout `bajas_plantilla_v1.xlsx` con columnas: `curp`, `fecha_baja`, `motivo`, `notas`.
- Endpoint `/v1/insureds/bulk-cancel` (separado de `/batches`).

## Evidencia esperada

- [ ] Acta de la sesión con Lucía (en `docs/sessions/MAC-D-1-layout.md`)
- [ ] Layout v1 versionado en `segurasist-api/docs/contracts/`
- [ ] Reglas de validación finalizadas (alimentan `BatchesModule` Zod schemas)
- [ ] Tamaño máximo confirmado (default 10k filas, validar contra realidad MAC)

## Riesgo

Si Lucía no puede en D-1, posponer máximo a D+2 (Sprint 1). Cualquier ajuste posterior al Sprint 1 cuenta como **change request** y requiere aprobación PO + estimación de impacto en sprint siguiente.
