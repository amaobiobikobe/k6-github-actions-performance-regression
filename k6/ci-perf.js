// The performance test that runs on every pull request.
//
// Same idea as 03-load-test.js, tuned for CI:
//  * a fixed number of users for a fixed time, so two runs are comparable
//  * every VU logs in ONCE and owns a few items, then loops over the hot endpoints
//  * one threshold per tagged endpoint (without a threshold, k6 doesn't
//    report the endpoint on its own in the summary, and compare.py can't see it)
//
// Run locally:  k6 run k6/ci-perf.js
// In CI:        k6 run --summary-export results/pr.json k6/ci-perf.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const options = {
  vus: 10,
  duration: '45s',
  // Absolute limits (your SLO). Break one and k6 exits with code 99.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{name:GET /users/me}': ['p(95)<200'],
    'http_req_duration{name:GET /items}': ['p(95)<300'],
    'http_req_duration{name:GET /items/{id}}': ['p(95)<200'],
    'http_req_duration{name:PATCH /items/{id}}': ['p(95)<300'],
  },
};

// Module-level variables live once PER VU: this is each user's "session".
let session = null;

function signupAndLogin() {
  const email = `ci_${exec.vu.idInTest}_${Date.now()}@example.com`;
  const password = 'SuperSecret123!';

  http.post(`${BASE_URL}/auth/signup`, JSON.stringify({ email, password, full_name: 'CI User' }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /auth/signup' },
  });
  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email, password }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /auth/login' },
  });
  check(res, { 'login: has token': (r) => !!r.json('access_token') });

  const headers = { ...JSON_HEADERS, Authorization: `Bearer ${res.json('access_token')}` };

  const itemIds = [];
  for (let i = 0; i < 5; i++) {
    const item = http.post(`${BASE_URL}/items`, JSON.stringify({ name: `CI item ${i}`, price: 10, quantity: 1 }), {
      headers,
      tags: { name: 'POST /items' },
    });
    itemIds.push(item.json('id'));
  }
  return { headers, itemIds };
}

export default function () {
  if (!session) session = signupAndLogin();
  const { headers, itemIds } = session;
  const itemId = itemIds[Math.floor(Math.random() * itemIds.length)];

  const me = http.get(`${BASE_URL}/users/me`, { headers, tags: { name: 'GET /users/me' } });
  check(me, { 'me: 200': (r) => r.status === 200 });

  const list = http.get(`${BASE_URL}/items`, { headers, tags: { name: 'GET /items' } });
  check(list, { 'list: returns my 5 items': (r) => r.status === 200 && r.json().length === 5 });

  const one = http.get(`${BASE_URL}/items/${itemId}`, { headers, tags: { name: 'GET /items/{id}' } });
  check(one, { 'get item: 200': (r) => r.status === 200 });

  const upd = http.patch(`${BASE_URL}/items/${itemId}`, JSON.stringify({ quantity: Math.floor(Math.random() * 100) }), {
    headers,
    tags: { name: 'PATCH /items/{id}' },
  });
  check(upd, { 'update item: 200': (r) => r.status === 200 });

  sleep(0.5);
}
