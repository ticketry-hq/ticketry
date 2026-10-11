# CODING-2681 Codex MCP precedence evidence

Date: 2026-10-10. Installed CLI: `codex-cli 0.162.0`. PR-ready evidence artifact; no PR was created or published by this investigation.

Ticketry now prepares a per-run Codex profile that resets only `mcp_servers.ticketry` before the generated credentialed CLI override. Fresh and resume materialization use that prepared profile; a selected original profile is copied into the same `CODEX_HOME` and keeps its other settings, servers, and relative-path meaning. Data-only execution retains its existing `mcp_servers={}` and `--ignore-user-config` flags; the resident app-server retains the empty override and adds generated `enabled=false` entries for existing user servers.

This expands the original inline-override approach with the user's approval. Installed 0.162.0 recursively merges `env={}` and `mcp_servers={}`, so those literals alone cannot establish isolation. The initial manual probes below explain the change.

## Implemented artifact and generated launch validation

The provider public API `prepare_codex_run_mcp_profile` creates `$CODEX_HOME/ticketry-run-<run-uuid-without-hyphens>.config.toml`. It copies the selected original profile if present and replaces only its `ticketry` server with `[]`. With no selected profile it writes only the reset barrier, leaving base user settings to Codex. The final highest-precedence launch override supplies the canonical run server: `command`, `args`, `env_vars=["TICKETRY_MCP_AUTHORIZATION"]`, and `required=true`. The reset removes all inherited server fields, including fields whose absent/default behavior cannot be represented by an empty TOML value.

The files use owner-only permissions, a per-run preparation lock, and same-directory atomic replacement. Same-run identical preparation avoids rewriting bytes; resume regenerates from the original selected profile. Missing/malformed selected profiles, unsafe names, invalid run identities, symlinks, read-only output locations, and locked artifacts fail. Errors do not echo profile contents. Original user configuration, selected profile, authentication, and `CODEX_HOME` remain unchanged. Prepared per-run files are retained for active/saved run resume; this change adds no automatic cleanup policy.

Public filesystem tests: nine passed. Provider suite: 50 passed. The secret-diagnostic test failed before sanitization and passed afterwards; the initial profile test failed before the public API existed and passed after implementation.

Real-CLI verification of Ticketry's **actual generated profile and launch override** is defined in `studio/src-tauri/crates/execution/ticketry-launch/tests/codex_mcp_precedence.rs`. It covers fresh/resume, stdio/HTTP user `ticketry` entries, no selected profile/selected `work` profile, inherited environment/cwd/disabled state/timeouts, unrelated servers, and unchanged original config/authentication marker. Recorded result: exit 0, one integration test passed, exercising eight cases (two global transports × two profile selections × fresh/resume). Unlike the historical probe below, this test consumes the profile name returned by the public provider operation and the MCP override emitted by public launch materialization. User base configuration, selected profile, and authentication-marker bytes remained unchanged. This verifies effective configuration; it does not launch an interactive agent or exercise a credential handshake.

```sh
cd studio/src-tauri
cargo test -p ticketry-launch --test codex_mcp_precedence -- --ignored --nocapture
```

One of the eight recorded effective-server results (all eight had the same isolated run fields):

```json
{
  "name": "ticketry",
  "enabled": true,
  "disabled_reason": null,
  "transport": {
    "type": "stdio",
    "command": "/Applications/Ticketry App/ticketry-hook",
    "args": ["mcp", "--data-dir", "/private/Ticketry Data", "--agent-run-id", "019e9428-9788-7df0-84cd-755e1b776245"],
    "env": null,
    "env_vars": ["TICKETRY_MCP_AUTHORIZATION"],
    "cwd": null
  },
  "startup_timeout_sec": null,
  "tool_timeout_sec": null,
  "auth_status": "unsupported"
}
```

The generated profile name was `ticketry-run-019e942897887df084cd755e1b776245`. The integration test forwards `--profile <emitted-name> -c <emitted-mcp-override>` to `codex mcp list --json`; it does not reconstruct the server TOML independently.

