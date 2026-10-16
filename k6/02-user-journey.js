import http from "k6/http";
import { check, sleep, group } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
const JSON_HEADERS = { "Content-Type": "application/json" };

export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500"],
    checks: ["rate>0.99"],
    "http_req_duration{name:POST /auth/signup}": ["p(95)<500"],
    "http_req_duration{name:POST /auth/login}": ["p(95)<500"],
    "http_req_duration{name:GET /users/me}": ["p(95)<200"],
    "http_req_duration{name:POST /items}": ["p(95)<200"],
    "http_req_duration{name:PATCH /items/{id}}": ["p(95)<200"],
    "http_req_duration{name:GET /items/{id}}": ["p(95)<200"],
  },
};

export default function () {
  const email = `user_${__VU}_${__ITER}_${Date.now()}@example.com`;
  const password = "SuperSecret123!";

  let token;
  let itemId;

  group("1. signup", () => {
    const res = http.post(
      `${BASE_URL}/auth/signup`,
      JSON.stringify({
        email,
        password,
        full_name: `k6 user ${__VU}`,
      }),
      { headers: JSON_HEADERS, tags: { name: "POST /auth/signup" } },
    );

    check(res, {
      "signup: 201": (r) => r.status === 201,
    });
  });
  group("2. login", () => {
    const res = http.post(
      `${BASE_URL}/auth/login`,
      JSON.stringify({ email, password }),
      {
        headers: JSON_HEADERS,
        tags: { name: "POST /auth/login" },
      },
    );

    check(res, {
      "login: 200": (r) => r.status === 200,
      "login: has token": (r) => !!r.json("access_token"),
    });

    token = res.json("access_token");
  });

  if (!token) {
    sleep(1);
    return;
  }

  const authHeaders = { ...JSON_HEADERS, Authorization: `Bearer ${token}` };

  group("3. get my profile", () => {
    const res = http.get(`${BASE_URL}/users/me`, {
      headers: authHeaders,
      tags: { name: "GET /users/me" },
    });

    check(res, {
      "me: 200": (r) => r.status === 200,
      "me: correct email": (r) => r.json("email") === email,
    });
  });

  group("4. create item", () => {
    const res = http.post(
      `${BASE_URL}/items`,
      JSON.stringify({
        name: "Keyboard",
        price: 120.5,
        quantity: 1,
      }),
      {
        headers: authHeaders,
        tags: {
          name: "POST /items",
        },
      },
    );

    check(res, {
      "create item: 201": (r) => r.status === 201,
    });

    itemId = res.json("id");
  });

  group("5. update item", () => {
    const res = http.patch(
      `${BASE_URL}/items/${itemId}`,
      JSON.stringify({
        price: 99.99,
        quantity: 3,
      }),
      {
        headers: authHeaders,
        tags: { name: "PATCH /items/{id}" },
      },
    );

    check(res, {
      "update item: 200": (r) => r.status === 200,
      "update item: price changed": (r) => r.json("price") === 99.99,
    });
  });

  group("6. get item", () => {
    const res = http.get(`${BASE_URL}/items/${itemId}`, {
      headers: authHeaders,
      tags: {
        name: "GET /items/{id}",
      },
    });

    check(res, {
      "get item: quantity is 3": (r) => r.json("quantity") === 3,
    });
  });

  sleep(1);
}
