// Scenario definitions. Pick one per run with --env SCENARIO=<name>.
//
// Open vs closed model is the whole point of this file:
//   ramping-vus          (closed) — VUs wait for a response before the next
//                         request, so the generator SLOWS DOWN when the server
//                         does. This hides the cliff you are looking for.
//   ramping-arrival-rate (open)   — k6 tries to hit a fixed request rate
//                         regardless of response time, like real users do.
//
// `load`, `stress` and `spike` use the open model deliberately. `closed` exists
// only so you can run the same traffic both ways and see the difference.

export const BASE_URL = __ENV.BASE_URL || "http://localhost:3000/api/v1";

// Users minted in setup(). VUs map onto these round-robin.
// Kept modest because each registration costs one argon2id hash (~50-100ms).
export const NUM_USERS = Number(__ENV.NUM_USERS || 50);
export const TODOS_PER_USER = Number(__ENV.TODOS_PER_USER || 20);

// Think time between actions, in seconds.
//
// Little's Law decides whether you measure the server or your own harness:
// sustaining R rps with iterations lasting D seconds needs R x D concurrent
// VUs. At the realistic 1-5s (D~=3s), driving 1000 rps costs 3000 VUs and the
// GENERATOR falls over first — you read `dropped_iterations` instead of the
// server's cliff.
//
// Under an open-model executor the arrival rate is fixed by the scenario, so
// shortening think time does not change the rate the server sees. It only makes
// each rps cheaper to produce. Hence: realistic values for load/soak, short
// values for stress/spike where the goal is to find the breaking point.
export const THINK_MIN = Number(__ENV.THINK_MIN || 1);
export const THINK_MAX = Number(__ENV.THINK_MAX || 5);

// Fixed identities so reruns reuse the same rows: comparable baselines and no
// unbounded DB growth. Password is irrelevant — these users only exist locally.
export const USER_EMAIL_PREFIX = "k6-user-";
export const USER_EMAIL_DOMAIN = "@loadtest.invalid";
export const USER_PASSWORD = "LoadTest123!pass";

const SCENARIOS = {
  // Does the system work at all? Run this before every other scenario.
  smoke: {
    executor: "constant-vus",
    vus: 2,
    duration: "30s",
  },

  // Normal expected traffic. Open model, ramps to 200 rps.
  load: {
    executor: "ramping-arrival-rate",
    startRate: 10,
    timeUnit: "1s",
    preAllocatedVUs: 100,
    maxVUs: 1500,
    stages: [
      { target: 50, duration: "30s" },
      { target: 200, duration: "1m" },
      { target: 200, duration: "2m" },
      { target: 0, duration: "30s" },
    ],
  },

  // Find the breaking point. Ramps well past what the app can serve.
  // Run with short think time (THINK_MIN=0.1 THINK_MAX=0.5) or the generator
  // runs out of VUs before the server runs out of capacity.
  stress: {
    executor: "ramping-arrival-rate",
    startRate: 100,
    timeUnit: "1s",
    preAllocatedVUs: 300,
    maxVUs: 2000,
    stages: [
      { target: 400, duration: "30s" },
      { target: 800, duration: "45s" },
      { target: 1400, duration: "45s" },
      { target: 2200, duration: "1m" },
      { target: 0, duration: "20s" },
    ],
  },

  // Sudden burst: does it recover, or stay broken after the spike passes?
  spike: {
    executor: "ramping-arrival-rate",
    startRate: 20,
    timeUnit: "1s",
    preAllocatedVUs: 200,
    maxVUs: 3000,
    stages: [
      { target: 20, duration: "30s" },
      { target: 800, duration: "10s" },
      { target: 800, duration: "30s" },
      { target: 20, duration: "10s" },
      { target: 20, duration: "1m" },
    ],
  },

  // Fixed arrival rate, short duration. For A/B sweeps where exactly one
  // variable changes (pool size, an index, a select list) and the load must be
  // identical across runs. A ramping profile would make runs incomparable.
  sweep: {
    executor: "constant-arrival-rate",
    rate: Number(__ENV.SWEEP_RATE || 600),
    timeUnit: "1s",
    duration: __ENV.SWEEP_DURATION || "60s",
    preAllocatedVUs: 400,
    maxVUs: 1500,
  },

  // Long run at moderate load. Looking for memory/connection leaks, not latency.
  soak: {
    executor: "constant-arrival-rate",
    rate: 100,
    timeUnit: "1s",
    duration: __ENV.SOAK_DURATION || "60m",
    preAllocatedVUs: 200,
    maxVUs: 1000,
  },

  // Closed model, for contrast with `load`. Same nominal traffic, but this one
  // backs off when the server struggles — which is exactly why it lies to you.
  closed: {
    executor: "ramping-vus",
    startVUs: 10,
    stages: [
      { target: 50, duration: "30s" },
      { target: 200, duration: "1m" },
      { target: 200, duration: "2m" },
      { target: 0, duration: "30s" },
    ],
  },
};

export const SCENARIO_NAME = __ENV.SCENARIO || "smoke";

// Experiment 6: when EXPORT_RPS is set, a second scenario runs ALONGSIDE the
// main one, calling the deliberately-blocking /todos/export. The question it
// answers is what that does to the p99 of GET /todos — an endpoint that shares
// nothing with it but the event loop.
export const EXPORT_RPS = Number(__ENV.EXPORT_RPS || 0);

export function activeScenario() {
  const s = SCENARIOS[SCENARIO_NAME];
  if (!s) {
    throw new Error(
      `Unknown SCENARIO "${SCENARIO_NAME}". Valid: ${Object.keys(SCENARIOS).join(", ")}`,
    );
  }

  const scenarios = { [SCENARIO_NAME]: s };

  if (EXPORT_RPS > 0) {
    scenarios.exporter = {
      executor: "constant-arrival-rate",
      rate: EXPORT_RPS,
      timeUnit: "1s",
      duration: __ENV.SWEEP_DURATION || "60s",
      preAllocatedVUs: 10,
      maxVUs: 50,
      exec: "exportScenario",
    };
  }

  return scenarios;
}

// Thresholds fail the run (non-zero exit) so this works in CI.
//
// dropped_iterations is the one almost everyone forgets: it means k6 could not
// start iterations on schedule, i.e. the GENERATOR ran out of VUs, not that the
// server is slow. Without it you will read your own harness's limit as the
// server's limit.
export const thresholds = {
  http_req_failed: ["rate<0.01"],
  dropped_iterations: ["count<1"],

  // Per-endpoint budgets, keyed off the `name` tag set in actions.js.
  "http_req_duration{name:GET /todos}": ["p(95)<300", "p(99)<800"],
  "http_req_duration{name:GET /todos?cursor}": ["p(95)<300", "p(99)<800"],
  "http_req_duration{name:GET /todos/:id}": ["p(95)<200", "p(99)<500"],
  "http_req_duration{name:POST /todos}": ["p(95)<400", "p(99)<1000"],
  "http_req_duration{name:PATCH /todos/:id}": ["p(95)<400", "p(99)<1000"],
  "http_req_duration{name:DELETE /todos/:id}": ["p(95)<400", "p(99)<1000"],

  // Correctness under load. A lost update makes this fail, which is the point:
  // the bug shows up here instead of in production.
  lost_update_detected: ["count<1"],
  version_check_failed: ["rate<0.001"],
};
