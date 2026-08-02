# Studio application

This directory is the complete application: Django backend, Studio frontend,
SDKs, MCP service, and local development tooling. The `worktracker` Django app
lives in `backend/`; Studio is its only browser frontend.

```text
backend/                             Django ASGI host, application code, and worktracker
studio/                              React/Vite frontend and Tauri desktop shell
surfaces/worktracker-sdk/            Typed Python API client
surfaces/worktracker-typescript-sdk/ Generated TypeScript API client
surfaces/worktracker-agent/          FastMCP service
scripts/                             Bootstrap, development, and contract tooling
spec/                                Application design history
```

## Local development

Install the frontend and backend dependencies:

```bash
npm install
(cd backend && uv sync --extra dev)
```

Start the complete browser application from the repository root:

```bash
npm run web
# or: pnpm run web
```

This prepares a per-worktree development profile, applies pending Django
migrations, starts the backend and Studio on the first free loopback ports
(beginning at `8787` and `5174`), exposes WorkTracker MCP at the pinned
`http://127.0.0.1:8123/mcp` endpoint, and opens Studio in the default browser
when Vite is ready; Ctrl+C stops all three services. The selected URLs and
isolated profile path are printed at startup. Override them with
`MUXED_WEB_BACKEND_PORT`, `MUXED_FRONTEND_PORT`, `MUXED_WEB_MCP_PORT`, and
`MUXED_DATA_DIR` when fixed values are needed. A port collision fails startup
instead of silently moving the externally configured MCP endpoint.

Local web development disables API-key authentication by default because both
services bind only to loopback. Set `WORKTRACKER_DISABLE_AUTH=false` and provide
the same token through `WORKTRACKER_API_TOKEN` and `VITE_WT_API_KEY` when testing
an authenticated Studio session. To run the services separately:

```bash
scripts/dev.sh backend  # 127.0.0.1:8787
scripts/dev.sh studio   # 127.0.0.1:5174
```

For the desktop application, run either `npm run desktop:dev` or `pnpm run dev`
from the repository root. Both commands rebuild the Python sidecar and launch
the Tauri shell with its supervised backend and MCP services.

Copy `studio/.env.example` to `studio/.env.local` and set `VITE_WT_API_KEY` when
testing an authenticated Studio session. Studio proxies `/api` to the backend;
`VITE_AGENT_API_BASE` defaults to `/api`.

## Desktop

`npm run desktop:dev` packages the current Python backend and WorkTracker MCP
into one multi-call sidecar, then launches Studio with those supervised local
services in its Tauri shell. WorkTracker MCP is exposed on the same pinned
`http://127.0.0.1:8123/mcp` endpoint used by browser development and standalone
launches. The command disables Tauri's Rust file watcher so
the freshly rebuilt sidecar does not immediately restart the app; rerun the
command after native changes. `npm run desktop:build` builds the production shell
with the compiled Studio assets, and `npm run desktop:smoke` runs its lifecycle
checks.

To attach the desktop shell to separately running development services instead,
run `npm run desktop:dev -- --connect`. Attach mode reuses the `5174` frontend,
`8787` backend, and established data directory without rebuilding or launching
the sidecar.

## Validation

```bash
npm run typecheck
npm run test --workspace @worktracker/studio
npm run build --workspace @worktracker/studio
scripts/dev.sh test
(cd backend && uv run --extra dev pytest -q)
```

## Configuration

The existing public configuration remains unchanged:

| Variable | Purpose |
| --- | --- |
| `WORKTRACKER_API_TOKEN` | API `x-api-key` when authentication is enabled. |
| `WORKTRACKER_DISABLE_AUTH` | Disable API-key checks for local use. |
| `MUXED_STATE_DB` | SQLite state-database path. |
| `MUXED_WEB_MCP_PORT`, `MUXED_DESKTOP_MCP_PORT` | Explicit development override for the pinned MCP port (`8123` by default). |
| `MUXED_SECRET_KEY`, `MUXED_DEBUG`, `MUXED_ALLOWED_HOSTS` | Django runtime settings. |
| `MUXED_DESKTOP_*` | Optional desktop endpoint and smoke-test overrides. |
