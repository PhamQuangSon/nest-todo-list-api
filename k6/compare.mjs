#!/usr/bin/env node
// Compare k6 --summary-export JSON files side by side.
//
//   node k6/compare.mjs k6/baselines/a.json k6/baselines/b.json
//
// "Did this change help?" has to be answerable from the repo, not from memory.
// Each run is exported, committed, and diffed here.

import { readFileSync } from "node:fs";
import { basename } from "node:path";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node k6/compare.mjs <summary.json> [more.json ...]");
  process.exit(1);
}

// [label, path into the summary JSON, formatter]
const ROWS = [
  ["req/s", (m) => m.http_reqs?.rate, (v) => v.toFixed(1)],
  ["iter/s", (m) => m.iterations?.rate, (v) => v.toFixed(1)],
  ["fail %", (m) => pct(m.http_req_failed), (v) => v.toFixed(2)],
  ["dropped iters", (m) => m.dropped_iterations?.count ?? 0, (v) => String(v)],
  ["p50 ms", (m) => m.http_req_duration?.med, ms],
  ["p95 ms", (m) => m.http_req_duration?.["p(95)"], ms],
  ["p99 ms", (m) => m.http_req_duration?.["p(99)"], ms],
  ["max ms", (m) => m.http_req_duration?.max, ms],
  ["lost updates", (m) => m.lost_update_detected?.count ?? 0, (v) => String(v)],
  ["412 conflicts", (m) => m.version_conflicts?.count ?? 0, (v) => String(v)],
  ["list bytes", (m) => m.list_response_bytes?.avg, (v) => v.toFixed(0)],
];

function pct(metric) {
  if (!metric) return undefined;
  // k6 exports rate as 0..1 for Rate metrics.
  const r = metric.value ?? metric.rate;
  return r === undefined ? undefined : r * 100;
}

function ms(v) {
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : v.toFixed(1);
}

const runs = files.map((f) => {
  const json = JSON.parse(readFileSync(f, "utf8"));
  // k6 2.x nests trends under metrics[name].values; older shape is flat.
  const raw = json.metrics ?? {};
  const metrics = {};
  for (const [name, m] of Object.entries(raw)) {
    metrics[name] = m.values ?? m;
  }
  return { name: basename(f, ".json"), metrics };
});

const labelWidth = Math.max(...ROWS.map(([l]) => l.length));
const colWidth = Math.max(14, ...runs.map((r) => r.name.length));

const header = [
  "".padEnd(labelWidth),
  ...runs.map((r) => r.name.padStart(colWidth)),
].join("  ");
console.log(header);
console.log("-".repeat(header.length));

for (const [label, get, fmt] of ROWS) {
  const cells = runs.map((r) => {
    const v = get(r.metrics);
    return (v === undefined || v === null ? "—" : fmt(v)).padStart(colWidth);
  });
  console.log([label.padEnd(labelWidth), ...cells].join("  "));
}
