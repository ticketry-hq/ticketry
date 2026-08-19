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

### One shared local Postgres database

By default, every development worktree keeps an isolated SQLite database. To
instead share database-backed Ticketry work between local web and desktop
development runs, install and configure a user-level Postgres database (no
Docker required):

```bash
npm run db:setup
```

The command installs Homebrew `postgresql@17` when needed, starts it as a user
service, creates the `ticketry` database, applies migrations, and writes the
opt-in connection URL and enable marker under
`~/.config/worktracker-studio/`. Source-tree development launchers and your
installed Ticketry app on that macOS account read this machine-local opt-in.
The marker is never included in an app bundle, so installations distributed to
other users retain their private SQLite database. Use `npm run db:status` to
check it. `npm run db:disable` removes only the opt-in files; it does not stop
Postgres or delete either Postgres or SQLite data.

This shares Django database records, not instance-owned files or processes:
profiles, API-token files, attachments, tmux sessions, caches, and logs remain
in each run's data directory. Avoid running code revisions with incompatible
database migrations against the shared database at the same time. Set
`MUXED_DATABASE_URL` for a one-launch override or `MUXED_DATABASE_URL_FILE` to
use a different persistent URL file.

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

On macOS, `pnpm run deploy` builds an ad-hoc-signed application and replaces
`/Applications/Ticketry.app`. The replacement is staged beside the installed
app, and the previous bundle is restored if the final move fails. Quit Ticketry
before deploying so the next launch uses the new bundle.

macOS desktop builds are currently **unsigned and not notarized**, and no
binary releases are published yet — build from source with the commands above.
Gatekeeper will block a copied unsigned build; see
[`studio/release/OPERATIONS.md`](studio/release/OPERATIONS.md) for the
quarantine workaround and the full release policy.

To attach the desktop shell to separately running development services instead,
run `npm run desktop:dev -- --connect`. Attach mode reuses the `5174` frontend,
`8787` backend, and established data directory without rebuilding or launching
the sidecar.

To launch with a brand-new disposable SQLite database, run
`npm run desktop:dev -- --temp-sqlite`. This mode ignores the local Postgres
opt-in for that launch, creates an isolated temporary profile, and removes the
database and the rest of that profile after the desktop process exits cleanly.
Any tmux sessions created by that disposable launch are stopped during cleanup.
The packaged executable accepts the same flag, for example
`/Applications/Ticketry.app/Contents/MacOS/ticketry --temp-sqlite`.
The browser development stack supports the same behavior with
`npm run web -- --temp-sqlite`. Disposable desktop launches use isolated port
ranges starting at `8877` for the backend and `8223` for MCP, so they can retain
full functionality while another Ticketry instance is running.

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
| `MUXED_FORCE_SQLITE` | Force SQLite even when local Postgres is enabled; set automatically by `--temp-sqlite`. |
| `MUXED_ENABLE_LOCAL_POSTGRES` | Source-development gate; installed use is enabled by this user's machine-local marker. |
| `MUXED_DATABASE_URL` | Explicit local Postgres URL; effective only with the development gate or local marker. |
| `MUXED_DATABASE_URL_FILE` | Persistent Postgres opt-in file (defaults to `~/.config/worktracker-studio/database-url`). |
| `MUXED_WEB_MCP_PORT`, `MUXED_DESKTOP_MCP_PORT` | Explicit development override for the pinned MCP port (`8123` by default). |
| `MUXED_SECRET_KEY`, `MUXED_DEBUG`, `MUXED_ALLOWED_HOSTS` | Django runtime settings. |
| `MUXED_DESKTOP_*` | Optional desktop endpoint and smoke-test overrides. |

## License

MIT — see [`LICENSE`](LICENSE).
