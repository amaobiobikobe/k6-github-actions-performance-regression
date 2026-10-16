// Run: k6 run k6/01-smoke.js
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8000';

export const options = {
  vus: 1,          // 1 virtual user
  duration: '10s', // for 10 seconds
};

// Every VU runs this function in a loop until the test ends.
export default function () {
  const res = http.get(`${BASE_URL}/health`);

  check(res, {
    'status is 200': (r) => r.status === 200,
    'body says ok': (r) => r.json('status') === 'ok',
  });

  sleep(1); // think time: real users don't hammer the API non-stop
}
