## [G-2 iter 2] 2026-04-28

**Owner**: G-2 (QA Performance + DAST).
**Estado**: COMPLETE iter 2 — exclusion CC-13 shipped, secrets documentados,
k6 syntax check pasado (1 fix defensivo).

### Plan

Cerrar 4 puntos de cierre Sprint 5: (1) exclusión SAML en DAST (CC-13),
(2) provisioning de secret `PERF_ADMIN_PASS` documentado en workflows,
(3) validar sintaxis k6 baseline, (4) actualizar reportes con esquema final.

### Hechos

- **CC-13 cerrado** — `tests/dast/sprint5-zap-config.yaml`:
  - `excludePaths` añade `/v1/auth/saml/acs` y `/v1/auth/saml/login` con
    bloque comentado YAML explicando el motivo: ZAP no puede orquestar el
    flow SAML real (`AuthnRequest → IdP login → assertion firmada`), y un
    fuzz ciego sobre el ACS sólo genera ruido de auditoría + miles de
    session attempts inválidos en cognito-local sin encontrar vulns
    reales (parser falla en verificación de firma antes de tocar lógica).
  - `forceUrls` ya no incluye el POST a `/v1/auth/saml/acs` (dejaba un
    fuzz manual contradictorio con el `excludePaths`). Mantenemos sólo
    el GET a `/v1/auth/saml/metadata` (read-only, charset NF-G2-01).
- **Secrets provisionados y documentados** — `.github/workflows/perf.yml`
  y `.github/workflows/dast.yml`:
  - Header bloque comentado en cada workflow listando secrets
    requeridos (`PERF_ADMIN_USER`, `PERF_ADMIN_PASS`), pasos de
    provisioning en GH Actions UI (Settings → Secrets and variables →
    Actions → New repository secret), recomendación de mover a
    Environment secrets `staging` para aislar de prod, y verificación
    `gh secret list`.
  - Canónico: `PERF_ADMIN_USER` (alias legacy `PERF_ADMIN_EMAIL`
    aceptado vía `secrets.PERF_ADMIN_USER || secrets.PERF_ADMIN_EMAIL`
    para no romper iter 1).
  - `dast.yml` ahora expone `ZAP_USER`/`ZAP_PASS` como `env:` en el
    step `OWASP ZAP Baseline` para que `tests/dast/sprint5-zap-config.yaml`
    pueda hacer login auth en active scan futuro.
  - TODO inline: cuando exista `.github/SECRETS.md`, migrar bloque
    de header a doc dedicado (G-2 iter 2 dejó comentario porque el
    archivo no existe — sólo `README.md` en `.github/`).
- **k6 syntax check** — `tests/performance/k6/sprint5-baseline.js`:
  - Imports `http`, `check`, `sleep`, `group`, `Trend`, `Rate`,
    `Counter`, `uuidv4` — todos válidos contra k6 ≥ 0.50.
  - `options.scenarios` con `executor: 'constant-vus'` + `'ramping-vus'`,
    `exec` apuntando a funciones exportadas (`smoke`/`load`/`stress`)
    — válido.
  - `thresholds` syntax `'http_req_duration{scenario:smoke}': ['p(95)<500']`
    correcto (`p(<NN>)<value`).
  - `summaryTrendStats` y `handleSummary` válidos.
  - **Fix defensivo aplicado**: scope thresholds al scenario activo
    (k6 ≥ 0.50 emite warning "threshold metric not found" si una
    threshold key referencia un scenario no corriendo). Ahora se filtra
    por `SCENARIO` env var; si `SCENARIO=all` aplican todas. Threshold
    `errors` siempre activa (independiente de scenario).
- **`docs/sprint5/DAST_REPORT.md`**: sección "Excluidos" añade entradas
  SAML con motivo completo + referencia a CC-13. "Próximos pasos"
  actualiza nombres de secrets (`PERF_ADMIN_USER` + `PERF_ADMIN_PASS`).
- **`docs/sprint5/COVERAGE_DIFF.md`**: tabla simplificada al esquema
  pedido (`module | before | after | delta | threshold | pass?`).
  Instrucciones de llenado claras para validation gate D5 (parsear
  `coverage-summary.json` → `total.statements.pct`).

### NEW-FINDING

- **NF-G2-06** (iter 2): Si en validation gate D5 algún módulo quedó <
  threshold (60 default / 80 security-critical), regla dura: bloquea
  Go-Live día 30. Owner correctivo: agente del módulo correspondiente.
  Propagación a `_features-feed.md` cuando se ejecute la suite real.

### Bloqueos

- Sandbox no permite ejecutar k6/ZAP/playwright; el fix de thresholds
  scope no fue validado en runtime — CI lo cubrirá en el primer push
  con `paths` matching (`tests/performance/k6/sprint5-baseline.js`).
- `.github/SECRETS.md` no existe; bloque de provisioning quedó como
  comentario inline en headers de los 2 workflows.

### Para iter 3 / cross-cutting

- Crear `.github/SECRETS.md` consolidado (no es scope de G-2; sugerido
  para PM o DS-1 cuando documente secrets de Lordicon CDN).
- Si CI corre y reporta "threshold metric not found", reintroducir todas
  las thresholds (k6 < 0.50 acepta sin warning).
- Cuando el run real popule `baseline.json`, revisar que `delta` en
  COVERAGE_DIFF.md no sea negativo en módulos críticos (auth/saml,
  scim, security).
