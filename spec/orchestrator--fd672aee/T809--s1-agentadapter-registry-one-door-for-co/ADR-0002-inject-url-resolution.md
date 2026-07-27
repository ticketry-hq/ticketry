# ADR-0002 (T809): `inject()` takes both URLs as required kwargs; launch.py is the single resolution point

Date: 2026-07-05 · Status: Accepted (grill session, CODIN-809 refinement)

## Context

Today the four injectors default their URLs
(`lifecycle_url=DEFAULT_LIFECYCLE_URL`, `mcp_url=DEFAULT_MCP_URL`),
`launch.py` resolves only `mcp_url` (from the `WORKTRACKER_MCP_URL` env var) and
never passes `lifecycle_url`, and the Gemini injector does not accept
`mcp_url` at all. The proposed adapter interface —
`inject(argv, agent_run_id, *, lifecycle_url, mcp_url)` — had to pick who
resolves what.

## Decision

- `AgentAdapter.inject` requires **both** `lifecycle_url` and `mcp_url` as
  keyword-only arguments. No defaults on the adapter.
- `launch.py` is the **only** resolution point: it reads
  `WORKTRACKER_MCP_URL` (falling back to `DEFAULT_MCP_URL`) as today, and passes
  `DEFAULT_LIFECYCLE_URL` explicitly.
- The **Gemini adapter accepts `mcp_url` and ignores it** — Gemini gets no MCP
  injection today, and preserving that asymmetry is an explicit S1 requirement
  (recorded in the adapter docstring; changing it is out of scope for the
  whole CODIN-808 module).

## Alternatives rejected

- **Keep defaults on `inject()`**: two places would know the default URLs, and
  the env-var resolution would stay ad hoc in launch anyway.
- **Adapters resolve env themselves**: makes adapters env-dependent — worse
  for the parametrized registry contract test and for S3's headless reuse of
  the same adapters.

## Consequences

- Adapters are deterministic given their arguments (the gemini/agy `mkstemp`
  settings file is the one filesystem side effect; tests assert it via the
  `env GEMINI_CLI_SYSTEM_SETTINGS_PATH=…` / agy env-wrapper argv prefix).
- Behavior preservation is byte-for-byte on the produced argv, including the
  bits the original ticket text under-specified: gemini also gains
  `--skip-trust`, agy deliberately adds **no** CLI flag (only the env
  wrapper), and claude/codex splice their flags immediately after the
  executable.
- S3 (CODIN-811) follows the same rule: the headless command surface takes
  caller-resolved URLs; no adapter reads the environment.
