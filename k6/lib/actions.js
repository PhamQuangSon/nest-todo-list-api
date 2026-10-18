import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { BASE_URL } from "./config.js";

// ── Correctness metrics ─────────────────────────────────────────────────────
// Latency tells you if the app is fast. These tell you if it is RIGHT, which is
// the thing load tests normally fail to check.

// A 200 PATCH whose returned version is not exactly ifMatch + 1 means another
// writer's update was silently swallowed. Threshold is count<1: a single one
// fails the run.
export const lostUpdate = new Counter("lost_update_detected");
export const versionCheckFailed = new Rate("version_check_failed");

// 412s are NOT failures — they are optimistic concurrency working as designed
// under contention. Tracked so you can see contention rise with load.
export const versionConflicts = new Counter("version_conflicts");
export const conflictRate = new Rate("version_conflict_rate");

// Payload size per list response. Experiment 5 (dropping `notes` from the list
// select) moves this number, and throughput follows it.
export const listBytes = new Trend("list_response_bytes");

function authHeaders(token) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// ── Actions ─────────────────────────────────────────────────────────────────
// Every request carries an explicit `name` tag holding the LOGICAL route, not
// the concrete URL. Tagging by URL puts the todo id in the metric key, which
// explodes metric cardinality and makes per-endpoint percentiles useless.

function listTodos(user) {
  const res = http.get(`${BASE_URL}/todos`, {
    headers: authHeaders(user.t),
    tags: { name: "GET /todos" },
  });

  check(res, { "list: 200": (r) => r.status === 200 });
  if (res.status === 200) listBytes.add(res.body.length);
  return res;
}

function scrollTodos(user) {
  // Page one, then follow the cursor. Keyset pagination means page 2 costs the
  // same as page 1 — unlike OFFSET, which degrades as you scroll.
  const first = http.get(`${BASE_URL}/todos?limit=10`, {
    headers: authHeaders(user.t),
    tags: { name: "GET /todos" },
  });
  if (first.status !== 200) return first;

  const cursor = first.json("nextCursor");
  if (!cursor) return first;

  const second = http.get(`${BASE_URL}/todos?limit=10&cursor=${cursor}`, {
    headers: authHeaders(user.t),
    tags: { name: "GET /todos?cursor" },
  });
  check(second, { "scroll: 200": (r) => r.status === 200 });
  return second;
}

function patchTodo(user) {
  const id = user.ids[Math.floor(Math.random() * user.ids.length)];
  if (!id) return null;

  // Read current version first. This mirrors real usage (open a todo, edit it)
  // and gives us the If-Match value needed to assert correctness.
  const read = http.get(`${BASE_URL}/todos/${id}`, {
    headers: authHeaders(user.t),
    tags: { name: "GET /todos/:id" },
  });
  if (read.status !== 200) return read;

  const sent = read.json("version");

  const res = http.patch(
    `${BASE_URL}/todos/${id}`,
    JSON.stringify({ completed: Math.random() < 0.5 }),
    {
      headers: { ...authHeaders(user.t), "If-Match": `"${sent}"` },
      tags: { name: "PATCH /todos/:id" },
    },
  );

  if (res.status === 200) {
    const got = res.json("version");
    const correct = got === sent + 1;
    versionCheckFailed.add(!correct);
    conflictRate.add(false);

    if (!correct) {
      // Either our write was lost, or someone else's was and we were told ours
      // succeeded. Both are data corruption.
      lostUpdate.add(1);
      console.error(
        `LOST UPDATE: todo ${id} If-Match=${sent} returned version ${got}, expected ${sent + 1}`,
      );
    }
  } else if (res.status === 412) {
    // Correct behaviour: another writer got there first. The server refused to
    // clobber their change, which is precisely what If-Match is for.
    versionConflicts.add(1);
    conflictRate.add(true);
    versionCheckFailed.add(false);

    check(res, {
      "412 reports the current version": (r) => {
        const cur = r.json("current");
        return typeof cur === "number" && cur > sent;
      },
    });
  } else {
    versionCheckFailed.add(true);
  }

  return res;
}

function createTodo(user) {
  const res = http.post(
    `${BASE_URL}/todos`,
    JSON.stringify({
      title: `k6 created ${__VU}-${__ITER}`,
      notes: "created during load test",
    }),
    { headers: authHeaders(user.t), tags: { name: "POST /todos" } },
  );
  check(res, { "create: 201": (r) => r.status === 201 });
  return res;
}

function deleteTodo(user) {
  // Creates its own victim rather than consuming the seeded pool, which would
  // run dry mid-run and turn later iterations into 404 noise. The helper POST
  // is tagged separately so it does not pollute the POST /todos percentiles.
  const created = http.post(
    `${BASE_URL}/todos`,
    JSON.stringify({ title: `k6 doomed ${__VU}-${__ITER}` }),
    { headers: authHeaders(user.t), tags: { name: "POST /todos (delete setup)" } },
  );
  if (created.status !== 201) return created;

  const res = http.del(`${BASE_URL}/todos/${created.json("id")}`, null, {
    headers: authHeaders(user.t),
    tags: { name: "DELETE /todos/:id" },
  });
  check(res, { "delete: 204": (r) => r.status === 204 });
  return res;
}

// ── Traffic mix ─────────────────────────────────────────────────────────────
// Read-heavy, like every real todo app. Weights are cumulative upper bounds.
const MIX = [
  { until: 0.70, run: listTodos },   // 70% — plain list
  { until: 0.80, run: scrollTodos }, // 10% — cursor scroll
  { until: 0.92, run: patchTodo },   // 12% — edit with If-Match
  { until: 0.98, run: createTodo },  //  6% — create
  { until: 1.00, run: deleteTodo },  //  2% — delete
];

export function runWeightedAction(user) {
  const roll = Math.random();
  for (const entry of MIX) {
    if (roll < entry.until) return entry.run(user);
  }
  return listTodos(user);
}
