# Breach Notification Template — SegurAsist

> Plantilla pre-aprobada para notificación a clientes y, si aplica, a la autoridad
> reguladora (INAI - LFPDPPP, México), en cumplimiento del compromiso contractual de
> ≤72 horas desde la confirmación del incidente.

---

**Subject / Asunto**: [SegurAsist] Notificación de incidente de seguridad — {YYYY-MM-DD}

**To / Para**: {Customer primary contact} <{email}>
**Cc**: {DPO contact}, {Account Manager}
**From / De**: ciso@segurasist.app
**Date / Fecha**: {YYYY-MM-DD HH:MM} (CDMX time)
**Reference / Referencia**: INC-{YYYY}-{NNN}

---

Estimado/a {Customer name},

En cumplimiento de nuestro compromiso contractual y de la Ley Federal de Protección
de Datos Personales en Posesión de los Particulares (LFPDPPP), le notificamos sobre
un incidente de seguridad que afectó a SegurAsist y que pudo haber involucrado
información de su organización.

## 1. Resumen ejecutivo

> {1-2 párrafos. Qué pasó, cuándo se detectó, alcance preliminar.}

## 2. Cronología (UTC)

| Timestamp | Evento |
|-----------|--------|
| {YYYY-MM-DD HH:MM} | Detección inicial |
| {YYYY-MM-DD HH:MM} | Escalamiento a P1 / Incident Commander asignado |
| {YYYY-MM-DD HH:MM} | Contención lograda |
| {YYYY-MM-DD HH:MM} | Erradicación completada |
| {YYYY-MM-DD HH:MM} | Recovery / vuelta a operación normal |
| {YYYY-MM-DD HH:MM} | Notificación a este cliente |

## 3. Datos potencialmente afectados

- **Tipo de datos**: {PII / credenciales / metadatos / etc.}
- **Volumen estimado**: {N registros / N usuarios}
- **Tenant(s) afectado(s)**: {tenant_id list o "ninguno además del solicitante"}
- **Categoría LFPDPPP**: {Personales / Sensibles / Financieros}

## 4. Causa raíz preliminar

> {1 párrafo técnico, no especulativo. Si está bajo investigación, indicarlo.}

## 5. Acciones tomadas

- {Acción de contención}
- {Acción de erradicación}
- {Notificaciones realizadas (interna, regulador si aplica)}

## 6. Acciones recomendadas para su organización

- {Reset de contraseñas si aplica}
- {Rotación de API keys / SSO si aplica}
- {Vigilancia de cuentas afectadas durante {N} días}

## 7. Acciones preventivas que SegurAsist implementará

- {Cambio de control / patch / configuración}
- {Fecha objetivo: YYYY-MM-DD}

## 8. Contacto

- **CISO SegurAsist**: ciso@segurasist.app, +52 55 0000 0000
- **DPO SegurAsist**: dpo@segurasist.app
- **Línea 24/7 incidentes**: +52 55 0000 0000 (extensión 911)
- **Postmortem público (si aplica)**: status.segurasist.app

Estamos a su disposición para una llamada en las próximas 24 horas para discutir
los detalles técnicos y responder a las preguntas que su equipo pueda tener.

Atentamente,

{Nombre}
CISO, SegurAsist

---

## Checklist interno (NO enviar al cliente)

- [ ] Aprobado por CISO
- [ ] Aprobado por Director General
- [ ] Revisado por counsel legal externo
- [ ] Reloj 72 h cumplido (envío antes de {YYYY-MM-DD HH:MM})
- [ ] Notificación a INAI evaluada y registrada (incluso si se decide no notificar)
- [ ] Postmortem técnico anexado en `/docs/postmortems/INC-{YYYY}-{NNN}.md`
- [ ] Lista de subprocesadores afectados notificada per cláusulas DPA
