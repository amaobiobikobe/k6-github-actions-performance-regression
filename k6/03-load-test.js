//
// Differences from 02:
//  * Each virtual user signs up + logs in ONCE, then reuses its token,
//    like a real user who logs in and then clicks around for a while.
//  * Load ramps up and down with `stages` instead of a flat line.
//  * Per-endpoint thresholds, so you see exactly which endpoint is slow.
//
// Run: k6 run k6/03-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const options = {
  stages: [
    { duration: '30s', target: 20 }, // ramp up to 20 users
    { duration: '1m', target: 20 },  // stay at 20 users
    { duration: '20s', target: 0 },  // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{name:POST /auth/login}': ['p(95)<800'], // hashing passwords is expensive on purpose
    'http_req_duration{name:GET /users/me}': ['p(95)<200'],
    'http_req_duration{name:GET /items}': ['p(95)<300'],
    'http_req_duration{name:PATCH /items/{id}}': ['p(95)<300'],
  },
};

// Module-level variables live once PER VU, so this is our per-user "session".
let session = null;

function signupAndLogin() {
  const email = `load_${exec.vu.idInTest}_${Date.now()}@example.com`;
  const password = 'SuperSecret123!';

  http.post(`${BASE_URL}/auth/signup`, JSON.stringify({ email, password, full_name: 'Load User' }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /auth/signup' },
  });

  const res = http.post(`${BASE_URL}/auth/login`, JSON.stringify({ email, password }), {
    headers: JSON_HEADERS,
    tags: { name: 'POST /auth/login' },
  });
  check(res, { 'login: 200': (r) => r.status === 200 });

  const headers = { ...JSON_HEADERS, Authorization: `Bearer ${res.json('access_token')}` };

  // Give every user one item to work with.
  const item = http.post(`${BASE_URL}/items`, JSON.stringify({ name: 'Starter item', price: 10, quantity: 1 }), {
    headers,
    tags: { name: 'POST /items' },
  });

  return { headers, itemId: item.json('id') };
}

export default function () {
  if (!session) session = signupAndLogin();
  const { headers, itemId } = session;

  const me = http.get(`${BASE_URL}/users/me`, { headers, tags: { name: 'GET /users/me' } });
  check(me, { 'me: 200': (r) => r.status === 200 });

  const list = http.get(`${BASE_URL}/items`, { headers, tags: { name: 'GET /items' } });
  check(list, { 'list items: 200': (r) => r.status === 200 });

  const upd = http.patch(
    `${BASE_URL}/items/${itemId}`,
    JSON.stringify({ quantity: Math.floor(Math.random() * 100) }),
    { headers, tags: { name: 'PATCH /items/{id}' } },
  );
  check(upd, { 'update item: 200': (r) => r.status === 200 });

  sleep(Math.random() * 2 + 1); // 1–3s think time
}