The combined provider/launch/app-server/terminal check passed: provider 50, launch 83 (three ignored manual/fixture entries; the real-CLI precedence test passed separately above), app-server 20 (one ignored child fixture), and terminal 123. `bun run --cwd studio test:overhaul` also exited 0, including the numbered OFF20 gate. These counts do not establish a repository-wide suite or installed-desktop acceptance run.

The public API fixture now includes the provider operation. The shared boundary gate currently reports two preexisting ModuleManager desktop shortcut export omissions from the dirty checkout; that separate baseline is not a provider API approval failure.

All probes used newly created temporary `CODEX_HOME` directories. No real user configuration, credentials, WorkTracker connections, or Ticketry state was used. `mcp list --json` inspects configuration without starting the configured MCP commands. Marker values below are synthetic and nonsecret.

## Historical manual reproduction: merge failure and separate-layer reset

Run this Python script from any scratch directory. It removes its temporary fixture after the checks.

```python
import json
import os
import pathlib
import subprocess
import tempfile

with tempfile.TemporaryDirectory(prefix="coding-2681-") as directory:
    home = pathlib.Path(directory)
    home.joinpath("config.toml").write_text('''
[mcp_servers.ticketry]
command = "/global/ticketry-hook"
args = ["mcp", "--global"]
cwd = "/global/cwd"
env_vars = ["GLOBAL_MARKER"]
enabled = false
required = false
startup_timeout_sec = 1
tool_timeout_sec = 2
enabled_tools = ["global_only_tool"]
disabled_tools = ["run_only_tool"]
environment_id = "local"
[mcp_servers.ticketry.env]
GLOBAL_MARKER = "global-value"
[mcp_servers.ticketry.tools.global_only_tool]
approval_mode = "approve"
[mcp_servers.other]
command = "/other/command"
''')
    home.joinpath("probe.config.toml").write_text(
        "mcp_servers.ticketry=[]\n"
    )
    env = dict(os.environ, CODEX_HOME=str(home))
    override = (
        'mcp_servers={ticketry={'
        'args=["mcp","--data-dir","/private/Ticketry Data",'
        '"--agent-run-id","run-1"],'
        'command="/Applications/Ticketry App/ticketry-hook",'
        'env={},env_vars=["TICKETRY_MCP_AUTHORIZATION"],required=true}}'
    )

    def inspect(*options):
        result = subprocess.run(
            ["codex", *options, "mcp", "list", "--json"],
            env=env, text=True, capture_output=True, check=True,
        )
        return json.loads(result.stdout)

    def ticketry(servers):
        return next(server for server in servers if server["name"] == "ticketry")

    merged = inspect("-c", override)
    assert ticketry(merged)["transport"]["env"] == {
        "GLOBAL_MARKER": "global-value"
    }
    assert ticketry(merged)["transport"]["cwd"] == "/global/cwd"
    assert ticketry(merged)["enabled"] is False
    assert ticketry(merged)["startup_timeout_sec"] == 1
    assert ticketry(merged)["tool_timeout_sec"] == 2
    assert len(inspect("-c", "mcp_servers={}")) == 2

    clean = inspect("-p", "probe", "-c", override)
    run = ticketry(clean)
    assert run["transport"]["env"] == {}
    assert run["transport"]["cwd"] is None
    assert run["transport"]["env_vars"] == ["TICKETRY_MCP_AUTHORIZATION"]
    assert run["enabled"] is True
    assert run["startup_timeout_sec"] is None
    assert run["tool_timeout_sec"] is None
    assert next(s for s in clean if s["name"] == "other")["transport"]["command"] == "/other/command"
    print(json.dumps(run, indent=2))
    print("PASS: nested-map leak reproduced; profile reset preserves other server")
```

Recorded result for the initial manually constructed profile candidate, exit 0:

