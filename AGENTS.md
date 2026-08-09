# Ticketry desktop application

This repository owns the complete Ticketry desktop application: the React
frontend, Tauri shell, supervised Python backend sidecar, MCP service, and
generated SDKs required by that application.

Use `npm run desktop:dev` or `pnpm run dev` from the repository root for local
desktop development. Both commands rebuild and launch the sidecar. Keep browser-
only service commands as supporting development tools, not as a separate product.

Code structure is a governing constraint, not a preference: keep files small
and single-purpose, place frontend code in `studio/src/features/<domain>/`
(with `app/` for the shell and `shared/` for cross-feature plumbing only), and
give each backend capability its own Django app under `backend/apps/` with the
core domain split across `worktracker/`'s `models/`, `rest/`, and `services/`.
When a file outgrows one concern, split it rather than extend it. The full
rules live in [`CLAUDE.md`](CLAUDE.md) under "Code structure — governing
rules"; keep the two documents consistent.

Keep the Tauri/webview boundary narrow. The native terminal renderer consumes a
pinned libghostty revision through its C API, while tmux remains responsible for
durable sessions. Preserve the existing fallback unless a deliberate migration
removes it.

Development data must remain isolated from live application data. Generated
databases, caches, sidecars, native libraries, and build output must not be
committed.

Development frontend, backend, and MCP output is persisted at
`.ticketry-dev/logs/ticketry.log`. Use `npm run logs` to inspect recent output,
`npm run logs:follow` while reproducing a problem, and `npm run logs:clear` to
start a clean capture. This directory is generated and must not be committed.

Every user-visible Studio UI behavior change must add or update an automated
acceptance case in `studio/src/test/*Acceptance.test.tsx`. Keep the numbered
overhaul gate current and run `npm run test:overhaul --workspace
@worktracker/studio` before handing the change off.
