# Load testing (Phase 2)

Every number here is reproducible from this repo. Baselines live in
`baselines/` and are compared with `k6/compare.mjs`, so "did this change help?"
is answered from committed data rather than memory.

## Running

```bash
# always start here
k6 run --env SCENARIO=smoke --env NUM_USERS=5 k6/main.js

# realistic traffic, open model, ramps to 200 rps
k6 run --env SCENARIO=load k6/main.js \
  --summary-export=k6/baselines/load-$(git rev-parse --short HEAD).json

# find the cliff — short think time so the generator is not the bottleneck
k6 run --env SCENARIO=stress --env THINK_MIN=0.1 --env THINK_MAX=0.5 k6/main.js \
  --summary-export=k6/baselines/stress-$(git rev-parse --short HEAD).json

# compare any two runs
node k6/compare.mjs k6/baselines/a.json k6/baselines/b.json
```

Scenarios: `smoke`, `load`, `stress`, `spike`, `soak`, `closed`. One per run.

## Two things this harness does that most do not

**It refuses to measure itself.** `dropped_iterations` is a threshold
(`count<1`), not a footnote. When it trips, k6 could not start iterations on
schedule — the *generator* ran out of VUs and the number you are reading is its
limit, not the server's. Experiment 1 below is entirely about that trap.

**It asserts correctness, not just latency.** Every `PATCH` reads the version
first, sends it as `If-Match`, and checks the response is exactly `sent + 1`.
A lost update fails the run (`lost_update_detected: count<1`). A `412` is
recorded as *correct* behaviour, not an error — optimistic concurrency refusing
to clobber a concurrent write is the feature working. Across ~36k PATCHes under
saturation: **zero lost updates**.

## Caveats that affect every number below

- k6 runs on the host; Docker Desktop gets 5 of the host's 10 cores. Generator
  and server compete. Comparisons are only valid between runs in the *same*
  environment — never native vs Docker.
- Tokens are minted once in `setup()`. Logging in per iteration would cap the
  whole test at ~40-80 rps on argon2id alone (~50-100ms of native work on a
  4-thread libuv pool) and you would spend the day tuning a bottleneck no real
  traffic produces.

## Experiment 1 — single instance ceiling

Same server, same scenario, only think time changed.

| | think 1-5s | think 0.1-0.5s |
|---|---|---|
| req/s | 507 | **1238** |
| p99 | 73ms | 420ms |
| max | 363ms | 18.4s |
| fail % | 0.004 | 1.58 |
| dropped iterations | 2856 | 10959 |
| API CPU peak | 115% | **154%** |

The first column never found the cliff. Little's Law says sustaining `R` rps
with iterations lasting `D` seconds needs `R x D` VUs: at `D ≈ 3s`, driving
1000 rps costs 3000 VUs and the harness fell over first. Under an open-model
executor the arrival rate is fixed by the scenario, so shortening think time
does not change what the server sees — it only makes each rps cheaper to
produce.

The real finding is the CPU column. **154% on a 10-core machine is ~15% of the
box.** Node executes JS on one thread; the extra 54% is the libuv threadpool and
GC. The app was at its limit while 85% of the machine sat idle. Nothing in the
code is slow — there is simply one process.

## Experiment 2 — scale to 3 instances

`docker compose up -d --scale api=3`. Not one line of application code changed.
Both runs in Docker, identical scenario — one variable.

| | 1 instance | 3 instances | |
|---|---|---|---|
| fail % | 38.06 | **0.02** | ~1900x |
| p50 | 14.9ms | 1.1ms | 14x |
| p95 | 384ms | 3.3ms | 116x |
| p99 | **7.24s** | **10.5ms** | **~690x** |
| max | 16.46s | 59ms | 278x |
| dropped iterations | 14738 | 439 | 34x |
| req/s | 1123 | 1308 | +16% |
| lost updates | 0 | 0 | — |

Throughput barely moved while latency improved ~690x, and that is the point:
the scenario caps arrival rate at 2200 rps. At one instance we were well past
the cliff (38% of requests failing, 7-second p99). At three we are comfortably
under it, so throughput is now limited by the *test*, not the server. Finding
the new cliff needs a harder ramp.

