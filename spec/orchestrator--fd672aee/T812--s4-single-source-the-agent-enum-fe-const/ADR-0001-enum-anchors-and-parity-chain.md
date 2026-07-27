# ADR-0001 — Agent-enum anchors and the parity chain (CODIN-812)

Status: accepted · Date: 2026-07-05 · Refinement interview for T812

## Context

The agent slug set `["claude", "agy", "codex", "gemini"]` is hand-kept in ~10
places across studio and server (sweep verified: 6 FE unions/arrays + 1 FE
generated JSON schema + 4 BE Literals/sets + 1 BE dispatch dict + 1 docstring).
TS can derive types from a const; Pydantic/Ninja `Literal`s cannot be built
dynamically without losing static analysis, so the BE copies must stay static
and be *pinned*, not replaced.

## Decisions

1. **FE single source is the wire contract.** `lib/transport/wireContract.ts`
   gains `export const AGENTS = [...] as const`; `AgentKind` is derived from it
   and every other FE union imports it. Rationale: the transport lib is the
   FE's mirror of the server's declared models — the enum *is* wire contract.
   The `IssueDrawerTabs.tsx` copy carried a deliberate "stays decoupled from
   AgentPicker" comment; that decision is retired because the new dependency
   is on the neutral transport lib, not on the coding module.
2. **BE Literals stay static, pinned by a parity test** against the CODIN-809
   registry's `all_slugs()` via `typing.get_args` — **3 assertions**:
   `frames.py` `InitSpawnFrame.agent`, `execution/api.py` `PlanningAgent`,
   `worktracker_gateway/schemas.py` `LifecycleEvent.agent`. `validation.py`
   `VALID_AGENTS` is **excluded**: S1 rewrites it to `set(all_slugs())`
   (derived), so asserting it would be a tautology.
3. **FE↔BE parity rides the committed generated schema.**
   `wire-frames.schema.json` (exported from `frames.py` by
   `manage.py export_wire_frames`) is the one artifact both sides see. A new
   assertion in `studio/src/test/wireContract.test.ts` pins
   `AGENTS` == the schema's agent enum. Chain:
   `registry.all_slugs()` ←parity→ `frames.py Literal` →export→
   `schema.json` ←vitest→ `AGENTS` → all FE types.
4. **Generated copies don't count as hand-kept.** The grep acceptance
   criterion is scoped to `*.ts`/`*.tsx`, excluding
   `wire-frames.schema.json`.

## Consequences / accepted limitations

- Schema freshness stays process-enforced (no BE test regenerates and
  compares). Self-healing in practice: a BE slug change without re-export
  makes the FE vitest fail as soon as `AGENTS` is updated.
- `agents/commands.py`'s per-agent dict and the per-agent injector modules are
  behavioral dispatch, owned by S1's `AgentAdapter` registry — out of scope
  here.
- Breaking a slug out of one BE Literal fails exactly that one parity
  assertion (not "4 assertions" as the original ticket claimed).

## Alternatives rejected

- Asserting `VALID_AGENTS` against a literal expected set (still tautology
  risk-theater once derived; adds a 4th place to edit when agents change).
- Keeping the shell's `DRAWER_AGENTS` copy for decoupling (the coupling
  concern targeted the coding module, not the transport lib).
- FE↔BE parity via a BE test reading the studio tree (fragile cross-tree
  path coupling; the committed schema already crosses the boundary).
