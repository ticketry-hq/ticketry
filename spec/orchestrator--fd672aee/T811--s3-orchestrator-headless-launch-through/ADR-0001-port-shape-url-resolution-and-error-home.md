# ADR-0001 (T811): Orchestrator resolves the MCP URL; the port takes a required `str`; `HeadlessUnsupported` lives in the neutral registry module

Date: 2026-07-05 · Status: Accepted (grill session, CODIN-811 refinement)

## Context

The ticket's proposed port signature was `headless_command(agent, model, prompt,
mcp_url: str | None) -> list[str]`, leaving open who folds `None` to the
`WORKTRACKER_MCP_URL` env var / `DEFAULT_MCP_URL`. T809's ADR-0002 (accepted)
already rules that adapters never read the environment and that "S3 follows the
same rule". Today the resolution (`worktracker_mcp_url()`) lives in
`orchestrator/headless.py`, and `launch_headless_run` never passes `mcp_url`,
so the env path is the only live path. Separately, the ticket named a new
`HeadlessUnsupported` exception without a home — and the orchestrator cannot
import it from `apps.terminals` because `test_scaffold.py`'s AST walk covers
`orchestrator/tests/` too. It also hedged on the registry home
("session_registry.py or sibling agent_registry.py").

## Decision

1. **Orchestrator resolves the URL.** `worktracker_mcp_url()` (env +
   `DEFAULT_MCP_URL` fallback) stays in `orchestrator/headless.py`. The port
   method takes a **required** `mcp_url: str`; `str | None` is dropped from the
   interface. Terminals-side headless builders are deterministic given their
   arguments, exactly like `AgentAdapter.inject` under T809 ADR-0002.
2. **Registry home: extend `apps/core/session_registry.py`.** The module gains
   a parallel `bind_headless()` / `get_headless()` / reset pair next to the
   Session binding; its docstring is retitled to "neutral registry for
   terminals-bound ports". No sibling module.
3. **`HeadlessUnsupported` lives in `apps/core/session_registry.py`** (the one
   module both sides already import). The terminals adapter raises it for
   agents whose adapter has no headless capability; `orchestrator/headless.py`
   catches it and re-raises `HeadlessLaunchError(f"unknown_agent:{agent}")` so
   the driver-visible error string is byte-identical to today.
4. **`build_headless_command` survives as a thin orchestrator wrapper**: it
   keeps the agent-agnostic `model_required` / `prompt_required` validation,
   resolves the URL, calls the port, and maps the error. `ports.py` keeps its
   "imports nothing but typing" rule (the exception import happens in
   `headless.py`, not `ports.py`).

## Alternatives rejected

- **Adapter folds `None` → env**: violates T809 ADR-0002; would have required
  amending an accepted ADR for no gain.
- **Neutral URL resolver in `apps.core`**: moves env knowledge away from its
  only consumer; the orchestrator is the caller and already owns the default.
- **Pre-check `agent in port.headless_agents()` instead of catching**: two
  sources of the same rule (set membership and the adapter's raise) that can
  drift; the exception is the single authority.
- **Stdlib sentinel (`LookupError("headless_unsupported:…")`)**: a stringly
  contract with no shared symbol to grep for.
- **Sibling `agent_registry.py`**: a second near-identical 40-line module and a
  second `reset()` for conftests, for naming purity only.

## Consequences

- Adding a headless-capable agent later means giving its `AgentAdapter` a
  builder; no orchestrator file changes.
- The interactive ("worktracker" server name, no `type` key) and headless
  ("worktracker" server name, `"type": "http"`) MCP config shapes remain
  deliberately distinct — both byte-preserved; the headless builders do NOT
  reuse `build_codex_mcp_servers`.
- `build_worktracker_mcp_config` and the `_to_toml_inline` copy are deleted
  from `orchestrator/headless.py`; the builders move terminals-side verbatim
  and reuse `injectors/codex.py`'s `_to_toml_inline`.
