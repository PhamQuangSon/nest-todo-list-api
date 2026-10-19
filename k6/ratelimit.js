// Phase 3: does the per-user limit hold across replicas?
//
//   k6 run --env RATE=5 --env DURATION=50s k6/ratelimit.js
//
// One FREE user, a steady 5 rps (well under the 20/s burst limit, so only the
// 60/min sustained window can bite), for less than one minute so every request
// lands in the same window. The correct answer is 60 accepted, regardless of
// how many replicas share the traffic.

import http from "k6/http";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000/api/v1";
const RATE = Number(__ENV.RATE || 5);
const DURATION = __ENV.DURATION || "50s";

const accepted = new Counter("ratelimit_accepted");
const rejected = new Counter("ratelimit_rejected");
const other = new Counter("ratelimit_other");

// 429 is the expected outcome for most of this run.
http.setResponseCallback(http.expectedStatuses(200, 429));

export const options = {
  scenarios: {
    steady: {
      executor: "constant-arrival-rate",
      rate: RATE,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
};

export function setup() {
  // A fresh email per run: a new user is FREE with empty counters, so earlier
  // runs inside the same minute cannot leak into this one.
  const email = `k6-ratelimit-${Date.now()}@loadtest.invalid`;
  const res = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ email, password: "LoadTest123!pass" }),
    { headers: { "Content-Type": "application/json" } },
  );
  if (res.status !== 201) {
    throw new Error(`setup: register failed — ${res.status} ${res.body}`);
  }
  return { token: res.json("accessToken") };
}

export default function (data) {
  const res = http.get(`${BASE_URL}/todos`, {
    headers: { Authorization: `Bearer ${data.token}` },
    tags: { name: "GET /todos" },
  });
  if (res.status === 200) accepted.add(1);
  else if (res.status === 429) rejected.add(1);
  else other.add(1);
}
