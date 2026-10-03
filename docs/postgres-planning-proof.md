# PostgreSQL planning compatibility proof

This experiment is based on `feature/roadmap` at
`99083204f8e3ce42c82608a7afabb992f05c860d`. It is deliberately an isolated
backend experiment, not a hosted Supabase deployment or a desktop/browser
release.

## What the proof exercises

The planner PostgreSQL integration test uses the existing Ticketry schema,
SeaORM entities, Seaography-generated reads/create operations, authored planning
mutations, and authenticated planner HTTP listener. Two independent authenticated HTTP clients and the existing in-process desktop
GraphQL transport use one canonical PostgreSQL database. No Tauri window is
created by this test. No browser or distributed desktop client
receives a database password or Supabase service-role key.

The fixture uses a uniquely named schema and synthetic data. It does not run
Ticketry's existing installation/adoption code against PostgreSQL: that path is
SQLite-specific. Entity-derived fixture DDL is not a production migration or an
assertion that every application table and invariant has been ported.

The existing planner listener remains loopback-only. Its ephemeral bearer token
is appropriate for this local transport experiment; it is not a replacement for
hosted user authentication, tenant authorization or Supabase JWT verification.

## Why a database URL alone is insufficient

- SeaORM already compiles its PostgreSQL driver, but database startup configures
  SQLite pools and PRAGMAs
- Existing migration and adoption code inspects `sqlite_master`, uses SQLite
  column types and migration ledgers, and assumes a local installation owner
- The planner service checks a loopback Host and an instance-local bearer token
- Studio uses the same React/Apollo UI with native and browser runtime adapters,
  but its schema also contains local filesystem, terminal and execution services

The relevant boundaries are `ticketry-work-management` database/migration
modules, `ticketry-graphql-schema::foundation_schema`, `ticketry-planner`, and
`studio/src/runtime`.

## Before a shared hosted rollout

1. Supply a separately authorized non-production Supabase/PostgreSQL project and
   server-side connection configuration through a secure secret channel
2. Add versioned PostgreSQL migrations preserving all constraints, foreign keys,
   defaults, concurrency guarantees and existing data behavior
3. Compose a server-only planning API using existing Ticketry model operations,
   durable authenticated user sessions and explicit workspace authorization
4. Point both clients' planning operations at that API while retaining local
   execution, terminal, filesystem and machine settings on the desktop
5. Verify actual desktop and hosted-browser UI flows, cross-client cache refresh,
   auth expiry, reconnects and unauthorized access

Do not simply expose the current whole local GraphQL schema on a public
interface, replace its token with a hard-coded frontend secret, or place
PostgreSQL credentials in Vite variables.

## Validation status

The run record is maintained separately from these instructions. A test that is
not run because PostgreSQL or native build prerequisites are missing is not a
passing compatibility proof. Hosted Supabase, desktop UI and browser UI require
separate validation even when the local PostgreSQL API test passes.

## Running the opt-in test

Use a dedicated disposable local PostgreSQL database. Set TEST_POSTGRES_URL in
the server/test process only, for example a local development URL with no secret:

```sh
TEST_POSTGRES_URL=postgresql://user@127.0.0.1:5432/ticketry_test \
cargo test --locked --manifest-path studio/src-tauri/Cargo.toml \
  -p ticketry-planner --test postgres_planning \
  postgres_planning_round_trip -- --ignored --nocapture
```

The URL must use a literal loopback host, a database name, and no query parameters
or fragment. The harness intentionally rejects hosted Supabase URLs. Its role
must be able to create/drop a schema in the disposable test database. Do not
reuse a production database or production credentials, even through a tunnel.
The harness creates only a unique ticketry_planner_poc_* schema and removes it
after normal completion, assertion failure, or its test timeout. Process kills
can interrupt cleanup, so use a disposable test database.

Covered assertions: native/HTTP transport convergence; generated Sprint creation and relation reads; authored Sprint
rename and Goal create/update/delete; two concurrent Goal creations with distinct
positions; invalid Goal text rollback; two-client convergence; a reopened pool
and listener reading persisted records; missing/invalid/old bearer-token rejection.
The ordinary test run also checks unsafe URL rejection; the database round trip
is explicitly ignored unless requested with --ignored.

## Verified on dot's computer (2026-10-03)

- Rust 1.95.0 and PostgreSQL 17.11
- Full ticketry-planner suite with the Postgres test enabled: 8 passed
- PostgreSQL round trip repeated three additional times: all passed
- Fixture cleanup: zero ticketry_planner_poc_* schemas left behind
- Frontend typecheck and production build: passed
- Overhaul acceptance: 636 passed, 1 existing skipped
- GraphQL generation: deterministic and drift-free
- Architecture boundary check: passed
- Rust application code check with packaging resources disabled: passed
  (`TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' cargo check --locked
  --manifest-path studio/src-tauri/Cargo.toml`)
