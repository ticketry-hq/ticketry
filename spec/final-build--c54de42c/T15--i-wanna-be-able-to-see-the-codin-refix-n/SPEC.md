# CODING-15 — Show three-letter project prefixes on ticket rows

Status: Refined
Story: WorkTracker #15 (`b196ec85-bc62-41f1-9666-5f7ffc20698f`)
Date: 2026-07-29

## Problem Statement

Every work item in Ticketry has one canonical, addressable ticket key formed
from its project key and its sequence number — `CODING-15`. That key is what a
user types into search, pastes into a commit message, reads off a branch name,
and says out loud to another person.

The ticket tree does not show it. A row displays only the bare sequence number
(`15 · Show three-letter project prefixes`), so the identifier the user sees in
the application never matches the identifier the rest of their workflow uses.
Searching the tree for `CODING-15` finds nothing. A terminal tab bound to that
ticket is labelled `#15 · claude`, and after a reload it degrades further to
just `claude`, losing the ticket association entirely.

Separately, project keys have never been constrained. Any string up to 64
characters is accepted in any case, which is why the installation has
accumulated keys of three, four, five, and six characters. The Add Project
form compounds this: its key field is styled to render uppercase, so a user
typing `cdn` is shown `CDN` while `cdn` is what gets submitted and stored.

## Solution

A ticket row shows its full canonical key in place of the bare number, and tree
search matches that key as well as the title and the bare number, so what the
user reads is what the user can search for. Terminal tabs and their close
affordances name the ticket by the same key, and keep naming it correctly after
a reload.

Newly created projects must use a key of exactly three letters, A–Z. Lowercase
input is accepted and normalised to uppercase rather than rejected, so the
uppercase the form displays is the uppercase that gets stored. The default key
offered for a new installation becomes a valid three-letter key.

Existing projects are not touched. A project key is immutable because it forms
every addressable ticket key, every key-derived link, and every persisted
reference to a work item; renaming one would invalidate all of them. The
installation therefore continues to serve its existing keys of varying length,
and the three-letter rule constrains only what is created from now on. This is
an accepted, permanent inconsistency: a `CODING-15` row and a `CDN-4` row will
appear side by side.

## User Stories

1. As a Ticketry user, I want each ticket row to show its full canonical key, so
   that the identifier I see matches the one I use everywhere else.
2. As a Ticketry user, I want the key rendered as a single token, so that I can
   read and copy it without reassembling it from parts.
3. As a Ticketry user, I want the key to keep the workflow-state colour the
   number already had, so that at-a-glance state scanning is unchanged.
4. As a Ticketry user, I want an Implementation subtask row to show its key too,
   so that every level of the tree is addressable the same way.
5. As a Ticketry user, I want the row to keep truncating cleanly when the title
   is long, so that the longer identifier does not break the layout.
6. As a Ticketry user, I want the ephemeral scratch row to keep rendering, so
   that a row with no ticket behind it does not show a broken key.
7. As a Ticketry user, I want to paste a full key such as `CDN-15` into tree
   search and find that ticket, so that I can jump straight from a commit
   message or branch name to the work item.
8. As a Ticketry user, I want key search to ignore case, so that `cdn-15` and
   `CDN-15` both find the ticket.
9. As a Ticketry user, I want to keep searching by bare number, so that typing
   `15` works exactly as it does today.
10. As a Ticketry user, I want to keep searching by title, so that the added key
    matching takes nothing away.
11. As a Ticketry user, I want a search that matches a subtask to still reveal
    its parent branch, so that key search behaves like existing search.
12. As a Ticketry user, I want a terminal tab bound to a ticket to be labelled
    with that ticket's key, so that I can tell which ticket a session belongs to
    when several are open.
13. As a Ticketry user, I want the close affordance for a terminal to name the
    same key, so that I do not close the wrong session.
14. As a Ticketry user, I want a terminal tab reattached after a reload to still
    name its ticket, so that restored sessions are as identifiable as fresh
    ones.
15. As a Ticketry user, I want a scratch, planning, or instant session to keep
    its existing label, so that sessions with no ticket are unaffected.
16. As a Ticketry user creating a project, I want the key field to accept
    exactly three letters, so that new keys are short and uniform.
17. As a Ticketry user creating a project, I want lowercase input accepted and
    stored uppercase, so that the form's uppercase display is truthful.
18. As a Ticketry user creating a project, I want a key that is too long, too
    short, or contains digits or symbols to be refused with a message telling me
    the rule, so that I can correct it immediately.
19. As a Ticketry user creating a project, I want the key field to stop me at
    three characters, so that I discover the limit before submitting.
20. As a Ticketry user creating a project, I want the form to stay editable with
    my input intact when the key is refused, so that I do not retype the name.
21. As a Ticketry user creating a project, I want a key that collides with an
    existing project after normalisation to be reported as a duplicate, so that
    `cdn` cannot slip past a check that `CDN` is already taken.
