# Strategy is authored code; the Executor is the reusable product

The orchestrator was heading toward strategy *packs*: data (prompts + manifest) validated against a phase grammar hardcoded in the engine (loader.py's REQUIRED_PHASES, reducer transitions, driver postconditions). We decided the opposite split, modeled on the freedom-agents project: coordination is **code the user writes** (a Strategy), and the module's product is a **reusable Executor** — the activity library, durability, and agent adapters that any Strategy runs on. The engine's current decompose→implement→verify flow becomes the first Strategy authored against the library, not a grammar the loader enforces. Chosen because new run styles were the whole point, and under the pack model every new style meant editing five engine files; under this model it means writing a new Strategy.

## Consequences

- loader.py's fixed phase grammar and pack validation dissolve; packs keep only prompts owned by their Strategy.
- Safety brakes that protect the machine (agent-count/depth budgets) stay in the Executor; run-shape rules (retry counts, verify gating, done semantics) move into Strategy code.
- Ticket #783's "strategy pack store" direction is superseded for the code half; the git-versioned store remains useful for prompts.
