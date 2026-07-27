# T819 — Executor refactor: Strategy-as-fold, ManagedAgent/Sidecar atom, stateless reconcile

Design snapshot from the 2026-07-06 grilling session (CODIN-819).

- `SPEC-executor-refactor.md` — the binding spec: shape, Fact/Activity vocabulary, Executor invariants, what dissolves, migration order.
- `subtasks/` — tiny-model-executable briefs ST1–ST7 (CODIN-820…826, blocker-chained: ST1/ST2/ST3 parallel → ST4 → ST5 → ST6 → ST7) plus `INTERFACES.md`, the exact code surface as of 2026-07-06. Every brief starts with a STEP 0 symbol check because the tree is under active refactor.
- `ADR-0001..0004` — the decisions and their rejected alternatives.
- `ARCHITECTURE-REVIEW.html` — the friction map that started this (open in a browser; needs network for Tailwind/Mermaid CDNs).

**Canonical copies live module-local and evolve there**: `server/apps/orchestrator/docs/SPEC-executor-refactor.md`, `server/apps/orchestrator/docs/adr/`, vocabulary in `server/apps/orchestrator/CONTEXT.md` (map: repo-root `CONTEXT-MAP.md`). This directory is the point-in-time design record for the ticket; if they diverge, the module-local copies win.

Related tickets: CODIN-818 (overseer attacher, out of scope), #791 (question Facts), #788 (implement contract content), #814/#815/#816 (subsumed by reconcile), #783 (superseded for the code half).
