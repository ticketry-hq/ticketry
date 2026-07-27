# ADR-0001 (T809): AgentAdapter is a frozen dataclass wrapping the unchanged injectors; the registry dict is the test seam

Date: 2026-07-05 · Status: Accepted (grill session, CODIN-809 refinement)

## Context

CODIN-809 introduces `apps.terminals.agents.registry` — `get_adapter(slug)` /
`all_slugs()` / `AgentAdapter.command(prompt)` / `AgentAdapter.inject(...)` —
replacing the `commands.py` dict + the four self-guarding `inject_*` calls
chained in `launch.py:114-117`, and deleting the `["echo", "Unknown agent: …"]`
sentinel that `session.py:125` string-sniffs. Two shape questions were open:
what an adapter *is*, and how tests bind fakes (today they monkeypatch
`get_agent_command` at each import site, which is why the
`consumers.py:227` rebinding hack exists).

## Decision

1. **Adapter shape: frozen dataclass, not Protocol.** One
   `@dataclass(frozen=True) AgentAdapter` with `slug` plus command/inject
   behavior delegating to the four **existing injector functions verbatim**.
   No per-agent classes; the four registry entries are data. S3 (CODIN-811)
   extends the dataclass with an optional headless capability rather than
   adding subclasses.
2. **Injectors stay untouched in S1.** Adapters wrap
   `inject_claude_lifecycle_settings` & co. unchanged — the `argv[0] != slug`
   guards stay, and the passthrough assertions in
   `test_{claude,codex,gemini,agy}_hook.py` stay. Guard/test cleanup rides S2
   (CODIN-810), which already plans to delete those test files.
3. **Test seam: patch the registry dict entry.** Tests bind fakes with
   `monkeypatch.setitem(registry._REGISTRY, "claude", FakeAdapter(...))`.
   `_REGISTRY` is the single lookup point, so the patch works regardless of
   which module imported `get_adapter` — no function-level rebinding, so
   `consumers.py:227` (`session_module.get_agent_command = get_agent_command`)
   is deleted outright. `FakeAdapter` lives in the existing
   `apps/terminals/fakes.py` (T800 precedent). The seam is documented in the
   registry docstring as sanctioned for tests.
4. **Unknown agents.** `get_adapter` raises `UnknownAgent`; `session.spawn`
   maps it to the existing `ValueError("unknown_agent")` at the same point the
   sentinel sniff sits today (after `_build_prompt`), so consumer error frames
   and error-precedence are byte-identical.

## Alternatives rejected

- **Protocol + four adapter classes**: more surface with no payoff until S3,
  and S3 is served by one optional field on the dataclass.
- **Public `register()` / override API**: interface growth whose only caller
  is tests; a mutable global registration API invites accidental production
  use. `monkeypatch.setitem` self-restores.
- **Function-level patching (`session_module.get_adapter = …`)**: recreates
  the import-site coupling that forced the consumers rebinding hack the ticket
  exists to delete.

## Consequences

- `_REGISTRY` is module-private yet a sanctioned test seam — a deliberate,
  documented exception, mirroring how ADR-0004 (T800) lets tests rebind the
  session registry.
- `validation.py`'s `VALID_AGENTS = set(all_slugs())` is an import-time
  snapshot; test fakes must therefore **override an existing slug** (e.g.
  `"claude"`), never add a new one, because the WS path validates the slug
  before `session.spawn` runs.
- Double lookup accepted: `session.spawn` resolves the adapter (for the
  error mapping + `command()`), and `_launch` resolves it again for
  `inject()`. `agent` stays a plain `str` across the `_launch` boundary, so
  `_launch`'s "already-built launch facts" contract is unchanged.
