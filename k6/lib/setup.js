import http from "k6/http";
import {
  BASE_URL,
  NUM_USERS,
  TODOS_PER_USER,
  USER_EMAIL_PREFIX,
  USER_EMAIL_DOMAIN,
  USER_PASSWORD,
} from "./config.js";

const JSON_HEADERS = { "Content-Type": "application/json" };

// THE most important rule in this harness: tokens are minted ONCE, here, never
// inside an iteration.
//
// Registration and login both run argon2id, which is ~50-100ms of NATIVE work
// on the libuv threadpool. That pool defaults to 4 threads and is shared with
// fs and DNS. Logging in per iteration caps the whole test at roughly 40-80 rps
// and starves unrelated I/O — you would spend the afternoon "optimizing" a
// bottleneck that no real traffic pattern produces.
// The power user for experiment 6: seeded out of band with ~20k todos, so one
// export is genuinely expensive rather than artificially slowed down.
export const POWER_USER_EMAIL = `k6-power${USER_EMAIL_DOMAIN}`;

export function mintPowerUserToken() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: POWER_USER_EMAIL, password: USER_PASSWORD }),
    { headers: JSON_HEADERS, tags: { name: "setup:login" } },
  );
  if (res.status !== 200) {
    throw new Error(
      `setup: power user ${POWER_USER_EMAIL} not available — ${res.status}. ` +
        `Seed it first (see experiment 6 in k6/README.md).`,
    );
  }
  return res.json("accessToken");
}

// Experiment 7: one user, on the FREE plan, with zero todos so the quota is
// exercised from a known starting point. Existing rows are deleted through the
// API so the run is repeatable without touching the database directly.
export const QUOTA_USER_EMAIL = `k6-quota${USER_EMAIL_DOMAIN}`;

export function mintQuotaUser() {
  const body = JSON.stringify({
    email: QUOTA_USER_EMAIL,
    password: USER_PASSWORD,
  });

  let res = http.post(`${BASE_URL}/auth/register`, body, {
    headers: JSON_HEADERS,
    tags: { name: "setup:register" },
  });
  if (res.status === 409) {
    res = http.post(`${BASE_URL}/auth/login`, body, {
      headers: JSON_HEADERS,
      tags: { name: "setup:login" },
    });
  }
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`setup: quota user auth failed — ${res.status} ${res.body}`);
  }

  const token = res.json("accessToken");
  const headers = { ...JSON_HEADERS, Authorization: `Bearer ${token}` };

  // Drain whatever a previous run left behind.
  for (;;) {
    const list = http.get(`${BASE_URL}/todos?limit=100`, {
      headers,
      tags: { name: "setup:drain" },
    });
    const items = list.json("items");
    if (!items || items.length === 0) break;
    for (const t of items) {
      http.del(`${BASE_URL}/todos/${t.id}`, null, {
        headers,
        tags: { name: "setup:drain" },
      });
    }
  }

  return token;
}

export function mintUsers() {
  const users = [];

  for (let i = 0; i < NUM_USERS; i++) {
    const email = `${USER_EMAIL_PREFIX}${i}${USER_EMAIL_DOMAIN}`;
    const body = JSON.stringify({ email, password: USER_PASSWORD });

    // Reuse identities across runs: register once, log in afterwards. Keeps
    // baselines comparable (same row counts) and the DB from growing per run.
    let res = http.post(`${BASE_URL}/auth/register`, body, {
      headers: JSON_HEADERS,
      tags: { name: "setup:register" },
    });

    if (res.status === 409) {
      res = http.post(`${BASE_URL}/auth/login`, body, {
        headers: JSON_HEADERS,
        tags: { name: "setup:login" },
      });
    }

    if (res.status !== 201 && res.status !== 200) {
      throw new Error(
        `setup: could not authenticate ${email} — ${res.status} ${res.body}`,
      );
    }

    const token = res.json("accessToken");
    if (!token) throw new Error(`setup: no accessToken for ${email}`);

    users.push({ t: token, ids: seedTodos(token, i) });
  }

  return users;
}

// Ensure the user owns at least TODOS_PER_USER rows, then return their ids.
// Idempotent across runs thanks to clientRequestId: a rerun replays the same
// keys and the API answers 200 with the existing row instead of inserting.
function seedTodos(token, userIndex) {
  const headers = { ...JSON_HEADERS, Authorization: `Bearer ${token}` };
  const ids = [];

  for (let j = 0; j < TODOS_PER_USER; j++) {
    const res = http.post(
      `${BASE_URL}/todos`,
      JSON.stringify({
        title: `k6 seed todo ${j}`,
        notes: `seeded by k6 for user ${userIndex}`,
        clientRequestId: seedUuid(userIndex, j),
      }),
      { headers, tags: { name: "setup:seed" } },
    );

    if (res.status !== 201 && res.status !== 200) {
      throw new Error(`setup: seed failed — ${res.status} ${res.body}`);
    }
    ids.push(res.json("id"));
  }

  return ids;
}

// Deterministic uuid-shaped string per (user, todo) so reruns hit the same
// idempotency keys. Version nibble is 7 to match the API's uuid(7) columns.
function seedUuid(userIndex, todoIndex) {
  const a = String(userIndex).padStart(8, "0");
  const b = String(todoIndex).padStart(4, "0");
  return `${a}-${b}-7000-8000-000000000000`;
}
