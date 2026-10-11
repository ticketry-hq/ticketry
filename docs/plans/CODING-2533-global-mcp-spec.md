# CODING-2533 implementation specification

Story: MCP server running across Codex and Claude. Every Claude Code and Codex session on this computer reaches the WorkTracker MCP while Ticketry is running.

Work item: `568cae49-edab-47fc-a762-40c55bcfba7b`. Specification date: 2026-10-10.

## Problem statement

The WorkTracker MCP is available only inside agent runs that Ticketry itself launches. Ticketry injects a run-scoped, credentialed server into each launch command. A Claude Code or Codex session that the user opens in an ordinary terminal, in any folder, has no WorkTracker server. It cannot list projects, read tickets, or move work through the workflow, even though Ticketry is running on the same machine and owns the data.

The user wants the server everywhere: "All claude and codex instances should be connected to ticketry, that is if ticketry is running and should be able to interact with the MCP server."

## Solution

When the installed Ticketry desktop app starts, it registers a `ticketry` MCP server in the user-level configuration of Claude Code and Codex. The registered server is the packaged `ticketry-hook` stdio bridge in a new explicit **global** mode, pointing at the product data directory. Any Claude or Codex session started afterwards loads it, wherever it was started.

While Ticketry is running, a global session can use the WorkTracker tools across all projects. Workflow gates still apply, as do agent-origin transition permissions, and run-only controls stay unavailable. While Ticketry is not running, the server stays registered and its calls fail promptly with the bridge's existing `service_unavailable` error. Nothing crashes, and the session itself keeps working.

Ticketry-launched agents are unchanged. They keep their run-scoped, credentialed `ticketry` server, which replaces the global one in that session for both providers.

## User stories

1. As a user running `claude` in any terminal and folder, I want the WorkTracker tools available, so that I can read and update tickets without launching the agent from Ticketry.
2. As a user running `codex` in any terminal and folder, I want the same WorkTracker tools, so that both of my coding agents behave alike.
3. As a user, I want the server set up for me when Ticketry starts, so that I never edit `~/.claude.json` or `~/.codex/config.toml` by hand.
4. As a user, I want my other MCP servers and settings in those files left untouched, so that registering Ticketry never breaks my setup.
5. As a user, I want the registration to happen only once and to be idempotent, so that restarting Ticketry does not churn or reformat my configuration files.
6. As a user who moves or reinstalls Ticketry.app, I want the next start to repair the registered command path, so that the server keeps working.
7. As a user who has set `CLAUDE_CONFIG_DIR` or `CODEX_HOME`, I want Ticketry to register in the configuration those tools actually read, so that the server appears in my sessions.
8. As a user whose Claude or Codex configuration is locked, malformed, or of an unsupported shape, I want Ticketry to skip registration with a diagnostic rather than overwrite it, so that my files are never damaged.
9. As a user without Claude or Codex installed, I want Ticketry to skip that provider quietly, so that startup is unaffected.
10. As an agent in a global session, I want to list projects, modules, and tasks across every project, so that I can find work regardless of my working directory.
11. As an agent in a global session, I want to create, update, and comment on work items and record dependencies, so that I can interact with Ticketry fully.
12. As an agent in a global session, I want state changes to obey the same workflow graph and agent-allowed transition permissions as Ticketry-launched agents, so that the global entry cannot bypass the workflow.
13. As an agent in a global session, I want `terminate_current_run` and other run-only controls refused clearly, so that a session without a run cannot act as one.
14. As an agent in a global session, I want launches I trigger attributed to the global MCP caller, so that history shows where the action came from.
15. As a user, I want a session that I started while Ticketry was closed to keep working, with WorkTracker calls returning a clear `service_unavailable` error rather than hanging or crashing.
16. As a user, I want a Codex session to start normally when Ticketry is not running, so that a registered but offline server never blocks Codex startup.
17. As a user, I want a session to regain WorkTracker access after Ticketry starts, at the latest after reconnecting the server from the CLI's MCP controls, so that I do not lose my conversation.
18. As a user running a Ticketry-launched Claude agent, I want the agent to use only its run-scoped credentialed server, not the global one, so that its project scope and run identity still apply.
19. As a user running a Ticketry-launched Codex agent, I want the same guarantee, with no field of the global entry leaking into the run-scoped server, so that run credentials and settings are exactly what Ticketry chose.
20. As a user, I want Ticketry's internal data-only Codex execution and its resident Codex app-server to stay free of the global server, so that background helpers never open WorkTracker connections.
21. As a developer running `bun run desktop:dev` or an isolated data directory, I want development instances not to overwrite the user-level registration, so that my installed Ticketry keeps working.
22. As a developer, I want a credential-less, malformed, or failed run-mode handshake never to fall back to global mode, so that global authority is only ever claimed explicitly.
23. As a security-conscious user, I want the socket to remain accessible only to my user account and no secret to be written into any provider configuration file, so that global registration adds no new exposure.
24. As a maintainer, I want the bridge's help text and CLI to document global mode, so that people can register it by hand when needed.
25. As a maintainer, I want registration failures and outcomes traced at startup, so that support can see why a session lacks the server.

