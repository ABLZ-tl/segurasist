// Sprint 4 — S4-10 — k6 admin load test (100 vu).
//
// Uso local:
//   BASE_URL=https://api.staging.segurasist.com \
//   k6 run -e VUS=100 -e RAMPUP=120 -e DURATION=600 admin.k6.js

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { randomItem, uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import papaparse from 'https://jslib.k6.io/papaparse/5.1.1/index.js';

const BASE_URL = __ENV.BASE_URL || 'https://api.staging.segurasist.com';
const TENANT_ID = __ENV.TENANT_ID || 'hospitales-mac';
const VUS = parseInt(__ENV.VUS || '100', 10);
const RAMPUP = parseInt(__ENV.RAMPUP || '120', 10);
const DURATION = parseInt(__ENV.DURATION || '600', 10);

const admins = new SharedArray('admins', () => {
  const csv = open('../jmeter/data/admins.csv');
  return papaparse.parse(csv, { header: true, skipEmptyLines: true }).data;
});

const trendList = new Trend('lat_insureds_list', true);
const trendBatches = new Trend('lat_batches', true);
const trendCreate = new Trend('lat_insured_create', true);
const trendPatch = new Trend('lat_insured_patch', true);
const trendReports = new Trend('lat_reports', true);
const trendTimeline = new Trend('lat_audit_timeline', true);
const trendExports = new Trend('lat_exports', true);
const errors = new Rate('errors');

export const options = {
  scenarios: {
    admin_ramp: {
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
    http_req_duration: ['p(95)<500', 'p(99)<1500'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
    // POST /v1/exports y reports admiten p95 más alto (consultas pesadas).
    lat_reports: ['p(95)<1500'],
    lat_exports: ['p(95)<2000'],
    lat_insureds_list: ['p(95)<500'],
    lat_audit_timeline: ['p(95)<700'],
  },
};

function login(creds) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Tenant': TENANT_ID,
  };
  const res = http.post(
    `${BASE_URL}/v1/auth/login`,
    JSON.stringify({ email: creds.email, password: creds.password }),
    { headers, tags: { name: 'auth_login' } },
  );
  check(res, { 'login 200': (x) => x.status === 200 });
  return res.status === 200 ? res.json('accessToken') : null;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant': TENANT_ID,
  };
}

export default function () {
  const creds = randomItem(admins);
  const token = login(creds);
  if (!token) {
    errors.add(1);
    return;
  }
  const headers = authHeaders(token);

  const r = Math.random();
  if (r < 0.25) {
    group('GET /v1/insureds (paginated)', () => {
      const page = 1 + Math.floor(Math.random() * 50);
      const res = http.get(
        `${BASE_URL}/v1/insureds?page=${page}&pageSize=20`,
        { headers },
      );
      trendList.add(res.timings.duration);
      check(res, { '2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else if (r < 0.40) {
    group('GET /v1/batches', () => {
      const res = http.get(`${BASE_URL}/v1/batches?page=1&pageSize=20`, {
        headers,
      });
      trendBatches.add(res.timings.duration);
      check(res, { '2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else if (r < 0.55) {
    group('POST /v1/insureds', () => {
      const body = {
        curp: `PERF${Math.floor(Math.random() * 1e6)
          .toString()
          .padStart(6, '0')}HMC${Math.floor(Math.random() * 1e6)
          .toString()
          .padStart(6, '0')}`.slice(0, 18),
        firstName: 'Perf',
        lastName: 'Test',
        email: `perf+${uuidv4()}@test.local`,
        planId: 'plan-base',
      };
      const res = http.post(`${BASE_URL}/v1/insureds`, JSON.stringify(body), {
        headers,
      });
      trendCreate.add(res.timings.duration);
      check(res, { '2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else if (r < 0.65) {
    group('PATCH /v1/insureds/:id', () => {
      const res = http.patch(
        `${BASE_URL}/v1/insureds/${creds.target_insured_id}`,
        JSON.stringify({
          phone: `+5215555${Math.floor(Math.random() * 1e6)
            .toString()
            .padStart(6, '0')}`,
        }),
        { headers },
      );
      trendPatch.add(res.timings.duration);
      check(res, { '2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else if (r < 0.80) {
    group('GET /v1/reports/conciliacion', () => {
      const res = http.get(
        `${BASE_URL}/v1/reports/conciliacion?from=2026-03-01&to=2026-03-31`,
        { headers },
      );
      trendReports.add(res.timings.duration);
      check(res, { '2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else if (r < 0.90) {
    group('GET /v1/audit/timeline', () => {
      const res = http.get(
        `${BASE_URL}/v1/audit/timeline?insuredId=${creds.target_insured_id}&page=1&pageSize=50`,
        { headers },
      );
      trendTimeline.add(res.timings.duration);
      check(res, { '2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  } else {
    group('POST /v1/exports', () => {
      const res = http.post(
        `${BASE_URL}/v1/exports`,
        JSON.stringify({
          resource: 'insureds',
          format: 'csv',
          filters: { createdAfter: '2026-01-01' },
        }),
        { headers },
      );
      trendExports.add(res.timings.duration);
      check(res, { '2xx': (x) => x.status >= 200 && x.status < 300 }) ||
        errors.add(1);
    });
  }

  sleep(1 + Math.random() * 2);
}

export function handleSummary(data) {
  return {
    'results/admin-summary.json': JSON.stringify(data, null, 2),
    stdout: textSummary(data),
  };
}

function textSummary(data) {
  const m = data.metrics;
  const p95 = m.http_req_duration?.values?.['p(95)']?.toFixed(0);
  const p99 = m.http_req_duration?.values?.['p(99)']?.toFixed(0);
  const errRate = ((m.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2);
  return `\nSegurAsist Admin Load — VUs=${VUS}\n  p95=${p95}ms  p99=${p99}ms  errors=${errRate}%\n`;
}