22. As a new Ticketry user, I want onboarding to offer a valid three-letter
    default key, so that accepting the default succeeds.
23. As a new Ticketry user, I want onboarding to explain the key rule, so that
    replacing the default does not fail on first attempt.
24. As a user of a fresh installation, I want startup to create the default
    project successfully, so that I reach a usable workspace.
25. As a user of an established installation, I want startup to keep resolving
    my existing project, so that changing the default does not silently create a
    second empty project alongside it.
26. As a Ticketry user with an existing long project key, I want my tickets to
    keep their current keys, so that my links, branches, and references stay
    valid.
27. As a Ticketry user, I want project keys to remain immutable, so that a
    ticket key can never change under a reference that already points at it.
28. As an API consumer, I want the project-create contract to reject an invalid
    key at the boundary, so that no client can write a non-conforming key.
29. As an API consumer, I want the published API description to remain
    byte-stable, so that this change does not force a client regeneration.

## Implementation Decisions

### Rendering the key

- The canonical key is already computed and served by the backend work-item
  read model as `{project key}-{sequence number}`. The frontend read model
  currently discards it during response mapping. The fix is to carry the
  existing server-computed field through to the frontend work-item summary
  rather than recomposing the key client-side from the selected project.
- Recomposing client-side was rejected: it duplicates a computation the server
  already performs, and it silently renders the wrong prefix for any row that
  does not belong to the currently selected project.
- The key field on the frontend work-item summary is **optional**. The
  synthetic scratch row and any previously cached summary carry no key, and
  those cases fall back to the bare sequence number.
- The key replaces the number inside the row's **existing** identifier token —
  the same single element, the same workflow-state colour, no additional markup
  and no second style. A muted-prefix treatment was considered and rejected in
  favour of the simpler single-token render.
- The row's existing truncation behaviour is unchanged and absorbs the extra
  width.
- Only one row component exists, shared by story rows and Implementation
  subtask rows, so both are covered by the same change. Module rows are not in
  this tree — the tree is scoped to a single module — so no cross-project row
  can appear and no per-row-type handling is required.

### Search

- The tree's match predicate gains a case-insensitive test against the full
  key, in addition to the existing title and bare-sequence-number tests. All
  three are retained, so searching by number continues to behave as it does
  today.
- This mirrors an existing predicate in the parent-picker field, which already
  matches on key, title, and bare number. That prior art is the pattern to
  follow rather than a new one to invent.
- Branch-revealing behaviour for a matched descendant is unchanged; only the
  leaf predicate is extended.

### Terminal labels

- The label helper takes the ticket key as an **optional argument** and prefers
  it, falling back to the existing `#number` form and then to the agent name.
- The key is resolved at the helper's call sites, which already render in a
  context holding live work-item data. It is deliberately **not** added to the
  in-memory session metadata record.
- This choice also repairs a pre-existing defect at no extra cost. Session
  metadata is reconstructed on reload from the server's persisted-session read
  model, which carries no sequence number, so the restore paths set it to null
  and restored tabs currently show only the agent name. Because the key is now
  resolved from live work-item data at render time instead of read off session
  metadata, restored tabs label correctly.
- Consequently there is **no** change to the terminals persistence schema, the
  persisted-session read model, or the terminals application's boundary. The
  terminals application continues to treat work-item, module, and project
  identifiers as opaque strings and imports nothing from the work-tracking
  application. No migration is required.

### Project key rule

- The rule is: exactly three characters, each in `A`–`Z`.
- Enforcement lives at the **HTTP boundary**, on the project-create request
  schema. Every user-facing creation path — the Add Project modal, onboarding,
  and startup resolution — reaches the backend over HTTP and is therefore
  covered.
- Enforcement was deliberately **not** placed in the project-creation service:
  the service is also called by the internal current-project resolution path,
  and validating there would couple the rule to that bootstrap. It was also
  not placed as a model-level validator, which would not run on direct
  creation and would retroactively invalidate the eight existing
  non-conforming rows on any future save.
- The validator is **imperative, not a declarative pattern constraint**. Two
  reasons: normalisation cannot be expressed as a pattern, and the published
  API description is a checked-in artefact guarded by a byte-determinism test,
  which an imperative validator leaves untouched.
- Normalisation happens **before** the uniqueness check, so `cdn` is uppercased
  to `CDN` and then correctly reported as a duplicate of an existing `CDN`. The
  duplicate message reports the normalised key.
- The rejection message states the rule in full, naming both the length and the
  allowed characters.
- Both creation forms gain a client-side length cap and an inline statement of
  the rule, so the user learns the constraint without a server round trip. The
  existing uppercase styling on the key field is retained — it is now truthful,
  because the backend normalises to match it.
- Project keys remain **immutable**. The project-update contract continues to
  omit the key field.

### Default project key

- Changing the default is a **consequence** of the rule, not an independent
  choice: both current defaults submit a six-character key over HTTP and would
  now be rejected. Onboarding would fail for a user who accepts the default,
  and fresh-installation startup would fail outright, because its recovery path
  re-looks-up the same key it failed to create and then raises.
