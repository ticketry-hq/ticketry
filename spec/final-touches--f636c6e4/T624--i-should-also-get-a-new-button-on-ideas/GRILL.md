# CODING-624 — Grill outcome

Agreed requirements from the grill session. Every item below is a decision the
user made explicitly; the Spec stage should turn these into the implementation
specification, not re-open them.

## The capability

**Run Now** sends an idea straight into implementation, skipping Grill, Spec,
and Tickets. The name is deliberate: *Instant* already means the taskless
scratch run behind `i`, and the two must not be conflated.

## Surface

* A `Run now` button in the selected work item's Details status row, beside
  `▶ Run agent`, the state picker, and `Run subtree` / `Run serially`.
* Global keymap binding `r`. It is a no-op — no error, no toast — when the
  selected item is not an eligible idea.
* Shown when the item's current state is `Ideas` **and** its issue type permits
  a human `Ideas → Implement` transition. No new capability flag, checkbox, or
  workflow mutation: deleting the edge removes the button. Items in `Tickets`
  are unaffected.
* Rejected placements: a row-level hover action in the Stories pane, and a
  capture-and-run button beside the idea entry box.

## The seam

One backend endpoint plus an MCP `run_now(id_or_key)` tool, both over one
implementation. Studio does not compose the steps itself.

1. **Refuse on live work.** If the target already has a live agent run or
   terminal, return a structured refusal (409) and move nothing. Two agents in
   one checkout is the contention the Run serially work exists to prevent.
2. **Pre-flight the knowable prerequisites** — module ancestry, selected
   profile, the `Implement` launch binding, its required skills. Any failure
   returns the existing structured error and leaves the Story in `Ideas`.
3. **Move `Ideas → Implement`** through the ordinary transition gate, stamping
   the caller's real origin. There is no privileged bypass: the gate stays the
   single authority on who may make the move.
4. **Launch a task-scoped run** using the configuration already resolved for the
   committed destination, the way the auto-start path pins destination policy.
   No caller-supplied prompt; the prompt is the `Implement` binding's.

The move must precede the launch, because a run's prompt comes from the item's
current-state binding — launching first would deliver the Ideas triage prompt.

**Partial failure.** A late launch failure (tmux down) leaves the Story in
`Implement` with no run, reported as such; the user retries with `▶ Run agent`.
There is no rollback: the Story workflow has no `Implement → Ideas` edge, and
writing one behind the gate's back was rejected.

**Provider.** Resolved silently from the `Implement` launch binding. No agent
picker, no modifier-click override; changing the provider is a workflow-settings
change.

**After success.** Studio activates that work item's terminal tab. The click
already relocates the row out of Ideas, so landing in the running agent is what
makes the outcome visible.

## Workflow changes (shipped)

| Edge | Change |
| --- | --- |
| `Ideas → Implement` | The staged migration `0043` flips `agent_allowed` from `False` to `True`; its name and its test change with it. |
| `Implement → Grill` | New, agent-allowed. The retreat for an idea that proves too big. |
| `Tickets → Implement` | Unchanged, human-only. |

Both edges ship in `reviewed_defaults.json` and in migrations, because the
button's eligibility rule depends on the `Ideas → Implement` edge existing — a
fresh project must get the feature without hand-configuration.

## Prompt changes

Two edits to `reviewed_defaults.json`, seeding new projects only. **No rewrite
migration and no equality guard**: the existing CODING project gets both by hand
in the state configuration panel. Launch bindings are seeded with
`get_or_create`, so this is a deliberate boundary, not an oversight.

* **`Story` / `Implement`** — if the Story has no Implementation children and the
  work is larger or more ambiguous than a small direct change, stop and move it
  to `Grill` rather than guessing.
* **`Story` / `Ideas`** — a third triage branch: small, unambiguous, and
  self-contained work calls `run_now`; missing decisions still route to `Grill`;
  sufficient context still routes to `Spec`. The branch must use `run_now`, never
  a bare state move, so no agent can leave an idea in `Implement` with nothing
  running.

## Documentation

Written during this grill, already in the tree:

* `backend/worktracker/docs/adr/0009-ideas-may-enter-implementation-without-refinement.md`
  — amends ADR 0003, which held that entering implementation is a human
  decision. Records why two doors into `Implement` carry deliberately different
  rules.
* `Run now` glossary entries in `backend/apps/execution/CONTEXT.md` and
  `studio/CONTEXT.md`.

## Testing obligations

* A numbered Studio acceptance case in `studio/src/test/*Acceptance.test.tsx`:
  the button appears only for an eligible idea, a click moves and launches and
  switches to the terminal, refusals surface to the user, and the button
  disappears when the transition is removed. Keep the overhaul gate current.
* Backend coverage of the seam: step ordering, each pre-flight refusal leaving
  state untouched, the live-run refusal, origin stamping, the partial-failure
  outcome, and both migrations.

## Out of scope

* Row-level hover actions and a capture-and-run control on the idea entry box.
* Provider selection at click time.
* Any change to `Run subtree` / `Run serially`.
* Rolling the state move back on launch failure.
* Opening `Tickets → Implement` to agents.
* A third origin value or any change to the transition permission model.
