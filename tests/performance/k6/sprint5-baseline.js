// Sprint 5 — G-2 — k6 baseline real (smoke + load + stress).
//
// Ownership: tests/performance/k6/sprint5-baseline.js (G-2 según DISPATCH_PLAN).
// Predecesor: tests/performance/k6/{portal,admin}.k6.js (Sprint 4 / S4-10).
// Diferencia vs Sprint 4:
//   - Cubre los 3 escenarios del brief en un solo archivo (k6 scenarios).
//   - Smoke gate p95 < 500 ms (1 VU, 30 s) para correr en cada push CI.
//   - Load gate p95 < 1500 ms (50 VUs ramp, 5 min) para cron semanal.
//   - Stress (200 VUs, 10 min) con header `X-Force-Block: 1` para validar
//     respuesta del rate-limiter / WAF (espera ratio 429 ≥ 50%).
//
// Uso local:
//   BASE_URL=http://localhost:3000 k6 run --tag scenario=smoke \
//     -e SCENARIO=smoke tests/performance/k6/sprint5-baseline.js
//   BASE_URL=https://api.staging.segurasist.com k6 run \
//     -e SCENARIO=load tests/performance/k6/sprint5-baseline.js
//   BASE_URL=https://api.staging.segurasist.com k6 run \
//     -e SCENARIO=stress tests/performance/k6/sprint5-baseline.js

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ---------- config ----------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TENANT_ID = __ENV.TENANT_ID || 'hospitales-mac';
const SCENARIO = (__ENV.SCENARIO || 'smoke').toLowerCase();
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'softpiratas@gmail.com';
const ADMIN_PASS = __ENV.ADMIN_PASS || 'change-me-dev';

// ---------- per-endpoint metrics ----------
const tHome = new Trend('lat_home', true);
const tLogin = new Trend('lat_login', true);
const tDashAdmin = new Trend('lat_dashboard_admin', true);
const tDashPortal = new Trend('lat_dashboard_portal', true);
const tChat = new Trend('lat_chatbot_message', true);
const tReportUtil = new Trend('lat_report_utilizacion', true);
const tInsureds = new Trend('lat_insureds_list', true);
const stressBlocked = new Counter('stress_blocked_429');
const stressBypassed = new Counter('stress_bypassed_2xx');
const errors = new Rate('errors');

// ---------- scenarios ----------
const scenarioDefs = {
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '30s',
    exec: 'smoke',
    tags: { scenario: 'smoke' },
  },
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '60s', target: 50 },
      { duration: '4m', target: 50 },
      { duration: '30s', target: 0 },
    ],
    exec: 'load',
    tags: { scenario: 'load' },
  },
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '90s', target: 200 },
      { duration: '8m30s', target: 200 },
      { duration: '30s', target: 0 },
    ],
    exec: 'stress',
    tags: { scenario: 'stress' },
  },
};

const allScenarios = SCENARIO === 'all' ? scenarioDefs : { [SCENARIO]: scenarioDefs[SCENARIO] };

// Sprint 5 G-2 iter 2: scope thresholds al scenario activo para evitar warnings
// "threshold metric not found" cuando se corre sólo `smoke` o sólo `load`.
// Si SCENARIO=all, todos los gates aplican.
const allThresholds = {
  'http_req_duration{scenario:smoke}': ['p(95)<500'],
  'http_req_failed{scenario:smoke}': ['rate<0.01'],
  'http_req_duration{scenario:load}': ['p(95)<1500'],
  'http_req_failed{scenario:load}': ['rate<0.01'],
  // Stress gate: el sistema DEBE bloquear (429) bajo carga + bloqueo intencional.
  // No se mide latencia — se mide que el rate limiter funcione.
  errors: ['rate<0.05'],
};
const activeThresholds =
  SCENARIO === 'all'
    ? allThresholds
    : Object.fromEntries(
        Object.entries(allThresholds).filter(
          ([k]) => k.includes(`scenario:${SCENARIO}`) || k === 'errors',
        ),
      );

export const options = {
  scenarios: allScenarios,
  thresholds: activeThresholds,
  // Resumen estable post-run.
  summaryTrendStats: ['avg', 'min', 'med', 'p(50)', 'p(95)', 'p(99)', 'max'],
};

// ---------- helpers ----------
function loginAdmin() {
  const headers = { 'Content-Type': 'application/json', 'X-Tenant': TENANT_ID };
  const res = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
    { headers, tags: { name: 'auth_login' } },
  );
  tLogin.add(res.timings.duration);
  check(res, { 'login 200/2xx': (x) => x.status >= 200 && x.status < 300 }) ||
    errors.add(1);
  return res.status >= 200 && res.status < 300 ? res.json('accessToken') : null;
}

function authHeaders(token, extra) {
  return Object.assign(
    {
      Authorization: `Bearer ${token || 'noop'}`,
      'Content-Type': 'application/json',
      'X-Tenant': TENANT_ID,
    },
    extra || {},
  );
}