- The default key becomes `CDN`, in the onboarding form default, the startup
  resolution path, and the backend's current-project constant. The onboarding
  project *name* default is unchanged.
- Startup resolution **prefers an existing project**: it resolves the new
  default key, falls back to a project carrying the legacy key, and creates the
  new default only when neither exists. Without this fallback an established
  installation would silently grow a second, empty project beside the one it
  has been using.

### Accepted consequences

- Project keys will permanently vary in length across the installation. The
  three-letter rule constrains creation only; it does not make existing keys
  uniform, and it cannot without breaking addressability.
- `CDN` collides with a well-known unrelated industry term. This was raised and
  the name was confirmed as the intended default.

## Testing Decisions

A good test here asserts what a user or an API consumer can observe: the text
rendered on a row, what a search query does or does not match, the label on a
tab, the status code and message returned for a submitted key, and which
project startup ends up using. It does not assert which component computed a
value, the shape of an internal record, or that a particular helper was called.
Prefer extending an existing test seam over introducing a new one, and test
from the highest seam that can observe the behaviour.

Six behaviours are covered by five seams. All but one are existing seams.

- **Project key rule** — tested at the project-create HTTP endpoint, using the
  established request-client and JSON-post helpers already shared by the
  work-tracking API tests. This is a new test module, because no
  project-endpoint test module exists yet. Cases: a valid three-letter key
  accepted; lowercase input accepted and stored uppercase; too short, too long,
  and non-alphabetic keys each rejected with the rule stated; and a
  lowercase key colliding with an existing uppercase project reported as a
  duplicate.
  The existing service-level project tests are **not** the seam for the rule —
  the rule does not live in the service, so asserting it there would assert
  nothing. Those tests are updated only where their fixtures collide with the
  changed default-key constant.
- **Row rendering and key search** — both tested from the existing tree-pane
  search test, which already renders the whole pane with the real tree hook and
  the real search input. One seam covers both behaviours because the pane owns
  the row and the search box. Testing the row component or the tree hook in
  isolation would be a strictly lower seam for no additional coverage.
- **Add Project modal key feedback** — tested from the existing projects-pane
  test, which already opens the modal, submits through the live store, and
  asserts that a rejected key leaves the form editable with its input intact.
- **Onboarding default and inline rule** — tested from the existing onboarding
  welcome test, which already asserts the default value of the key field and
  the surfacing of a server-side rejection.
- **Startup project resolution** — tested from the existing bootstrap-gate
  test, which already covers resolving a missing default project through the
  creation flow. Extended to cover the new default, and the fallback to an
  existing legacy-key project instead of creating a second one.
- **Terminal tab labels** — tested from the existing workspace tab-navigation
  test, which already renders tabs from session metadata. Covers the
  key-labelled tab, the close affordance, the restored-after-reload tab, and
  the unchanged scratch and planning labels.

No isolated seam is added for the label helper or the tree match predicate;
both are observable from the seams above. No isolated seam is added for the
default-key constant; it is exercised through the endpoint tests.

The published API description's byte-determinism test must continue to pass
unchanged, which is a direct check on the decision to validate imperatively.

## Out of Scope

- Renaming or migrating any existing project key, and therefore any
  collision-resolution strategy, redirect strategy, or handling of stale
  key-derived links and persisted references.
- Making the project key mutable, or exposing it on the project-update
  contract.
- Making existing project keys uniform in length. Only creation is
  constrained.
- Persisting a ticket key on the terminal-session record or adding one to the
  persisted-session read model; no terminals migration or schema change.
- Adding the ticket key to the session-metadata record in the frontend.
- Any change to the row's colour scheme, spacing, truncation rule, or
  identifier styling beyond the token's text.
- Changing how the branch-revealing search walk works; only the leaf match
  predicate changes.
- Reserved-word or profanity screening of project keys beyond the
  three-letters rule.
- Backfilling ticket keys into terminal-session history, agent run records, or
  worktree and branch names.

## Further Notes

The "prefix" in the original request is the existing immutable project key, and
the full canonical key it forms is **already computed and served** by the
backend. The display half of this story is therefore plumbing: the value is
dropped during frontend response mapping and simply needs to be carried
through. No new derivation, no new API, and no new data.

The three-letter rule delivers less than it appears to. Eight of the ten
existing project keys violate it and cannot be corrected without breaking
addressability. The rule constrains future keys only, and the visible outcome
is a permanent mix of key lengths rather than uniform prefixes. This was
raised during refinement and accepted deliberately.

The uppercase-styling mismatch on the key field is a live defect today, not a
hypothetical introduced by this work: the field renders uppercase but submits
whatever was typed, so lowercase keys can already be created. Server-side
normalisation closes it.

Restored terminal tabs losing their ticket association after a reload is also a
pre-existing defect. It is fixed here incidentally, because resolving the key
from live work-item data at render time sidesteps the session-metadata record
that was dropping the value.