- Plain desktop package check: blocked by the checkout's missing generated
  `binaries/ticketry-hook-x86_64-unknown-linux-gnu` resource
- Existing shipping-caller gate: fails on the unchanged browser terminal socket
  in browserRuntime.ts and development proxy in vite.proxy.ts

Official Debian dependencies were extracted into a workspace-local directory;
no machine-wide package installation was required. Tests used synthetic data
only. This validates the chosen planning model operations on local PostgreSQL,
not a hosted Supabase deployment or the actual desktop/browser UI.

## Reproduced in the saved cloud environment (2026-10-03)

The transferred patch from `b5949540bfc4e71f4e8f723dba9563eb99a02ab8`
was applied to `/workspace/ticketry-roadmap-poc`, branch
`poc/roadmap-supabase`, based only on the verified feature commit above.
Library source: `libfile_1717ac43a8ec81919aefe8047d5e3597`, version 0.
ZIP SHA-256: `f769a26cb8793fb5f77138745c78f07b438a726edd19bc7ede366ee8960074d0`.
The original checkout was left unchanged.

The saved workspace had Node dependencies and old binaries but lacked Cargo,
tmux, PostgreSQL, and native development libraries. Official Rust 1.95.0,
Node 22.23.3 (checksum verified), SeaORM CLI 2.0.1, and Debian dependencies
were prepared under `/workspace/ticketry-toolchain`; no system installation,
privilege expansion, or sandbox relaxation was needed. The feature branch's
backend was rebuilt from source, not substituted with the cached old binary.

Validation in this environment:

- Planner suite, explicitly including PostgreSQL: **8 passed**. This covers
  native/HTTP convergence, rollback, concurrent goal allocation, reconnect,
  token rejection, and the existing SQLite lifecycle test. PostgreSQL 17.11
  was restricted to loopback; zero generated fixture schemas remained.
- Node 22 overhaul acceptance: **636 passed, 1 skipped**. An earlier Node 24
  run under concurrent compilation had one Story workflow dialog timeout;
  all 13 cases in that file passed on focused retry before the full Node 22 pass.
- TypeScript, frontend architecture/build, GraphQL deterministic generation and
  drift, and the repository boundary check passed.
- Web launcher/defaults tests: **19 passed**.
- Normal `scripts/codex-cloud/start.sh` startup succeeded, including the Unix
  MCP socket. HTML and the transformed main module returned HTTP 200. Live
  GraphQL checks created the synthetic `Cloud planning demo` project, a sprint,
  and a goal, updated the goal, and confirmed identical records through the
  frontend proxy and direct backend. Evidence is in
  `/workspace/ticketry-transfer/cloud-smoke.json`; check logs are alongside it.
- The existing shipping-caller gate still fails on `browserRuntime.ts:20`
  and `vite.proxy.ts`; neither file is changed by this proof.
- Visual browser inspection/E2E is blocked: system Chromium aborts because its
  SUID sandbox helper is not configured correctly. Sandboxing was not disabled.
  Native desktop UI, hosted browser UI, and hosted Supabase were not tested.

### Local handoff

The running app is loopback-only at `http://127.0.0.1:5174`, with its Rust
adapter at port 8790. It uses a disposable **SQLite** profile, separate from
the PostgreSQL compatibility test. No public or externally reachable preview
was created. These endpoints are usable from inside this execution environment;
they are not a claim that a user's external browser can reach the cloud host.

To restart the normal app after stopping its existing launcher:

```sh
cd /workspace/ticketry-roadmap-poc
source /workspace/ticketry-toolchain/env.sh
bash scripts/codex-cloud/start.sh
```

The disposable PostgreSQL cluster is under
`/workspace/ticketry-toolchain/postgres-test-data`, listening on 127.0.0.1:55432.
With the environment above loaded, rerun the proof using:

```sh
TEST_POSTGRES_URL=postgresql://agent@127.0.0.1:55432/ticketry_test \
cargo test --locked --manifest-path studio/src-tauri/Cargo.toml \
  -p ticketry-planner -- --include-ignored
```

Stop PostgreSQL with
`/workspace/ticketry-toolchain/sysroot/usr/lib/postgresql/17/bin/pg_ctl -D /workspace/ticketry-toolchain/postgres-test-data stop`.
Stop the app's owning launcher with SIGTERM so it removes its temporary profile.
Do not publish or forward the full local GraphQL adapter to a public interface.
The hosted rollout work and secure non-production project setup listed above
remain necessary; this test does not connect the live app to PostgreSQL.
