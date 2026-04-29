# UAT Script — SegurAsist Sprint 5

- **Owner final**: DS-1 (Design System Lead).
- **Owner sección "Performance criteria"**: G-2 (preserva contenido propio).
- **Estado**: iter 1 — DS-1 inyectó los 10 escenarios funcionales,
  G-2 mantiene los thresholds de performance.

## Pre-requisitos

- Stakeholders MAC con credenciales: 2 admins + 2 asegurados +
  1 SAML SSO test user.
- Tenant `mac` con branding seedeado (logo + primary + accent + bg).
- Tenant `demo_insurer` SIN branding (default SegurAsist).
- Sesión guiada por Tech Lead + screen-share.
- Entornos: `https://staging.segurasist.com` (admin) +
  `https://portal-staging.segurasist.com` (portal).

## Escenarios funcionales (DS-1)

### S1 — Login admin estándar (5 min)

| Paso | Acción                                        | Resultado esperado                                |
| ---- | --------------------------------------------- | ------------------------------------------------- |
| 1    | `/login` admin                                | Página carga < 1.5s, branding default              |
| 2    | Email `admin@mac.example` + password          | OTP enviado al email                               |
| 3    | OTP                                           | Redirect `/dashboard`, header con logo MAC         |

Pass criteria: login < 30s end-to-end, audit log `action='login'`.

### S2 — Configurar branding desde admin (10 min)

| Paso | Acción                                                  | Resultado esperado                              |
| ---- | ------------------------------------------------------- | ----------------------------------------------- |
| 1    | `/settings/branding`                                    | Drop-zone logo + 2 color pickers + preview pane |
| 2    | Subir logo SVG 200KB                                    | Upload < 3s, preview actualiza                  |
| 3    | Cambiar primary `#0066cc`                               | Preview pane recalcula en < 200ms               |
| 4    | "Guardar"                                               | Toast success, audit log `tenant_branding`      |

Pass criteria: persiste tras refresh; logo aparece en sidebar admin tras
reload.

### S3 — Portal asegurado con branding A (10 min)

| Paso | Acción                                            | Resultado esperado                                  |
| ---- | ------------------------------------------------- | --------------------------------------------------- |
| 1    | Logout admin → `/login` portal                    | Branding default mientras carga, MAC tras login     |
| 2    | Login `asegurado1@mac.example`                    | Header con logo MAC + colores en buttons            |
| 3    | Navegar `/`, `/policies`, `/chatbot`              | Page transition GSAP visible (slide+fade 250ms)     |
| 4    | DevTools `:root` computed style                   | `--tenant-primary = #0066cc`                        |

Pass criteria: branding aplicado < 200ms post-login, sin FOUC visible al
navegar, transiciones suaves.

### S4 — Cross-tenant isolation (5 min, security)

| Paso | Acción                                                       | Resultado esperado                                 |
| ---- | ------------------------------------------------------------ | -------------------------------------------------- |
| 1    | Login asegurado MAC, copiar JWT                              | JWT con `custom:tenant_id=mac`                     |
| 2    | Reescribir `tenant_id` → `demo_insurer` en cookie / token    | Backend 403 (RLS bloquea)                          |
| 3    | Audit log                                                    | Entry con failure razonado                         |

Pass criteria: cero filtración cross-tenant. Confirmado con E2E
`tests/e2e/multi-tenant-portal.spec.ts` (MT-4).

### S5 — Chatbot con personalización Lordicons (10 min)

| Paso | Acción                                          | Resultado esperado                                  |
| ---- | ----------------------------------------------- | --------------------------------------------------- |
| 1    | `/chatbot` portal MAC                           | Lordicons en sidebar (chat-bubble, file-document)   |
| 2    | Hover en "chat-bubble"                          | Animación Lottie ejecuta                            |
| 3    | Mensaje "¿Cuál es mi cobertura?"                | Respuesta < 3s, audit log creado                    |
| 4    | `/chatbot/history`                              | Conversaciones 30d, paginación funcional            |

Pass criteria: `prefers-reduced-motion: reduce` honored (toggle SO).

### S6 — Admin KB editor (10 min, S5-3)