Peak CPU was even across all three containers (87% / 89% / 98%), confirming
round-robin. VUs needed fell from 2000 to 703 — Little's Law again: faster
responses mean shorter iterations mean fewer concurrent VUs for the same rate.

## Experiment 3 — connection_limit sweep

`DB_POOL` in `docker-compose.yml` sets Prisma's per-instance pool.
`constant-arrival-rate` so the load is byte-for-byte identical across runs.

At 600 rps, 3 instances:

| pool (per instance) | 2 | 5 | 10 | 25 |
|---|---|---|---|---|
| req/s | 718.6 | 718.1 | 719.1 | 704.4 |
| p99 | 3.3ms | 2.9ms | 54.8ms | 4.1ms |

At 1758 rps, 3 instances — and the pool metrics that explain it:

| | pool=2 | pool=25 |
|---|---|---|
| req/s | 1758.4 | 1759.7 |
| p99 | 8.2ms | 9.7ms |
| max | 51ms | 158ms |
| `prisma_pool_connections_open` | 2 | 25 |
| `prisma_pool_connections_busy` | **1** | **0** |
| `prisma_client_queries_wait` | 0 | 0 |
| total wait across ~22.5k queries | 134ms | 59ms |
| mean wait per query | **0.006ms** | **0.003ms** |

Throughput is flat across a 12.5x range of pool sizes, and the larger pool has
a *worse* tail. `connections_busy` says why: 1 of 2 connections in use, 0 of 25.
The 23 extra connections do nothing but hold Postgres backends open — and
`25 x 3 replicas = 75` of a `max_connections=100` budget spent for no gain,
which is how you hit "too many connections" with zero performance to show.

The lesson is the diagnostic order. `prisma_client_queries_wait ≈ 0` means the
queries are fine and nothing is queueing for a connection, so resizing the pool
cannot help. Checking that *before* blaming the database is the step most people
skip — and Prisma's default of `num_cpus*2+1` per instance is wrong in the other
direction the moment you run replicas, because every replica sizes its pool as
though it owned the whole database.

The `pool=10 / p99=54.8ms` cell is noise, not signal: pool=25 returns to 4.1ms.
Worth leaving in as a reminder that one run is not a measurement.

## Experiment 4 — drop the index, read the plan

Same query as `findAllCursor`, 40 237 rows across 50 users (~805 each), 14 MB.

```sql
SELECT id, title, completed, time, version, "createdAt"
FROM "Todo" WHERE "userId" = $1 ORDER BY id DESC LIMIT 21;
```

| | with `Todo_userId_id_idx` | index dropped |
|---|---|---|
| plan | `Index Scan using Todo_userId_id_idx` | `Index Scan Backward using Todo_pkey` |
| **buffers** | **20** | **964** |
| rows removed by filter | 0 | **1327** |
| execution time | 0.103ms | 0.225ms |

No sequential scan appears, which is itself worth understanding: `uuid(7)` keys
are time-sortable, so walking the primary key backwards satisfies
`ORDER BY id DESC` for free. Postgres takes that path and filters `userId` as it
goes, discarding 1327 rows to find 21.

Under load at 1500 rps the difference was almost invisible — p99 8.2ms vs 6.2ms,
throughput identical — because all 14 MB sits in shared buffers and Node, not
Postgres, is the constraint.

**So read the buffers, not the clock.** 964 accesses instead of 20 is a 48x
amplification being hidden by RAM. The rows-removed figure scales with the
number of users: at 50 users roughly 1 row in 50 matches, so finding 21 costs
~1300. At 5000 users it costs ~130 000, and once the table outgrows the buffer
cache those become disk reads. The query that looks fine today falls off a cliff
with no code change — only more data.

### nginx caches upstream DNS

`upstream { server api:3000; }` resolves **once at startup**. After
`--scale api=N` nginx still balances across the IPs it knew then, so a scale-up
appears to do nothing. `docker compose restart nginx` after every scale change,
or the measurement is silently wrong.