## Implementation decisions

### Bridge: explicit global mode

- Add a global mode to the `ticketry-hook mcp` subcommand: `ticketry-hook mcp --data-dir <absolute-path> --global`. `--global` and `--agent-run-id` are mutually exclusive, and exactly one is required. The existing run-mode invocation and its behaviour are unchanged.
- In global mode the bridge sends the listener's existing global envelope (`{"ticketry_mcp_auth":1,"mode":"global"}`) on every connection and reconnection. It neither reads nor requires `TICKETRY_MCP_AUTHORIZATION`. In run mode a missing authorization is still an error and never degrades to global.
- Global mode reuses the bridge's existing lifecycle: backoff reconnection, prompt `-32001 service_unavailable` while disconnected, initialize caching and replay, no request replay, and stdout carrying only protocol messages.
- The listener-side global mode, its scope handling, and its refusal of `terminate_current_run` without a bearer already exist and are not redesigned. Global-mode state transitions use the existing agent-origin path, so workflow graph gates and `agent_allowed` permissions apply. Launches keep the existing `mcp:global:<id>` request identity and caller attribution.

### Registrar: user-level provider configuration

- Add a focused global MCP registration capability to the provider crate, next to the existing directory-trust editors. It exposes one public operation that ensures the `ticketry` entry for a provider and returns an outcome: `registered`, `updated`, `unchanged`, `skipped` with a reason, or `failed` with a diagnostic. Re-export it from the crate's public API and update the API boundary contract test.
- **Claude.** Upsert top-level `mcpServers.ticketry` in Claude's application state file: `$CLAUDE_CONFIG_DIR/.claude.json` when set, otherwise `$HOME/.claude.json`. This is Claude's user scope. Reuse the existing Claude state locking, compare-and-swap atomic write, and JSON validation. Preserve every other key byte-for-byte where the format allows.
- **Codex.** Upsert `[mcp_servers.ticketry]` in `$CODEX_HOME/config.toml` when set, otherwise `$HOME/.codex/config.toml`. Use format-preserving TOML editing and the same atomic-exchange approach as Codex directory trust. Comments, ordering, and other servers must survive.
- **Entry shape.** The global entry is stdio, with `command` set to the resolved packaged hook-runner path and `args` set to `["mcp", "--data-dir", <product data directory>, "--global"]`. It carries no other fields: no `env`, `env_vars`, `cwd`, `required`, or timeouts, and never a secret. Codex must not mark it `required`; while Ticketry is offline the bridge refuses `initialize`, and a required server would block Codex startup.
- **Ownership and idempotence.** Write only when the entry is absent, or when it is recognisably Ticketry's: its command basename is `ticketry-hook` and its args contain `mcp` and `--global`. Write only when the command, the data directory, or the shape differs. A user-authored `ticketry` entry that is not recognisably Ticketry's is left alone, with outcome `skipped` (`foreign_entry`). Malformed files, unsupported shapes, and locks held past the existing bounded retry result in `skipped` or `failed` without any write.
- **Missing providers.** If the provider is not installed and its configuration file does not exist, skip it rather than creating a configuration tree for an absent tool. If the configuration file exists, register even when the CLI binary cannot be resolved.

### Desktop startup integration

- The desktop app runs registration for Claude and Codex once per start, as a non-blocking background step after the data directory and the hook-runner path are resolved. Registration failure never delays readiness, the MCP listener, or launches. Each outcome is emitted as a startup trace event without secrets.
- Register only from the installed, packaged app using the product data directory. Development builds and any process with a data-directory override environment variable (`TICKETRY_DATA_DIR`, `TICKETRY_PRODUCT_DATA_DIR`, `MUXED_DATA_DIR`, `TICKETRY_DATA_DIR_NAME`) skip registration with reason `development_instance`. The GraphQL development adapter never registers.
- There is no unregistration on quit. The entry is harmless while Ticketry is down. A moved app is repaired on its next start.

### Run-scoped launches keep precedence

- Keep the server name `ticketry` for both the global and the run-scoped entries.
- **Claude.** This was verified on Claude Code 2.1.286 with marker-writing probe servers. A `--mcp-config` server named `ticketry` replaces a user-scope `ticketry` entry; only the run-scoped server process starts. No launch change is required, and `--strict-mcp-config` is not introduced, because it would drop the user's other servers.
- **Codex.** Additional CODING-2681 probes on codex-cli 0.162.0 show that `-c mcp_servers={ticketry={...}}` recursively merges tables: even `env={}` keeps arbitrary inherited environment keys. Repeated CLI overrides form one layer, so a scalar followed by a table in that layer does not reset the user entry. Setting every field is also invalid for stdio because HTTP-only fields are mutually exclusive. The user approved expanding the isolation design on 2026-10-10.
  - Prepare a private, stable profile named for the concrete run in the original `CODEX_HOME`. Copy the selected user profile, when present, and replace only its `mcp_servers.ticketry` with `[]`. This distinct profile layer replaces the entire lower-priority global entry before the run's CLI table supplies its canonical stdio fields.
  - Validate the original user profile against the existing catalog before substituting the prepared profile in fresh or resume argv. Preserve every other selected-profile setting and MCP entry. Keep `CODEX_HOME`, credentials, and provider conversation/session identities unchanged.
  - Fail the launch if preparation fails. Never modify the user's base configuration or original profile. Write owner-only generated files atomically and retain them while runs remain active; resume prepares its own run's profile. Generated profiles are runtime artifacts and must not be committed.
  - The registrar must still write only the canonical secret-free global shape. Golden tests lock the canonical CLI fields and prepared-profile selection; a real CLI check proves inherited fields are absent.
