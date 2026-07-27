# LLD - T781: Scaffold apps/orchestrator + pnpm orchestrate

**Module:** `worktracker--81c3aa9b` / Orchestrator CODIN-780
**Work item:** #781
**WorkTracker ID:** `<redacted-id>`
**Phase:** Todo -> LLD review only
**Scope:** Django app scaffold, dedicated launch entry, and smoke coverage; no orchestrator behavior yet

## Objective

Create the first in-repo boundary for the new orchestrator module: a Django app at `server/apps/orchestrator/`, registered in the ASGI server process, with an explicit `pnpm orchestrate` launch path that starts the backend with the WorkTracker signal seam and the orchestrator receiver loaded.

This slice proves the app can exist beside the frozen `apps.execution` reference implementation without importing from it, and that the signal receiver can be registered under the orchestrator-only entry point. It does not introduce run state, reducers, launch primitives, strategy packs, routes, frontend surfaces, or new ticket states.

## Decisions

| Decision | Plan |
| --- | --- |
| App location | Add `server/apps/orchestrator/` beside `apps.execution`, `apps.worktrees`, and the other server-owned apps. |
| Import boundary | The orchestrator app may import only from `worktracker` for tracker domain behavior. It must not import from `apps.execution`, and this rule must be stated in the app README and package/AppConfig docstrings. |
| Models | Add an empty `models.py` and no migrations. This slice must not create durable orchestrator tables. |
| Routes | Mount no orchestrator API routes in this slice. Regular dev routes should not expose an orchestrator surface. |
| Signal wiring | Add a receiver module imported from `OrchestratorConfig.ready()`. The receiver should connect to `worktracker.signals.issue_state_changed` with a unique orchestrator dispatch UID and perform no orchestration side effects yet. |
| Launch ownership | Add `pnpm orchestrate` at the parent `Muxed` workspace root. This is the only supported entry point for running the orchestrator. |
| Process shape | `pnpm orchestrate` starts only the Django ASGI backend. It must not start Studio/Vite, tmux terminal scaffolding, or any frontend watcher. |
| Settings shape | Use an orchestrator-specific settings module or settings overlay that includes `worktracker` and `apps.orchestrator` with the signal seam live. Keep compatibility with the existing local DB/env defaults. |
| Existing execution app | Treat `server/apps/execution/` as read-only reference context. Do not import it or rely on its AppConfig, reducer, driver, models, recipes, signals, or tests. |
| Strategies directory | Create an empty/documented `server/apps/orchestrator/strategies/` placeholder only if needed to make the future boundary visible. Do not add strategy loading behavior. |

## Current Files

| File | Status | Responsibility |
| --- | --- | --- |
| `../server/apps/orchestrator/` | Add later | New Django app package for the orchestration domain. |
| `../server/apps/orchestrator/apps.py` | Add later | `OrchestratorConfig`; imports only the app's signal receiver at startup. |
| `../server/apps/orchestrator/models.py` | Add later | Empty model module so Django recognizes the app without creating tables. |
| `../server/apps/orchestrator/signals.py` | Add later | No-op receiver registration against `worktracker.signals.issue_state_changed`. |
| `../server/apps/orchestrator/README.md` | Add later | States module purpose, standalone-at-app-boundary property, and hard import rule. |
| `../server/apps/orchestrator/strategies/` | Add later | Placeholder for later git-versioned strategy packs; no loader in this slice. |
| `../server/studio_server/settings.py` | Read for pattern | Existing full dev settings include Studio-adjacent apps and `apps.execution`; do not turn this into the orchestrator entry by accident. |
| `../server/studio_server/orchestrate_settings.py` | Add later | Dedicated settings module for `pnpm orchestrate`, based on local server defaults but registering `apps.orchestrator` and excluding `apps.execution`. |
| `../server/studio_server/asgi.py` | Reuse or minimally adjust later | ASGI callable used by uvicorn. Any import-time startup hooks must remain backend-only under orchestrate. |
| `../package.json` | Modify later | Add `orchestrate` script at the `Muxed` workspace root. |
| `../scripts/orchestrate.mjs` | Add later | Node launcher that sets orchestrator settings and runs uvicorn from `server/`. |
| `../server/apps/orchestrator/tests/` | Add later | Smoke tests for app load, import boundary, and receiver registration. |
| `worktracker/worktracker/signals.py` | Read-only | Canonical `issue_state_changed` seam consumed by the new app. |
| `../server/apps/execution/` | Read-only | Frozen reference implementation; pattern reference only, no imports. |

## Implementation Harness

