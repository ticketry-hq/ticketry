# ADR-0001 (T810): Shims dual-import `_reporter`; the contract suite imports specs as package modules and proves standalone mode via subprocess

Date: 2026-07-05 · Status: Accepted (grill session, CODIN-810 refinement)

## Context

The four hook scripts run in two import modes with incompatible resolution
rules:

1. **Standalone** — the injectors bake `python /abs/path/<agent>_hook.py` into
   the agent CLI's hook config; `sys.path[0]` is `hooks/`, so a bare
   `import _reporter` resolves.
2. **Package import** — the test suite does
   `from apps.terminals.agents.hooks import claude_hook`; there a bare
   `import _reporter` raises `ModuleNotFoundError` because `hooks/` is not on
   `sys.path`.

The original ticket text only argued mode 1 ("sibling import is OK because the
script's dir is sys.path[0]"), which would have broken the contract suite.

## Decision

- Every shim binds the shared driver with a **dual import**:
  `try: from . import _reporter` / `except ImportError: import _reporter`.
  The relative form serves package imports; the fallback serves standalone
  execution (where the shim has no package). Both forms respect the
  stdlib-only / no-`apps.` constraint.
- `test_hook_contract.py` imports each shim's `SPEC` (and `_reporter`'s pure
  functions) as normal package modules for unit-level rows.
- **Standalone mode is proven, not assumed**: one parametrized
  subprocess row per agent runs `sys.executable <script path>` with garbage
  stdin and asserts exit code 0 **and empty stdout** (Gemini and agy parse
  hook stdout as JSON — stray output would be treated as a hook decision).
  This is the only test that exercises the `except ImportError` branch and the
  injector-baked entry mode.

## Alternatives rejected

- **Subprocess-only testing**: every payload assertion would need a captured
  local HTTP server; slow and awkward for the ~30 mapping rows.
- **importlib `spec_from_file_location` loading**: keeps shims single-import
  but moves path plumbing into the test suite and still doesn't exercise the
  real standalone entry.