| Paso | Acción                                  | Resultado esperado                                          |
| ---- | --------------------------------------- | ----------------------------------------------------------- |
| 1    | `/chatbot/kb` admin                     | Lista de KB entries, Lordicons en CTA                       |
| 2    | Crear "Cobertura dental"                | Toast success                                               |
| 3    | Editar y publicar                       | Conversación nueva refleja la información actualizada ≤ 60s |

### S7 — SAML SSO admin (10 min, S5-1)

| Paso | Acción                                | Resultado esperado                                            |
| ---- | ------------------------------------- | ------------------------------------------------------------- |
| 1    | `/identity/saml`                      | Metadata XML descargable                                      |
| 2    | Login con IdP MAC (Okta sandbox)      | Login exitoso, sesión válida                                  |
| 3    | Logout                                | SLO inicia, IdP cierra sesión                                 |

Pass criteria: SAML round-trip OK, audit log `action='login' subAction='saml'`.

### S8 — Visual regression (auto, MT-4)

- Snapshot Playwright `portal-tenant-mac.spec.ts` matchea baseline.
- Diff > 1% requiere review humano.

### S9 — Performance (delegado a G-2 — sección abajo intacta)

- ZAP DAST: 0 High, 0 Medium en endpoints públicos.

### S10 — A11y + reduced-motion (DS-1) (10 min)

| Paso | Acción                                                 | Resultado esperado                                |
| ---- | ------------------------------------------------------ | ------------------------------------------------- |
| 1    | Habilitar `prefers-reduced-motion: reduce` en SO       |                                                   |
| 2    | Recargar portal                                        | Page transitions instantáneas, Lordicons quietos  |
| 3    | Lighthouse a11y                                        | Score >= 95                                       |
| 4    | Keyboard nav header + sidebar                          | Focus rings visibles, tab order correcto          |

## Sign-off

- [ ] MAC IT (firma + fecha)
- [ ] MAC Operaciones (firma + fecha)
- [ ] SegurAsist Tech Lead (firma + fecha)
- [ ] DS-1 (script owner) (firma + fecha)
- [ ] G-2 (performance addendum) (firma + fecha)

---

## Performance criteria (G-2 — preservado tal cual del placeholder)

UAT pasa solo si los siguientes thresholds del baseline Sprint 5 (ver
`docs/sprint5/PERFORMANCE_REPORT.md` + `tests/performance/k6/sprint5-baseline.js`)
se cumplen en staging:

### Smoke (1 VU, 30s) — gate per-push

| Métrica | Threshold | Verdict UAT |
|---|---|---|
| `http_req_duration` p95 global | < 500 ms | TODO |
| Login (`POST /v1/auth/login`) p95 | < 500 ms | TODO |
| Portal dashboard (`GET /v1/insureds/me`) p95 | < 300 ms | TODO |
| Admin dashboard (`GET /v1/admin/tenants`) p95 | < 500 ms | TODO |
| Error rate | < 1% | TODO |

### Load (50 VUs, 5 min) — gate cron semanal

| Métrica | Threshold | Verdict UAT |
|---|---|---|
| `http_req_duration` p95 global | < 1500 ms | TODO |
| `POST /v1/chatbot/message` p95 | < 800 ms (relax — KB lookup + LLM) | TODO |
| `GET /v1/reports/utilizacion` p95 | < 1500 ms | TODO |
| `GET /v1/insureds` paginated p95 | < 500 ms | TODO |
| Error rate | < 1% | TODO |

### Stress (200 VUs, 10 min) — gate manual pre-Go-Live

| Métrica | Threshold | Verdict UAT |
|---|---|---|
| HTTP 429 ratio (rate limiter activo) | ≥ 50% | TODO |
| Error rate (5xx + timeouts) | < 5% | TODO |
| API recupera < 60s tras stop de stress | sí | TODO |

### DAST gate

| Check | Threshold | Verdict UAT |
|---|---|---|
| OWASP ZAP findings High | 0 | TODO |
| OWASP ZAP findings Medium | 0 | TODO |
| Reporte adjunto a sign-off | sí | TODO |

> Performance + DAST sign-off lo da G-2 antes que MAC firme UAT funcional.
> Si cualquier celda queda en "FAIL", se bloquea el Go-Live día 30.

---

## Iter 2 pendientes (DS-1)

- [ ] Anotar evidencias (screenshots) por escenario.
- [ ] Aplicar comentarios stakeholders post-sesión.
- [ ] Cerrar TODO de performance con valores reales (G-2).
