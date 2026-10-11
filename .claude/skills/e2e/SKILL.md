---
name: e2e
description: Run the Playwright browser integration suite to validate features end to end. Use after implementing a feature or change, when the user asks to run integration/acceptance/e2e/Playwright tests, or to verify backend parity (e.g. the Rust port) behind the unchanged UI.
---

# Playwright integration suite

Read the [feature map](../../../docs/feature-map/README.md) to find the feature
you touched: its entry points, surfaces and coverage table. The entry's
filename (without `.md`) is the feature ID, and its suite lives at
`studio/e2e/features/<feature-id>.spec.ts`. Update the entry and the suite
together when behavior changes.

The browser suite is the black-box acceptance gate for the web application. It
boots the real stack itself: `scripts/web-dev.mjs` starts the Rust GraphQL
adapter (`ticketry_graphql_adapter`) against a throwaway SQLite profile plus the
frontend on port 4173, with a private tmux server and the local provider
fixture. It needs **no dev server running and no manual setup**, and it never
touches the developer or desktop database.

## Commands

Run from the repository root:

| Goal | Command |
| --- | --- |
| The feature you changed | `bun run --cwd studio test:e2e:feature <feature-id>` |
| Several features | `bun run --cwd studio test:e2e:feature <id>,<id>` |
| One case or a title subset (partial evidence) | add `--case <case-id>` or `--grep <regex>` |
| Full app (every mapped, non-excluded feature) | `bun run --cwd studio test:e2e:features` |
| List features, suites, isolation and cases | `bun run --cwd studio test:e2e:features --list [--json]` |
| Map/suite drift report | `bun run --cwd studio test:e2e:features --check` |
| Plan and Sprints features (alias) | `bun run --cwd studio test:e2e:planning` |

Raw `bun run --cwd studio test:e2e` runs plain Playwright over every spec in one
profile. Keep it for ad-hoc debugging; it is not the completion gate.

## What to run, when

Run the changed feature's suite first, then the full-app run before declaring a
cross-cutting change done. A filtered run (`--case`, `--grep` or a subset of
features) never establishes full-app completion. Map entries marked
`Suite: excluded (...)`, and `desktop-only:` or `manual:` cells, need the
desktop harness (`bun run --cwd studio test:e2e:desktop`) or manual evidence;
the runner summary lists them under "Not verified by the browser".

Also run `bun run --cwd studio test:overhaul` (Vitest, not Playwright) when
touching terminal/agent lifecycle state; those numbered cases (`overhaul-07..13`)
are deliberately outside the browser suite.

## Reading failures

- Each run writes evidence to `.ticketry-dev/e2e-results/<run-id>/`: manifest,
  registry snapshot, per-invocation Playwright JSON and HTML reports, traces,
  screenshots, logs and cleanup records. `.ticketry-dev/e2e-results/latest.md`
  links the newest `summary.md`. Replay a trace with
  `bunx playwright show-trace <trace.zip>`.
- The `setup` project (`onboarding.setup.ts`) completes provider onboarding in
  each fresh profile. If every case of an invocation fails, check setup first.
- Adapter logs stream through the web-server output. Feature-runner
  invocations write it to their `web-server.log`; raw `test:e2e` runs show it
  in stdout/stderr.

## Gotchas

- `reuseExistingServer: false`: each invocation starts its own stack. The runner
  picks free ports; a raw `test:e2e` run uses 4173 and fails if it is taken.
- Retries are disabled and cases run serially; don't parallelize them.
- Every e2e server waits for a machine-wide memory slot (see the suite README's
  "Memory queue and warm servers"). `[e2e-queue] … waiting` means another run
  holds the slots; wait for it rather than killing it or raising
  `TICKETRY_E2E_MAX_STACKS`.
- Feature suites contain **no** `skip`, `fixme` or `only` calls; the drift check
  rejects them. If a behavior can't be tested deterministically in the browser,
  mark its cell `desktop-only:` or `manual:` with a reason instead.
- Changing sources during a run invalidates its evidence.

## New features need new cases

Add cases to the feature's suite inside its `featureSuite("<feature-id>", …)`
call, give each a literal title and exactly one globally unique `@case-<id>`
tag, and cite every case from the entry's coverage table. Assert through visible
controls and read persisted state back through public GraphQL or a reload,
rather than trusting the optimistic cache. Run `--check` before handoff.
