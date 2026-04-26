# MAC-002 — Validación del layout oficial con Lucía

**Estado:** ⬜ Pendiente
**Bloquea:** S1-04, S1-05, S2-01 (carga masiva end-to-end)
**Owner:** PO (Alan) + Backend Lead + Lucía (MAC)
**Urgencia:** Sesión D-1 del Sprint 0 (antes de empezar a parsear)
**Referencia:** `MVP_01_PRD_SegurAsist.docx` §4.1 RF-101 + `MVP_02_Plan_Proyecto_SegurAsist.docx` §3 (D-1)

## Contexto

El layout Excel/CSV es el contrato de carga masiva entre MAC y SegurAsist. Si lo definimos mal, todas las features F1 (carga), F2 (dashboard), F3 (certificados) y F6 (reportes) se ven afectadas. Necesitamos validar con Lucía la forma exacta del archivo que ella manejaría diariamente.

## Pasos

### 1. Sesión presencial / Teams con Lucía (45 min)

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