- Ticketry's non-interactive Codex processes must not load the global server. Data-only `codex exec` already uses `--ignore-user-config` and `mcp_servers={}`. The resident `codex app-server` retains the empty override and explicitly disables existing user MCP entries, preserving their valid transport shape; it remains a title read/rename helper that never starts, resumes, or forks threads, per ADR 0012. An empty table alone is not evidence of isolation. Missing user configuration is allowed, while unreadable or malformed configuration fails helper startup safely.

### Contracts and data

- No database migration, GraphQL change, or MCP tool-contract change. The socket handshake protocol is unchanged; global mode already exists in version 1.
- Documentation: update the root and agent guidance where they describe provider MCP, and the bridge help text, to say that installed Ticketry registers a global `ticketry` server for Claude and Codex.

## Testing decisions

Good tests here assert externally observable behaviour: the bytes written to a configuration file, the arguments a launch produces, and what a socket client or the bridge's stdio peer sees. They do not assert private helpers. The seams below were agreed with the user.

1. **Bridge global mode (black box).** Run `ticketry-hook mcp --global` against a real in-process socket listener. Prove initialize, `list_projects`, and a cross-project read succeed. Prove `terminate_current_run` is refused. Prove an offline listener yields `-32001` and that reconnect works. Prove that `--global` with `--agent-run-id`, neither flag, or run mode without authorization all fail without connecting as global. Prior art: the hook crate's `mcp_bridge` and `mcp_runtime` integration tests and its CLI tests; the MCP crate's `connect_global` test support.
2. **Registrar (public provider API against temp files).** For both providers, test:
   - creation into empty or missing user configuration where appropriate;
   - idempotent `unchanged` on a second run, with identical bytes;
   - an `updated` repair after a command-path change;
   - preservation of unrelated servers, keys, comments, and ordering;
   - `foreign_entry` skip for a user-authored `ticketry`;
   - malformed or locked files left untouched;
   - honouring `CLAUDE_CONFIG_DIR` and `CODEX_HOME`;
   - no secret and no extra fields in the written entry.
   Prior art: the provider crate's Claude, Codex, and Gemini directory-trust tests and the desktop directory-trust command tests.
3. **Launch precedence.** Extend MCP launch golden tests to cover the canonical Codex fields and prepared profile on fresh and resume launches. Test the public profile-preparation API against temporary files, including preservation, idempotence, malformed input and symlinks. Exercise generated profile plus generated override with real `codex mcp list --json` and inherited `env`/`cwd` fields. Lock data-only `codex exec` isolation arguments and app-server spawn arguments for absent and present stdio/HTTP user entries. Keep the existing Claude `--mcp-config` golden expectations.
4. **Manual acceptance with real CLIs**, recorded as evidence in `docs/plans/`:
   - With installed Ticketry running, start plain `claude` and `codex` in an arbitrary folder outside every module. Call `list_projects` and `get_task_details` for a known key.
   - Quit Ticketry and confirm `service_unavailable` while the session keeps running.
   - Restart Ticketry, then reconnect (Claude `/mcp`) and confirm the calls succeed.
   - Launch an agent from Ticketry and confirm it reports run-scoped behaviour: a project-scoped `list_tasks`, and a working `terminate_current_run`.

## Out of scope

- Gemini and Agy registration. Agy cannot expand environment secrets in its global config (CODING-1561 evidence); a global Gemini entry can follow later.
- A Settings toggle, an opt-out UI, or unregistration on uninstall.
- Read-only or working-directory-scoped global authority. Global sessions get full global access, as the user decided.
- Changing the handshake protocol, adding a TCP or HTTP transport, or a per-session credential for global sessions.
- Making Claude or Codex automatically re-initialize a server that failed while Ticketry was offline, beyond the CLIs' own reconnect controls.

## Further notes

- Decisions confirmed by the user in the Ideas stage (2026-10-09): full global access; automatic registration on app start; Claude and Codex only. The test seams were confirmed in the Spec stage (2026-10-10).
- Probe evidence was gathered 2026-10-10 with temporary `CLAUDE_CONFIG_DIR` and `CODEX_HOME` directories in a scratch location; no user configuration was modified. Claude's `-p` probe stopped at login, but MCP servers had already started, which is enough for the precedence observation.
- Related design: `docs/plans/CODING-1550-mcp-socket-spec.md` (socket, bridge, global mode must be explicit) and `docs/plans/CODING-1561-mcp-release-evidence.md` (provider configuration evidence).
