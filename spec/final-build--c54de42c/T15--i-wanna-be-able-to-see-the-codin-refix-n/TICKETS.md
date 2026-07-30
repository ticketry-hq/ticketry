# CODING-15 — Tickets

Story: WorkTracker #15 (`b196ec85-bc62-41f1-9666-5f7ffc20698f`)
Spec: [SPEC.md](SPEC.md)
Date: 2026-07-29

Four Implementation subtasks, in dependency order. Two independent starting
points (01 and 02), each with one follower. No wide refactor — the blast radius
is one optional read-model field, so nothing needs expand–contract sequencing.

| # | Ticket | Work Item ID | Blocked by |
| --- | --- | --- | --- |
| 01 | Default project key becomes CDN, preferring an existing project | `d6f2d0c4-b31d-4530-90d0-d0a72bb4dee8` | — |
| 02 | Ticket rows show and search by the canonical key | `889f4832-e49a-443e-a3f6-dda7f4de5143` | — |
| 03 | New project keys must be exactly three letters | `e0447f84-1158-457b-ba1a-742b0612a06b` | 01 |
| 04 | Terminal tabs name their ticket by key | `b032132c-21df-4bbe-9859-8148e3879e33` | 02 |

```
01 ──▶ 03
02 ──▶ 04
```

## 01 — Default project key becomes CDN, preferring an existing project

**What to build:** A fresh installation creates its default project with a
valid three-letter key, `CDN`, and onboarding offers that key as its default.
An established installation that already has a project under the legacy
`CODING` key keeps resolving that project on startup, instead of silently
growing a second empty project beside the one it has been using. The default
project *name* is unchanged.

**Blocked by:** None — can start immediately.

**Why first:** this is a prefactor. It is harmless and green on its own, and it
must land before 03 — otherwise the rule immediately rejects onboarding's
default key and hard-fails fresh-install startup, whose recovery path
re-looks-up the same key it failed to create and then raises.

**Status:** ready-for-agent

- [ ] Onboarding's key field defaults to `CDN`; its name field default is unchanged.
- [ ] Startup project resolution resolves the `CDN` key first.
- [ ] With no `CDN` project but a legacy `CODING` one present, startup resolves the legacy project and creates nothing.
- [ ] With neither present, startup creates the default under `CDN` and reaches a usable workspace.
- [ ] The backend's current-project constant is `CDN`.
- [ ] Existing service-level project tests are updated only where fixtures collide with the changed constant.
- [ ] The existing bootstrap-gate seam covers both the create-`CDN` and prefer-existing-`CODING` paths.
- [ ] The existing onboarding welcome seam asserts the new default key.

## 02 — Ticket rows show and search by the canonical key

**What to build:** Every row in the ticket tree — story rows and Implementation
subtask rows alike — reads its full canonical key in place of the bare sequence
number, so `15 · title` becomes `CODING-15 · title`. Tree search then matches
that full key case-insensitively, so a key pasted from a commit message or
branch name finds its ticket, while title and bare-number search keep working
exactly as today.

**Blocked by:** None — can start immediately.

**Key constraints:** This is plumbing, not computation — the backend already
serves the canonical key and the frontend response mapping discards it. Carry
the server-computed value through; do **not** recompose it client-side from the
selected project. The frontend field is optional, falling back to the bare
number for the scratch row and older cached summaries. Render into the row's
**existing** identifier token — one element, same state colour, no new markup.
Follow the parent-picker field's existing key/title/number predicate as prior
art; only the leaf predicate changes.

**Status:** ready-for-agent

- [ ] A story row renders its full canonical key followed by its title.
- [ ] An Implementation subtask row renders its key the same way.
- [ ] The key is one token carrying the workflow-state colour the number had.
- [ ] A keyless summary (the scratch row) renders the bare number, not a malformed key.
- [ ] A long title still truncates cleanly.
- [ ] Full-key search finds the ticket, case-insensitively.
- [ ] Bare-number search still works, unchanged.
- [ ] Title search still works, unchanged.
- [ ] A search matching a subtask still reveals its parent branch.
- [ ] Both behaviours covered from the existing tree-pane search seam; no isolated row or hook seam added.

## 03 — New project keys must be exactly three letters

**What to build:** Creating a project accepts a key of exactly three
characters, each in `A`–`Z`. Lowercase input is accepted and normalised to
uppercase, not rejected. Anything else is refused with a message stating the
rule in full. Both creation surfaces cap the field at three characters and
state the rule inline. Normalisation happens before the uniqueness check, so a
lowercase key colliding with an existing project is correctly reported as a
duplicate. Existing project keys are untouched and remain immutable.

**Blocked by:** 01 — until the defaults are valid three-letter keys, this rule
rejects onboarding's default and hard-fails fresh-install startup.

**Key constraints:** Validate on the project-create request schema at the
**HTTP boundary** — not in the creation service (also called by internal
current-project resolution) and not as a model validator (wouldn't run on
direct creation, and would retroactively invalidate existing non-conforming
rows). Write the validator **imperatively**: normalisation can't be expressed
as a pattern, and the checked-in API description is guarded by a
byte-determinism test that an imperative validator leaves untouched.

**Status:** ready-for-agent

- [ ] A three-letter uppercase key is accepted as given.
- [ ] A three-letter lowercase key is accepted and stored uppercase.
- [ ] Too-short, too-long, and non-alphabetic keys are each refused with the rule stated.
- [ ] A lowercase key colliding with an existing uppercase project is reported as a duplicate, naming the normalised key.
- [ ] Both creation forms cap the key field at three characters and state the rule inline.
- [ ] A refused key leaves the form editable with input intact.
- [ ] The key field's uppercase styling is retained.
- [ ] The project-update contract still omits the key.
- [ ] The API description's byte-determinism test passes unchanged.
- [ ] Covered by a new project-endpoint test module using the established request-client and JSON-post helpers; the rule is *not* asserted from the service-level project tests.
- [ ] Modal feedback covered from the existing projects-pane seam; onboarding feedback from the existing onboarding welcome seam.

## 04 — Terminal tabs name their ticket by key

**What to build:** A ticket-bound terminal tab, and its close affordance, name
the ticket by its full canonical key — `CDN-15 · claude` — so a user with
several sessions open can tell which ticket each belongs to. A tab reattached
after a reload names its ticket too, fixing a pre-existing defect where
restored tabs showed only the agent name. Scratch, planning, and instant
sessions keep their existing labels.

**Blocked by:** 02 — the key is resolved from live work-item data, which 02 is
what makes available.

**Key constraints:** The label helper takes the key as an optional argument,
resolved at its call sites from live work-item data. Do **not** add the key to
the session metadata record. Therefore no terminals migration, no persistence
schema change, and no persisted-session read-model change; the terminals
application keeps treating work-item identifiers as opaque strings.

**Status:** ready-for-agent

- [ ] A ticket-bound tab is labelled with the ticket's canonical key and its agent.
- [ ] The close affordance names the same key.
- [ ] A tab reattached after a reload names its ticket.
- [ ] Scratch, planning, and instant sessions keep their existing labels.
- [ ] An unresolvable key falls back to the bare `#number` form, then to the agent name.
- [ ] No terminals migration, schema change, or persisted-session read-model change.
- [ ] No key added to the session metadata record.
- [ ] Covered from the existing workspace tab-navigation seam; no isolated label-helper seam added.
