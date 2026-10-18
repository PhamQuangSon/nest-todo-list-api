import http from "k6/http";
import { check, sleep } from "k6";
import {
  activeScenario,
  thresholds,
  SCENARIO_NAME,
  NUM_USERS,
  THINK_MIN,
  THINK_MAX,
  EXPORT_RPS,
  BASE_URL,
} from "./lib/config.js";
import { mintUsers, mintPowerUserToken } from "./lib/setup.js";
import { runWeightedAction } from "./lib/actions.js";

// 412 Precondition Failed is a CORRECT response, not a failure: it means
// optimistic concurrency refused to let one writer clobber another. Left in the
// default 2xx-3xx set it would blow the http_req_failed threshold the moment
// contention appears, i.e. exactly when the app is behaving properly.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 412));

export const options = {
  scenarios: activeScenario(),
  thresholds,
  // Percentiles we actually read. p99 is where queueing shows up; the average
  // is the one number that never tells you anything useful.
  summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  console.log(`scenario=${SCENARIO_NAME} minting ${NUM_USERS} users…`);
  const users = mintUsers();
  const powerToken = EXPORT_RPS > 0 ? mintPowerUserToken() : null;
  console.log(`setup done: ${users.length} users ready`);
  return { users, powerToken };
}

export default function (data) {
  // One iteration = one user action. VUs map onto the minted pool round-robin,
  // so several VUs share a user and contend on the same rows — which is what
  // makes the 412 / lost-update assertions meaningful.
  const user = data.users[__VU % data.users.length];

  runWeightedAction(user);

  // Think time. Under an open-model executor this does not change the arrival
  // rate — only how many VUs k6 needs to sustain it. See THINK_MIN in config.js.
  sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));
}

// Experiment 6. Runs as its own scenario next to the main traffic. It does not
// touch any row the other scenario reads — the only thing the two share is the
// Node event loop, which is the whole point of the measurement.
export function exportScenario(data) {
  const res = http.get(`${BASE_URL}/todos/export`, {
    headers: { Authorization: `Bearer ${data.powerToken}` },
    tags: { name: "GET /todos/export" },
    // 50MB of CSV; without this k6 keeps the whole body per response.
    responseType: "none",
    timeout: "120s",
  });
  check(res, { "export: 200": (r) => r.status === 200 });
}
