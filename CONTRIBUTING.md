# Contributing to Ticketry

Ticketry is a macOS desktop application. The repository contains its React
frontend, Tauri shell, Python sidecar, MCP service, and generated SDKs.

## Prerequisites

- macOS 11 or newer
- Node.js 22 and npm
- Python 3.11 or newer and `uv`
- Rust stable
- Java 17 for OpenAPI Generator
- Xcode with the Metal compiler for native terminal builds
- `tmux`

Install dependencies from the repository root:

```bash
npm install
(cd backend && uv sync --extra dev)
```

Run `npm run desktop:dev` for desktop development or `npm run web` for the
supporting browser development stack.

## Code layout

Read [`AGENTS.md`](AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) before changing code.
Keep frontend work under `studio/src/features/<domain>/`, except for application
shell and shared infrastructure. Give each backend capability its own Django app
under `backend/apps/`. Keep files small and focused.

Do not edit generated SDK files by hand. Change the backend schema, then run:

```bash
npm run contract:generate
```

## Validation

Run the checks related to your change. Before opening a pull request, run:

```bash
npm run typecheck
npm run test:overhaul --workspace @worktracker/studio
npm run test --workspace @worktracker/studio
npm run test:mcp
npm run build
(cd backend && uv run --extra dev pytest -q)
```

Every user-visible Studio behavior change needs an acceptance case in
`studio/src/test/*Acceptance.test.tsx`.

## Pull requests

Keep each pull request to one change. Explain the user-visible result, list the
checks you ran, and call out migrations or generated contract changes. Do not
commit local databases, logs, caches, build output, credentials, or editor
recovery files.