```json
{
  "name": "ticketry",
  "enabled": true,
  "disabled_reason": null,
  "transport": {
    "type": "stdio",
    "command": "/Applications/Ticketry App/ticketry-hook",
    "args": ["mcp", "--data-dir", "/private/Ticketry Data", "--agent-run-id", "run-1"],
    "env": {},
    "env_vars": ["TICKETRY_MCP_AUTHORIZATION"],
    "cwd": null
  },
  "startup_timeout_sec": null,
  "tool_timeout_sec": null,
  "auth_status": "unsupported"
}
```

This command proves the effective transport, enabled state, and exposed timeouts. `mcp list` does not expose all tool-policy fields, so this output is not a runtime tool-policy or credential-handshake acceptance claim. Profile replacement of the entire table is also supported by the tagged merge implementation described below.

The baseline production golden at investigation time contained `command`, `args`, `env_vars`, and `required`, without `env={}`. The first probe reconstructs that golden and adds `env={}` to demonstrate why adding an empty map cannot solve the acceptance criterion. The profile command above was a manually constructed investigation candidate. It must be distinguished from the current public-API/materialization integration test described above.

## Exact CLI limitations

- Repeated overrides using `mcp_servers`, `mcp_servers.ticketry`, or `mcp_servers.ticketry.env` set to `[]`, `""`, or raw `null`, followed by the run table, all retain `GLOBAL_MARKER`. Codex assembles one CLI layer before merging it with the user layer.
- A separate profile containing `mcp_servers.ticketry=[]` supplies the non-table replacement before the CLI table. It clears the inherited server, and keeps the unrelated `other` server. A profile containing `mcp_servers=[]` followed by `-c mcp_servers={}` makes `mcp list --json` return `[]`.
- `codex -p probe app-server -c mcp_servers={}` exits 1: `--profile only applies to runtime commands and codex mcp`. App-server cannot use this profile seam on 0.162.0.
- `-c profile="probe"` exits 1 because legacy `profile` is unsupported; `-c config_profile_v2="probe"` does not select the profile and inherited environment keys remain.
- Installed `codex exec --help` documents `--ignore-user-config`: skip `$CODEX_HOME/config.toml`, retaining `CODEX_HOME` for authentication. Installed app-server rejects that flag, including at the root position.
- `mcp_servers.ticketry.enabled=false` without a preexisting `ticketry` entry exits 1 with `invalid transport`. A disabled stdio sentinel with `command=""`, `args=[]`, and `enabled=false` is accepted, but retains other servers and cannot safely replace an inherited HTTP transport (its `url` would conflict).
- `--strict-config` is unsupported for `codex mcp`; the profile probe does not establish strict-config compatibility.

## Schema and source basis

The installed `codex app-server generate-json-schema --out <temporary-directory>` succeeds but emits the protocol schema, not `RawMcpServerConfig`. The exact-version authoritative config schema was fetched from [OpenAI Codex rust-v0.162.0 config.schema.json](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/core/config.schema.json).

`RawMcpServerConfig` declares these 29 supported keys:

```text
args auth bearer_token_env_var command cwd default_tools_approval_mode
 disabled_tools enabled enabled_tools env env_http_headers env_vars
 environment_id http_headers http_headers_helper name oauth oauth_resource
 omit_tools_from required scopes startup_readiness startup_timeout_ms
 startup_timeout_sec supports_parallel_tool_calls tool_input_schema_max_bytes
 tool_timeout_sec tools url
```

The tagged [MCP type validation](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/config/src/mcp_types.rs) rejects HTTP-only fields on stdio even when they are empty: `url`, `bearer_token_env_var`, `http_headers_helper`, `http_headers`, `env_http_headers`, `oauth`, `oauth_resource`, and `auth`. Legacy `bearer_token` is accepted only to reject it explicitly and is intentionally absent from the supported-field schema. TOML has no null literal, and setting empty option values is not equivalent to omitting them. For example, `enabled_tools=[]` exposes no tools rather than restoring the default unrestricted list.