1. Confirm the parent workspace is the command surface: `pnpm orchestrate` belongs in `Muxed/package.json`, not only in `worktracker-stack/package.json`.
2. Add the `apps.orchestrator` package with the smallest Django app shape: package marker, AppConfig, empty models module, signal receiver module, README, and optional empty strategies placeholder.
3. In `apps.py`, make `ready()` import only the local signal module. Keep AppConfig free of runtime reducer, driver, launch, strategy, or route concerns.
4. In `signals.py`, register a no-op or logging-only receiver for `issue_state_changed` with an orchestrator-specific dispatch UID. The receiver must not mutate WorkTracker issues, launch agents, or call any execution-app code.
5. In the README and package/AppConfig docstrings, state that this app is the in-process orchestration boundary, may import `worktracker`, and must never import `apps.execution` because `apps.execution` is frozen reference context.
6. Add a dedicated settings module for orchestrate mode. It should preserve the local backend defaults needed to boot Django, include `worktracker` and `apps.orchestrator`, and exclude `apps.execution` so the old executor receiver is not implicitly part of the orchestrator entry.
7. Check whether `studio_server.asgi` imports Studio/tmux-adjacent startup hooks unconditionally. If it does, either make those imports conditional on settings or add a small orchestrator ASGI module so the orchestrate path starts the HTTP server without Studio dev-server or tmux reconciliation behavior.
8. Add `scripts/orchestrate.mjs` to run uvicorn from `server/` with the orchestrator settings module and the existing local host/port convention unless the environment overrides it.
9. Add `orchestrate` to the parent `package.json` scripts, delegating to the new launcher.
10. Add smoke tests that load Django under the orchestrator settings module and assert `apps.orchestrator` is installed.
11. Add receiver smoke coverage that imports the orchestrator signal module and sends `issue_state_changed`, proving the receiver is connected and does not raise.
12. Add a boundary test or static assertion that orchestrator source files do not import `apps.execution`.
13. Run the targeted server tests for the new orchestrator app. If the script launcher has test coverage, run the relevant Node script test or a dry command inspection that confirms the script sets `DJANGO_SETTINGS_MODULE` to the orchestrator settings module.

## Launch Contract

`pnpm orchestrate` must:

- Start the Django ASGI backend from the parent `server/` directory.
- Set `DJANGO_SETTINGS_MODULE` to the orchestrator-specific settings module.
- Load `worktracker` so `issue_state_changed` is available.
- Load `apps.orchestrator` so its receiver is registered through AppConfig startup.
- Avoid starting the Studio dev server.
- Avoid tmux terminal launch or reconciliation scaffolding.
- Avoid importing `apps.execution` as part of the orchestrator path.
- Remain compatible with the existing local state DB and WorkTracker auth environment defaults.

## Smoke Tests

### Django App Load

Verify under the orchestrator settings module that:

- Django setup completes.
- `apps.orchestrator` is present in `INSTALLED_APPS`.
- `apps.execution` is absent from the orchestrator settings.
- The orchestrator app has no model tables or migrations in this slice.

### Signal Receiver Registration

Verify that:

- Importing `apps.orchestrator.signals` connects a receiver to `worktracker.signals.issue_state_changed`.
- Sending the signal with a representative issue payload does not raise.
- The receiver receives the payload shape used by WorkTracker: issue id, project id, from/to state ids, and from/to groups.
- Receiver behavior is no-op/logging only.

### Import Boundary

Verify that:

- No file under `server/apps/orchestrator/` imports from `apps.execution`.
- The README contains the import rule in plain language.
- Future strategy placeholder files, if added, do not import execution code.

### Launch Script

Verify that:

- `pnpm orchestrate` is defined at the parent workspace root.
- The script runs only the ASGI server command.
- The script points at the orchestrator settings module.
- The script does not delegate to the existing `dev` script or start frontend/tmux processes.

## Out of Scope

- No reducer, driver, run header, node state, retry logic, budget logic, or durable rebuild.
- No headless agent subprocess launch primitive.
- No run-record model or database migration.
- No strategy pack loader or default strategy content.
- No HTTP, Ninja, MCP, or Studio trigger surface.
- No frontend changes.
- No new WorkTracker lifecycle states.
- No changes to `worktracker.signals` beyond consuming the existing seam.
- No changes to `apps.execution` except reading it as reference context.
- No tmux behavior and no reuse of `apps.terminals` as an orchestrator substrate.

## Risks and Guards

| Risk | Guard |
| --- | --- |
| The orchestrator accidentally imports the old executor | Dedicated boundary test plus README/docstring rule; settings for orchestrate excludes `apps.execution`. |
| The launch path quietly starts the full dev stack | `pnpm orchestrate` delegates to a dedicated launcher, not `pnpm dev`; script inspection/test asserts ASGI-only behavior. |
| ASGI imports still trigger tmux reconciliation | Inspect `studio_server.asgi`; gate existing terminal startup hooks by settings or add a small orchestrator ASGI module. |
| Empty app creates migration churn | Keep `models.py` empty and do not add migrations. |
| Signal receiver does real work too early | Receiver is no-op/logging only; tests send the signal and assert no exception or side effect contract. |
| Strategy placeholder is mistaken for implemented loader | Use a README/placeholder file only; keep loader behavior out of scope. |

## Acceptance Signal

This LLD is accepted when it is clear that implementation will add only the orchestrator app scaffold, a dedicated ASGI-only `pnpm orchestrate` launch path, and smoke tests proving app load plus signal receiver registration, while preserving the hard boundary that `apps.orchestrator` never imports from `apps.execution`.
