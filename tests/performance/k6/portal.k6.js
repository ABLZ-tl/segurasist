// Sprint 4 — S4-10 — k6 portal load test (alternativa moderna a JMeter).
//
// Uso local:
//   BASE_URL=https://api.staging.segurasist.com \
//   k6 run -e VUS=1000 -e RAMPUP=300 -e DURATION=600 portal.k6.js
//
// Thresholds (CI gate equivalente al .jmx):
//   - http_req_duration p95 ≤ 500 ms
//   - http_req_failed   ≤ 1%
//
// Mix:
//   30% GET  /v1/insureds/me
//   25% GET  /v1/insureds/me/coverages
//   20% GET  /v1/certificates/mine
//   15% POST /v1/chatbot/message
//   10% POST /v1/claims

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { randomItem, uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

// ---------- config ----------
const BASE_URL = __ENV.BASE_URL || 'https://api.staging.segurasist.com';
const TENANT_ID = __ENV.TENANT_ID || 'hospitales-mac';
const VUS = parseInt(__ENV.VUS || '1000', 10);
const RAMPUP = parseInt(__ENV.RAMPUP || '300', 10); // seconds
const DURATION = parseInt(__ENV.DURATION || '600', 10);

const insureds = new SharedArray('insureds', () => {
  const csv = open('../jmeter/data/insureds.csv');
  return papaparse.parse(csv, { header: true, skipEmptyLines: true }).data;
});

// ---------- per-endpoint metrics ----------
const trendMe = new Trend('lat_me', true);
const trendCov = new Trend('lat_coverages', true);
const trendCerts = new Trend('lat_certs', true);
const trendChat = new Trend('lat_chatbot', true);
const trendClaims = new Trend('lat_claims', true);
const errors = new Rate('errors');

// ---------- options ----------
export const options = {
  scenarios: {
    portal_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: `${RAMPUP}s`, target: VUS },
        { duration: `${DURATION}s`, target: VUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    // Gate global S4-10: p95 ≤ 500 ms en todos los endpoints API.
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
    // Per-endpoint guard rails (más estrictos en lectura).
    lat_me: ['p(95)<300'],
    lat_coverages: ['p(95)<400'],
    lat_certs: ['p(95)<400'],
    lat_chatbot: ['p(95)<800'], // chatbot puede ser más lento (LLM)
    lat_claims: ['p(95)<500'],
  },
};

// ---------- setup: pre-warm tokens (subset) ----------
export function setup() {
  return { startedAt: Date.now() };
}

// ---------- helpers ----------
function login() {
  const fixture = randomItem(insureds);
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant': TENANT_ID,
  };
  const reqRes = http.post(
    `${BASE_URL}/v1/auth/otp/request`,
    JSON.stringify({ channel: 'insured', identifier: fixture.curp }),
    { headers, tags: { name: 'auth_otp_request' } },
  );
  check(reqRes, { 'otp/request 2xx': (r) => r.status >= 200 && r.status < 300 });

  const verifyRes = http.post(
    `${BASE_URL}/v1/auth/otp/verify`,
    JSON.stringify({
      channel: 'insured',
      identifier: fixture.curp,
      code: fixture.otp_code,
    }),
    { headers, tags: { name: 'auth_otp_verify' } },
  );
  check(verifyRes, { 'otp/verify 200': (r) => r.status === 200 });
  const body = verifyRes.json();
  return body && body.accessToken ? body.accessToken : null;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant': TENANT_ID,
  };
}

// ---------- vu lifecycle ----------
export default function () {
  // En cada iteración de VU primero login. En despliegues reales se cachearía
  // por VU con __ITER === 0; aquí simplificamos para no acumular sesiones.
  const token = login();
  if (!token) {
    errors.add(1);
    return;
  }
  const headers = authHeaders(token);

  // Roll dado para weighted mix.
  const r = Math.random();
  if (r < 0.30) {
    group('GET /v1/insureds/me', () => {
      const res = http.get(`${BASE_URL}/v1/insureds/me`, { headers });
      trendMe.add(res.timings.duration);
      check(res, { 'me 2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else if (r < 0.55) {
    group('GET /v1/insureds/me/coverages', () => {
      const res = http.get(`${BASE_URL}/v1/insureds/me/coverages`, { headers });
      trendCov.add(res.timings.duration);
      check(res, { 'cov 2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else if (r < 0.75) {
    group('GET /v1/certificates/mine', () => {
      const res = http.get(`${BASE_URL}/v1/certificates/mine`, { headers });
      trendCerts.add(res.timings.duration);
      check(res, { 'certs 2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else if (r < 0.90) {
    group('POST /v1/chatbot/message', () => {
      const res = http.post(
        `${BASE_URL}/v1/chatbot/message`,
        JSON.stringify({
          sessionId: uuidv4(),
          message: 'Cuál es mi cobertura para hospital MAC?',
        }),
        { headers },
      );
      trendChat.add(res.timings.duration);
      check(res, { 'chat 2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else {
    group('POST /v1/claims', () => {
      const res = http.post(
        `${BASE_URL}/v1/claims`,
        JSON.stringify({
          type: 'reembolso',
          amountCents: 150000,
          description: 'Consulta especialista',
          providerName: 'Hospital MAC',
        }),
        { headers },
      );
      trendClaims.add(res.timings.duration);
      check(res, { 'claims 2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  }

  // Think time 1-3 s (uniforme para simplicidad).
  sleep(1 + Math.random() * 2);
}

// k6 summary export → consumido por parse-jtl.sh equivalente (k6 produce JSON nativo)
export function handleSummary(data) {
  return {
    'results/portal-summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(0);
  const p99 = m.http_req_duration?.values?.['p(99)']?.toFixed(0);
  const errRate = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2);
  return `\nSegurAsist Portal Load — VUs=${VUS}\n  p95=${p95}ms  p99=${p99}ms  errors=${errRate}%\n`;
}