The tagged [CLI override builder](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/config/src/overrides.rs) builds one override table. The [config merge implementation](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/config/src/merge.rs) recursively merges tables and replaces non-tables. The [config loader](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/config/src/loader/mod.rs) orders user config, selected profile, project config, then CLI config. The [CLI dispatch](https://github.com/openai/codex/blob/rust-v0.162.0/codex-rs/cli/src/main.rs) rejects profile selection for app-server.

## Helper behavior and scope

Data-only `codex exec` retains its existing `--ignore-user-config` and `-c mcp_servers={}` arguments; this campaign does not change that launch. This skips the user config while retaining the same authentication/session home. The resident app-server cannot use that flag or a profile on 0.162.0, so it reads existing user server names at spawn and generates a highest-precedence inline table containing `enabled=false` for each. It preserves the existing transport fields, which avoids introducing an invalid transport for missing servers or conflicting stdio/HTTP fields. TOML serialization handles names containing dots or quotes; dotted `-c` key paths cannot safely do that because Codex splits them literally on `.`.

The app-server argument-list tests prove generated existing-user-server suppression in addition to the mandated empty override. The empty override alone remains an argument contract, not MCP-isolation evidence. A separate manual probe using actual codex-cli 0.162.0 completed `initialize` and `config/read` successfully for absent configuration and a present configuration with three stdio/HTTP entries whose names included dots and quotes. All three existing user entries were disabled by the generated override. This is effective configuration evidence, distinct from fake-executable argument tests; it does not start Ticketry MCP commands or model turns.

Actual helper probe argument vector for the present-config case (shown structurally to avoid shell-quoting ambiguity):

```json
["codex", "app-server", "--stdio", "-c", "mcp_servers={}", "-c", "mcp_servers={ ticketry = { enabled = false }, \"docs.api\" = { enabled = false }, 'quoted\"name' = { enabled = false } }"]
```

The disposable user config held `ticketry` with stdio command `ticketry-hook`, `docs.api` with HTTP URL `http://127.0.0.1:1/mcp`, and `quoted"name` with stdio command `other-hook`. The argument map matches the public client's generated override. The absent-config case used the first five arguments only, with no conditional map. Both cases kept the original temporary `CODEX_HOME` and left the source configuration unchanged.

The probe sent these JSON-RPC messages in order, waiting for initialization before the final request:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"ticketry","version":"probe","title":"Ticketry"}}}
{"jsonrpc":"2.0","method":"initialized"}
{"jsonrpc":"2.0","id":2,"method":"config/read","params":{"includeLayers":false}}
```

Recorded summaries extracted from successful responses, including comparison with the original fixture bytes:

```json
{"app_server_config":"present stdio+HTTP+quoted","initialize":"ok","config_read":"ok","servers":{"quoted\"name":false,"ticketry":false,"docs.api":false},"original_home_preserved":true,"config_unchanged":true}
{"app_server_config":"absent","initialize":"ok","config_read":"ok","servers":{},"original_home_preserved":true,"config_unchanged":true}
```

The public-client automated argument checks are in `studio/src-tauri/crates/execution/ticketry-codex-app-server/tests/mcp_isolation.rs` (four parent cases and an explicitly invoked isolated subprocess entry point). The real-CLI probe above was a separate manual check; its summaries were recorded from the tool result and there is no persistent raw-log artifact.

The precedence contract here covers the user's configuration entry and an explicitly selected original profile. Codex can also load system, cloud, managed, and trusted project configuration layers. A new MCP name introduced only by one of those other layers is outside the resident helper's observed-user-name suppression contract. Project layers following the selected run profile can also introduce fields before the CLI override; this evidence does not claim isolation from arbitrary additional managed/project MCP configuration. The resident helper remains the ADR 0012 metadata helper: it may rename provider thread titles as a cosmetic update, and never starts or resumes a thread.

The original claim that a full inline field set alone clears inherited settings was disproved. The implemented profile reset addresses that user-entry precedence problem without changing `CODEX_HOME`, dropping unrelated run servers, or persisting run credentials. No PR was created or published by this investigation, and configuration-level CLI checks are not installed Ticketry handshake or desktop acceptance evidence.
