# T655 — The tab tells you who is working, not which ticket

## Problem

Every terminal tab in a task workspace is labelled `T-655 · claude`. You are
already inside ticket #655 — the pane header, the details tab and the URL all
say so. The identifier is the one thing on the tab you never need, and it is
spending the widest part of the label.

What you actually want from a glance at the strip is *which agent is working*
and *what phase of the work each conversation belongs to*.

## Shape

### The label is the state the run launched in

A tab reads `Grill`, `Spec`, `Implement`, `Review` — the workflow state the
work item was in when that run spawned, frozen at launch. A run started in
Grill still reads Grill after you move the ticket to Spec; that divergence is
the point, because it is how you tell an old conversation from a new one.

- Scratch runs have no work item and so no state. They keep the words they
  already show — `plan` and `instant` — in the same slot. Lowercase marks them
  as not-a-workflow-state.
- Runs that predate this change render with no state word at all. See
  [ADR 0003](../../../backend/apps/terminals/docs/adr/0003-runs-snapshot-the-state-they-launched-in.md)
  for why they are not backfilled.
- When two *live* tabs collide on the same (provider, state) pair — and only
  then — they take trailing ordinals in launch order: `Grill 1`, `Grill 2`. A
  workspace with no collision shows no numerals.

### Colour is the provider, and only the provider

| Provider | Fill      | Contrast vs ink `#0a0a0a` |
| -------- | --------- | ------------------------- |
| claude   | `#D97757` | 6.34:1                    |
| codex    | `#E8E8E8` | 16.16:1                   |
| gemini   | `#4285F4` | 5.56:1                    |
| agy      | `#BB9AF7` | 8.56:1                    |

Four values is a set you learn once and never need a legend for. Ink is
near-black on every fill — white ink fails all four, worst of all on codex at
1.23:1, so the pairing is forced rather than chosen.

None of the four collides with the lifecycle palette already on screen
(`active #7dcfff`, `attention #e0af68`, `danger #f7768e`, `idle #7aa2f7`,
`success #9ece6a`). Green was rejected for `agy` on exactly this ground: it is
the turn-complete badge colour, so a green tab wearing a green badge would read
as one signal instead of two.

The model is **not** on the tab. Encoding it as a shade would multiply the
palette every time a model row is added in Settings, and shades of one hue are
not separable at 11px. It goes in the hover title:
`claude · opus-5 · started in Grill`.

### Selection inverts those same two colours

- **Selected** — provider colour fills the tab, text is near-black.
- **Unselected** — pane ground, text is the provider colour.

One tab is solid and the rest are outlines, which is the largest visual
difference two tabs can carry while still using only one colour between them.

Two properties make this the right shape rather than merely a nice one:

1. **It is contrast-neutral.** A contrast ratio is symmetric, so provider-as-ink
   measures exactly what provider-as-fill does. The table above holds in both
   states; nothing needs a second set of measurements.
2. **It frees the accent.** The earlier plan filled every tab and marked the
   selected one with `border-focus-accent` `#7aa2f7`. Measured against the fills
   it would sit on, that border is 1.42:1 on gemini blue and 1.22:1 on gemini
   purple — not a selection cue. Inverting removes the need for it, which
   matters because `#7aa2f7` still owns the keyboard-highlight ring, a genuinely
   separate axis from selection.

Only one tab is saturated at a time, which also keeps the strip quiet against
`pane.bg #0a0a0a`.

### Colour means the run is alive

`exited`, `lost` and `error` drop the provider colour entirely and go neutral
grey `#7a8599` — grey fill when selected, grey text when not. Keeping a
provider hue under the existing `opacity-60` fade lands around 3.4:1, below AA,
and produces a washed-out colour nobody can identify anyway.

This gives the strip a second readable rule at no extra cost: **colour means
still running, grey means done with.**

### The dormant chips follow

`terminalLabel()` feeds both the tab strip and the dormant history chip row.
Both get the same treatment. The chip row is arguably where it matters most,
since that is what you scan when deciding which conversation to reattach to,
and forking the function would leave two vocabularies in one workspace.

## Work

| Where       | What                                                      | File                                                     |
| ----------- | --------------------------------------------------------- | -------------------------------------------------------- |
| Migration   | Two nullable columns on the run — launch state, model      | `backend/apps/runs/models.py`                             |
| Launch      | Snapshot the issue's state and resolved model at spawn     | `backend/apps/terminals/launch_configuration.py`          |
| Projection  | Carry both onto the run record the status feed pushes      | `backend/apps/runs/api.py`, `backend/apps/runs/projections.py` |
| Label       | Return the state word instead of the identifier; ordinals  | `studio/src/app/shell/ticket-workspace/selected-ticket/internal/terminalLabel.ts` |
| Palette     | Four provider fills and their ink, as tokens               | `studio/tailwind.config.ts`                               |
| Tab         | Fill/ink inversion, grey-when-dead, hover title            | `studio/src/app/shell/ticket-workspace/selected-ticket/internal/WorkspaceTabStrip.tsx` |
| Chips       | Same treatment on the dormant row                          | `studio/src/app/shell/ticket-workspace/selected-ticket/internal/DormantWorkspaceTabs.tsx` |

## Acceptance

1. A tab launched while the ticket sat in Grill reads `Grill`, and still reads
   `Grill` after the ticket moves to Spec.
2. A tab's fill/text colour is determined by its provider alone, and is
   identical for two runs of the same provider in different states.
3. Exactly one tab in a strip is filled; it is the selected one. Selecting a
   different tab moves the fill.
4. An exited run shows neutral grey in both selected and unselected states, and
   no provider colour.
5. Two live claude runs launched in Grill read `Grill 1` and `Grill 2`; a lone
   claude run in Grill reads `Grill` with no numeral.
6. A scratch plan run reads `plan`; a run created before the migration reads
   with no state word and keeps its provider colour.
7. Hovering any agent tab reveals provider, model and launch state.
8. The dormant chip row uses the same words and colours as the tab strip.

## Out of scope

- Changing what the lifecycle badge shows or how it is derived. It stays a
  separate axis and keeps its own palette.
- Backfilling launch state for existing runs — unrecoverable, see ADR 0003.
- Surfacing the model anywhere other than the hover title.