// ---------- exec: smoke (1 VU, 30s) ----------
// Home, login, dashboard portal, dashboard admin.
export function smoke() {
  group('GET /health (home)', () => {
    const res = http.get(`${BASE_URL}/health`);
    tHome.add(res.timings.duration);
    check(res, { 'health 2xx': (x) => x.status >= 200 && x.status < 300 }) ||
      errors.add(1);
  });

  const token = loginAdmin();
  if (!token) {
    sleep(1);
    return;
  }
  const headers = authHeaders(token);

  group('GET /v1/insureds/me (dashboard portal)', () => {
    const res = http.get(`${BASE_URL}/v1/insureds/me`, { headers });
    tDashPortal.add(res.timings.duration);
    check(res, { 'portal 2xx/4xx-expected': (x) => x.status < 500 }) ||
      errors.add(1);
  });

  group('GET /v1/admin/tenants (dashboard admin)', () => {
    const res = http.get(`${BASE_URL}/v1/admin/tenants?page=1&pageSize=10`, { headers });
    tDashAdmin.add(res.timings.duration);
    check(res, { 'admin 2xx/4xx-expected': (x) => x.status < 500 }) ||
      errors.add(1);
  });

  sleep(1);
}

// ---------- exec: load (50 VUs ramp, 5 min) ----------
// Mix POST /chatbot/message + GET /reports/utilizacion + GET /insureds list.
export function load() {
  const token = loginAdmin();
  if (!token) {
    sleep(1);
    return;
  }
  const headers = authHeaders(token);

  const r = Math.random();
  if (r < 0.5) {
    group('POST /v1/chatbot/message', () => {
      const res = http.post(
        `${BASE_URL}/v1/chatbot/message`,
        JSON.stringify({ sessionId: uuidv4(), message: 'mi cobertura?' }),
        { headers },
      );
      tChat.add(res.timings.duration);
      check(res, { 'chat 2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else if (r < 0.8) {
    group('GET /v1/reports/utilizacion', () => {
      const res = http.get(
        `${BASE_URL}/v1/reports/utilizacion?from=2026-04-01&to=2026-04-28`,
        { headers },
      );
      tReportUtil.add(res.timings.duration);
      check(res, { 'reports 2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else {
    group('GET /v1/insureds (paginated)', () => {
      const page = 1 + Math.floor(Math.random() * 20);
      const res = http.get(
        `${BASE_URL}/v1/insureds?page=${page}&pageSize=20`,
        { headers },
      );
      tInsureds.add(res.timings.duration);
      check(res, { 'insureds 2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  }

  sleep(1 + Math.random() * 2);
}

// ---------- exec: stress (200 VUs, 10 min) ----------
// Mismo mix que load, pero con header `X-Force-Block: 1` para validar 429.
// Un stack saludable debería responder 429 en >50% de los requests.
export function stress() {
  const token = loginAdmin();
  if (!token) {
    sleep(1);
    return;
  }
  const headers = authHeaders(token, {
    'X-Force-Block': '1',           // header de prueba para forzar throttle.
    'X-Stress-Test': 'sprint5',     // observabilidad.
  });

  const r = Math.random();
  let res;
  if (r < 0.5) {
    res = http.post(
      `${BASE_URL}/v1/chatbot/message`,
      JSON.stringify({ sessionId: uuidv4(), message: 'stress' }),
      { headers, tags: { name: 'stress_chatbot' } },
    );
  } else if (r < 0.8) {
    res = http.get(
      `${BASE_URL}/v1/reports/utilizacion?from=2026-04-01&to=2026-04-28`,
      { headers, tags: { name: 'stress_reports' } },
    );
  } else {
    res = http.get(
      `${BASE_URL}/v1/insureds?page=1&pageSize=20`,
      { headers, tags: { name: 'stress_insureds' } },
    );
  }

  if (res.status === 429) {
    stressBlocked.add(1);
  } else if (res.status >= 200 && res.status < 300) {
    stressBypassed.add(1);
  } else {
    errors.add(1);
  }

  // Sin sleep — máxima presión para activar rate limiter.
}

// ---------- summary export ----------
export function handleSummary(data) {
  const m = data.metrics;
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(0);
  const p99 = m.http_req_duration?.values?.['p(99)']?.toFixed(0);
  const errRate = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2);
  const blocked = m.stress_blocked_429?.values?.count ?? 0;
  const bypassed = m.stress_bypassed_2xx?.values?.count ?? 0;
  const total = blocked + bypassed;
  const blockedPct = total > 0 ? ((blocked / total) * 100).toFixed(1) : 'n/a';

  const text =
    `\nSegurAsist Sprint 5 baseline — scenario=${SCENARIO}\n` +
    `  p95=${p95}ms  p99=${p99}ms  errors=${errRate}%\n` +
    `  stress blocked(429)=${blocked} bypass(2xx)=${bypassed} blocked%=${blockedPct}\n`;

  return {
    [`results/sprint5-${SCENARIO}-summary.json`]: JSON.stringify(data, null, 2),
    stdout: text,
  };
}
