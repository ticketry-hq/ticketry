# CODING-2683 implementation evidence

Date: 2026-10-10. Specification: [CODING-2533](CODING-2533-global-mcp-spec.md).

The provider registrar now exposes `register_codex_global_mcp` alongside Claude's registrar. It writes only `command` and global bridge `args`, preserves unrelated TOML and owned-entry comments/order, repairs moved apps and extra fields, and refuses foreign, malformed, locked, read-only or symlinked configurations. It uses the Codex trust configuration resolver, lock and atomic exchange writer. Public API approval fixtures include the new root export.

Desktop startup uses the existing detached, once-per-process worker for both providers. Development, unpackaged and data-directory override instances trace a skip for each provider. Outcomes use finite diagnostic fields; registration does not gate runtime readiness.

## Automated validation

- `bun run --cwd studio test:overhaul`: passed 253 default suites / 1,028 cases and 5 roadmap-off suites / 20 cases, 1,048 total. Log: `/tmp/coding-2683-overhaul.log`.
- `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-launch --lib mcp`: 8 passed. Log: `/tmp/coding-2683-launch-golden.log`.
- `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-launch --test codex_mcp_precedence -- --ignored --nocapture`: 1 passed against installed `codex-cli 0.162.0`. It exercises fresh and resume argv, base and selected profiles, inherited stdio and HTTP global entries, and absence of inherited env/cwd/timeouts. Log: `/tmp/coding-2683-precedence.log`.
- Scoped formatting and diff checks passed.
- `cargo test --manifest-path studio/src-tauri/tests/public-api-fixtures/Cargo.toml --test public_api_boundary_contract`: fails only for pre-existing unapproved `ticketry-desktop` exports `__cmd__native_terminal_set_module_manager_shortcut` and `__tauri_command_name_native_terminal_set_module_manager_shortcut`. There are no stale approvals or unapproved registrar exports. These unrelated concurrent edits were not changed. Log: `/tmp/coding-2683-api.log`.

- `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-provider --target-dir /tmp/coding-2683-provider-target`: 66 passed (2 unit, 64 integration). This includes 16 new Codex registrar cases covering configuration creation, exact canonical fields, byte-identical idempotence, moved app/extra-field repair, preservation, foreign ownership, invalid TOML/unsupported shapes, locks, read-only/symlink safety, inline tables, permissions, missing providers, PATH discovery, `CODEX_HOME` custom/unset/empty, and the HOME fallback. Existing provider contracts, Codex trust and run profile tests remain green. Log: `/tmp/coding-2683-provider-final.log`.
- `cargo test --manifest-path studio/src-tauri/Cargo.toml -p ticketry-desktop global_mcp_registration --lib`: 5 passed, covering both-provider registration, nonblocking once-only startup, every development/override skip, and safe locked/malformed/foreign outcomes with byte preservation. Log: `/tmp/coding-2683-desktop-final.log`.

## Packaged startup check

`bun run desktop:build -- --target macos-aarch64 --allow-unsigned --allow-dirty` succeeded. Log: `/tmp/coding-2683-package-build.log`.

Launched the newly built release `Ticketry.app/Contents/MacOS/ticketry` with a disposable HOME, CODEX_HOME, CLAUDE_CONFIG_DIR and tmux temporary directory, removing every data-directory override. This exercises the packaged registration path with an isolated product data directory. The existing `/Applications/Ticketry.app` process was kept running; this check does not claim that the user's installed bundle was upgraded.

- Runtime reached `rust-runtime-ready` at 471 ms, before either provider registration finished.
- Claude registered at 615 ms and Codex registered at 903 ms, each under startup ID `coding-2683-packaged`.
- The generated Codex entry contains exactly `command` and `args`; no `required`, environment, cwd, timeout or secret fields.
- Plain `codex mcp list --json` from the disposable folder outside this repository reports enabled `ticketry`, the packaged hook path and global args; env/cwd/timeouts are absent and env_vars is empty.
- Only this isolated desktop subprocess was stopped after capture.

Result capture: `/tmp/coding-2683-packaged-result.json`. Configuration, CLI JSON and startup log remain under `/var/folders/x3/w1t9fdpn291cb3sxyhlfq0y40000gn/T/coding-2683-packaged-tn_bpnx0`.

The CLI list check proves configuration exposure. The real fresh/resume loader probe above proves run-scoped field isolation. Cross-project tool calls, offline/reconnect and full real-session lifecycle acceptance remain owned by CODING-2684.
