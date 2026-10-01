---
name: ticketry-cloud-start
description: Start Ticketry's supporting browser development runtime and choose checks inside a prepared Codex Cloud environment. Use for cloud browser inspection or validation of Ticketry changes.
---

# Ticketry cloud runtime

Run commands from the repository root. The cloud setup uses Node 22, the Rust
toolchain pinned in `studio/src-tauri/rust-toolchain.toml`, and SQLite. No
Postgres service or provider credentials are required to start the application.

For browser inspection, run `bash scripts/codex-cloud/start.sh` in a managed
background terminal. Keep it running while inspecting the app. Read its output
for the chosen frontend URL; the usual frontend port is 5174.
Check that the frontend responds and a POST to its proxied `/graphql` with
`{"query":"mutation CloudReadiness { __typename }"}` returns a mutation type
without errors. Diagnostics are in `.ticketry-dev/logs/ticketry.log`.

The launcher owns a disposable SQLite directory and a dedicated tmux socket.
Stop its parent process with SIGTERM after inspection so it can clean up.

Use `bash scripts/codex-cloud/check.sh frontend`, `rust`, or `graphql` for the
affected code. Run `test:overhaul` for UI behavior changes. Use `check.sh e2e`
for the browser suite; Playwright starts its own isolated runtime. Additional
Playwright arguments can follow `e2e`. Use `check.sh all` to validate a prepared
environment before publishing it.

Repository refresh does not rerun installation. If dependencies change, rerun
`bash scripts/codex-cloud/install.sh` in this task. Update and republish the
environment when future tasks need the new prepared dependencies.

Cloud checks exclude the shipping Tauri package and `ticketry-desktop`. Native
AppKit/libghostty, shipping-package integration tests, desktop E2E, and release
validation still need the existing macOS CI/local workflow. Report those checks
separately. Tests that launch real coding providers need their own explicit
provider installation and authentication; do not reuse personal desktop data.
