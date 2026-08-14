---
name: e2e
description: Run the Playwright browser integration suite to validate features end to end. Use after implementing a feature or change, when the user asks to run integration/acceptance/e2e/Playwright tests, or to verify backend parity (e.g. the Rust port) behind the unchanged UI.
---

# Playwright integration suite

The e2e suite in `studio/e2e/` is the black-box acceptance gate for the whole
web application. It boots the real stack itself — `scripts/web-dev.mjs
--temp-sqlite` starts the Django backend against a throwaway SQLite profile
(auth disabled) plus the frontend on port 4173 — so it needs **no dev server
running and no manual setup**. It never touches the developer or desktop
database.

## Commands

Run from the repository root:

```sh
# Full suite (serial, single worker — expect several minutes)
npm run test:e2e --workspace @worktracker/studio

# Just the server-state overhaul regressions (fastest meaningful slice)
npm run test:e2e:overhaul --workspace @worktracker/studio

# One spec file or one test
npx playwright test e2e/web-app.spec.ts --config playwright.config.ts   # from studio/
npx playwright test -g "drag reorder"                                   # by title
```

## What to run, when

Pick the smallest slice that covers the seam you touched, then run the full
suite before declaring the change done:

| You changed… | Run first |
| --- | --- |
| Server state, queries/mutations, optimistic updates, realtime/SSE | `test:e2e:overhaul` |
| Issue editing, board, hierarchy, blockers, settings, panes, shortcuts | `e2e/web-app.spec.ts` |
| Documents, scratch workspace, launcher menu | `e2e/documents-and-scratch.spec.ts` |
| Backend API surface the UI consumes (including the Rust port) | full `test:e2e` |

Also run `npm run test:overhaul --workspace @worktracker/studio` (Vitest, not
Playwright) when touching terminal/agent lifecycle state — those numbered
cases (`overhaul-07..13`) are deliberately outside the browser suite.

## Reading failures

- Playwright prints a list reporter; on failure it retains a **trace** and
  **screenshot** under `studio/test-results/` and writes an HTML report to
  `studio/playwright-report/` (`npx playwright show-trace <trace.zip>` for
  step-by-step replay).
- The `setup` project (`onboarding.setup.ts`) runs first and completes
  provider onboarding in the temp DB. If *everything* fails, check setup's
  output before suspecting the specs.
- Backend logs stream through the webServer output — API 500s appear inline
  in the Playwright run output.

## Gotchas

- `reuseExistingServer: false` — the suite always starts its own stack on
  ports 4173 (frontend) and 18787 (backend). A stray process on those ports
  fails startup; free them rather than editing the config.
- Tests are intentionally serial (`workers: 1`); don't parallelize them.
- The suite contains **no skipped tests** by policy. If a new behavior can't
  be tested deterministically in the browser, it belongs in the numbered
  Vitest acceptance gate or the desktop harness, not as a skipped spec.
- The `codex / gpt-5.6-luna / medium` catalog row is disposable test data
  seeded by setup, not a production catalog change.

## New features need new specs

When a change adds user-visible behavior, extend the matching spec file (or
add a focused one in `studio/e2e/`) using the helpers in `e2e/support.ts`.
Assert through visible controls and reload-and-verify — the suite's value as
a backend-parity oracle (Django vs Rust) depends on specs that round-trip
through the server rather than trusting the optimistic cache.
