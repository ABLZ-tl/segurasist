# LEG-001 — DPA AWS firmado + Aviso de Privacidad publicado

**Estado:** ⬜ Pendiente
**Bloquea:** Cumplimiento LFPDPPP (control 3.2 V2) + procesamiento de datos personales
**Owner:** PO + CISO + abogado (externo o in-house)
**Referencia:** `MVP_08_Seguridad_Cumplimiento_SegurAsist.docx` §3.2, §3.11

## Contexto

Para procesar datos personales de asegurados mexicanos (CURP, RFC, nombre, fecha de nacimiento, contacto) bajo la LFPDPPP necesitamos:

1. **DPA marco AWS** (Data Processing Agreement) firmado entre SegurAsist y AWS — establece a AWS como subprocesador.
2. **DPA SegurAsist ↔ MAC** firmado — establece a MAC como responsable y SegurAsist como encargado del tratamiento.
3. **Aviso de Privacidad** publicado en `segurasist.app/privacy` y `portal.segurasist.app` (visible al asegurado en el primer acceso).
4. **DPO designado** internamente (puede ser el CISO o un rol compartido).

## Pasos

### 1. Firmar DPA AWS (gratis)

- Console AWS → AWS Artifact → Agreements → "AWS GDPR DPA" o "AWS Data Processing Addendum".
- Clic "Accept agreement" desde la cuenta `prod` con un ejecutivo autorizado.
- Descargar PDF firmado y archivar en 1Password vault `Compliance` → `legal/aws-dpa-{fecha}.pdf`.
- Replicar en `segurasist-infra/docs/legal/` (copia de referencia, sin firmas escaneadas — solo el documento).

### 2. Generar DPA SegurAsist ↔ MAC

Plantilla base: `segurasist-infra/docs/legal/templates/DPA-template.docx` (genero el skeleton en bootstrap).

Cláusulas mínimas LFPDPPP-compatibles:
- Propósito del tratamiento (administración de membresías de salud).
- Categorías de datos (identificadores, contacto, datos de salud — sí, "datos sensibles" bajo LFPDPPP).
- Derechos del titular (ARCO).
- Subprocesadores (AWS, GitHub, UptimeRobot — lista versionada en `/privacy/subprocessors`).
- Obligaciones del encargado (medidas técnicas y organizativas, brechas en ≤72h).
- Devolución/destrucción al fin del contrato (NIST SP 800-88 Rev 1).
- Auditoría (derecho del responsable a auditar al encargado).

Revisar con abogado externo especializado en LFPDPPP/protección de datos.

### 3. Aviso de Privacidad

Versiones:
- **Integral:** publicado en `segurasist.app/privacy` (compatible LFPDPPP Art. 16).
- **Simplificado:** mostrado al asegurado al primer login en el portal (banner aceptación).

Contenido obligatorio:
- Identidad y domicilio del responsable (MAC) y encargado (SegurAsist).
- Datos personales recabados.
- Finalidades del tratamiento (primarias y secundarias separadas).
- Transferencias (incl. AWS internacional con DPA).
- Medios para ejercer ARCO (email `arco@segurasist.app` + formulario `/arco`).
- Procedimiento para revocar consentimiento.
- Cambios al aviso (notificación por email).

Versionado en `segurasist-web/apps/portal/public/privacy/` con fecha de publicación.

### 4. DPO designado

- Nombrar formalmente al **DPO** (Data Protection Officer / Encargado de Datos Personales).
- Por economía, puede ser el **CISO** con dedicación parcial o el **CSM** (Customer Success Manager).
- Email público dedicado: `dpo@segurasist.app` o `arco@segurasist.app`.
- Registrar el nombramiento en acta del comité interno.

### 5. Endpoint ARCO operativo

Backend tendrá endpoint `/v1/arco` (público, no requiere autenticación) que:
- Recibe solicitud con CURP + identificación.
- Valida via OTP al teléfono/email del asegurado.
- Crea ticket interno con SLA de **5 días hábiles para acuse, 20 días hábiles para resolución** (LFPDPPP Art. 32).
- Notifica al DPO automáticamente.

> Lo implementaré en Sprint 4 dentro de `UsersModule`.

### 6. Subprocesadores publicados

Crear `segurasist-web/apps/portal/app/privacy/subprocessors/page.tsx` con tabla:

| Subprocesador | Servicio | Ubicación de datos | DPA firmado | Certificaciones |
|---|---|---|---|---|
| Amazon Web Services | Hosting, identidad, email | **México** (mx-central-1 primaria) + EE.UU. (us-east-1 DR + ACM CloudFront) | Sí | SOC 1/2/3, ISO 27001/27017/27018, PCI DSS, HIPAA BAA, FedRAMP |
| GitHub Inc. | Code hosting, CI/CD | EE.UU. | Sí | SOC 2 |
| UptimeRobot | Monitoring | Lituania | Sí | SOC 2 |

> **Cambio de residencia (abril 2026):** la región primaria es ahora `mx-central-1` (Querétaro/CDMX, AWS Mexico Region). Esto reduce la transferencia internacional al mínimo (solo DR, ACM-for-CloudFront y servicios globales como Cognito si no estuvieran en mx-central-1). Comunicar a MAC como **mejora unilateral** del servicio. Ver `ADR-014` y `external/AWS-004`.

Política: cualquier alta/baja de subprocesador notificada al cliente con 30 días de anticipación.

## Evidencia esperada

- [ ] DPA AWS firmado en 1Password
- [ ] DPA SegurAsist↔MAC firmado por ambas partes
- [ ] Aviso de Privacidad integral publicado en `segurasist.app/privacy`
- [ ] Banner consentimiento en portal asegurado
- [ ] Email DPO activo y monitoreado
- [ ] Página subprocesadores publicada

## Riesgo

Sin estos documentos no podemos procesar datos reales de MAC en producción. Es un **gate hard** para Go-Live.
