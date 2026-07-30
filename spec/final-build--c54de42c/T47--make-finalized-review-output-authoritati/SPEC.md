# Make finalized review output authoritative for release defaults

**Work item:** CODING-47 (Story) — `d157f4e0-045c-4d9c-8234-13d41210be59`
**Module:** `final-build` — `c54de42c-02fc-4a57-8947-a65a312cebd5`

## Problem Statement

When a maintainer sits down at the Final Review Workbench and finalizes the
reviewed defaults, they reasonably believe they have decided what the next
Ticketry desktop build will ship. They have not.

Three separate copies of the same decisions exist today:

- The workbench's own hard-coded workflow graph and prompt matrix, which is
  what the workbench actually renders and what it actually publishes.
- The finalized defaults artifact the workbench writes.
- A hand-maintained transition table in the backend, which is what a fresh
  project's workflow rows are actually seeded from.

The reviewed prompts do flow through to a fresh installation. The reviewed
*workflow graph* does not — it is written into the artifact and then ignored,
because seeding reads the backend's own table instead. The three copies happen
to agree right now, purely by coincidence of hand-maintenance. Nothing detects
the moment they stop agreeing, and nothing stops a release from shipping while
they disagree.

The consequences a maintainer feels:

- Editing the workflow graph in the workbench appears to work and changes
  nothing about the shipped build.
- Editing the backend table changes the shipped build without appearing
  anywhere in the review the maintainer just signed off on.
- The artifact is bundled into the sidecar only incidentally, as a side effect
  of a wildcard package sweep — so "the build ships what I reviewed" is an
  accident, not a guarantee.
- A malformed, incomplete, or internally inconsistent artifact produces an
  installer anyway, and the damage only surfaces on a user's first launch.

## Solution

One tracked **finalized defaults artifact** becomes the single source of truth
for the reviewed AGENTS guidance, the per-issue-type/per-state prompt matrix,
the canonical state vocabulary, and the workflow graph (start states and
transition edges).

Everything else becomes a consumer of it:

- The **workbench** loads the artifact and renders it. Its hard-coded state
  list, issue-type list, workflow graph, and prompt strings are deleted. What
  the maintainer sees is what is tracked; there is no second copy to drift.
- **Finalizing** validates the assembled artifact *fully, before writing
  anything*. A rejected finalize leaves every file on disk untouched and
  reports precisely what is wrong. AGENTS.md remains a derived output written
  from the artifact's guidance field.
- **Workflow seeding** derives its templates from the artifact. The
  hand-maintained transition table stops being authored by hand.
- **Prompt seeding** stays on the artifact, as today.
- The **release build** re-validates the artifact as a declared release input,
  before it runs any build command, and refuses to produce an installer if the
  artifact is missing, malformed, incomplete, or internally inconsistent.
- The **sidecar** bundles the artifact through an explicit, asserted packaging
  entry rather than a wildcard sweep.

A clean installation still ships no database. On first launch the sidecar
creates its SQLite state database from migrations, and on project creation the
project's issue types, start states, transition edges, and launch bindings are
materialized from the bundled artifact. After that the rows are project-owned
and editable, and editing the artifact never reaches back into a running
installation.

## User Stories

1. As a maintainer finalizing a review, I want the workflow graph I see in the
   workbench to be the graph that is actually tracked, so that reviewing it
   means something.
2. As a maintainer finalizing a review, I want my edits to the workflow graph
   to reach a fresh installation, so that the workbench is an authority rather
   than a display.
3. As a maintainer finalizing a review, I want the prompt matrix I see to be
   read from the tracked artifact rather than from a copy compiled into the
   workbench, so that the workbench cannot show me stale prompts.
4. As a maintainer finalizing a review, I want a finalize that fails validation
   to leave every file exactly as it was, so that a rejected finalize never
   leaves the repository half-written.
5. As a maintainer finalizing a review, I want the rejection message to name
   the specific offending issue type, state, or edge, so that I can fix it
   without guessing.
6. As a maintainer finalizing a review, I want AGENTS.md to be written from the
   artifact's guidance field, so that the repository guidance and the reviewed
   guidance cannot diverge.
7. As a maintainer, I want a single documented file to be named as the source of
   truth by the workbench, the backend seed path, and the release
   documentation, so that a newcomer cannot mistake a consumer for the source.
8. As a maintainer, I want the hand-maintained backend transition table to stop
   being hand-maintained, so that there is no second place to edit the workflow
   graph.
9. As a release engineer, I want the release build to refuse to run when the
   artifact file is absent, so that a missing artifact is caught before any
   build work happens.
10. As a release engineer, I want the release build to refuse to run when the
    artifact is not parseable JSON, so that a corrupted artifact never reaches
    an installer.
11. As a release engineer, I want the release build to refuse to run when the
    artifact declares an unsupported schema version, so that an artifact from a
    future or obsolete shape is never silently reinterpreted.
12. As a release engineer, I want the release build to refuse to run when a
    prompt cell is missing or empty for any canonical issue type and state, so
    that no installation can launch an agent with no guidance.
13. As a release engineer, I want the release build to refuse to run when a
    declared start state is not one of the canonical states, so that a fresh
    project cannot be created into a state that does not exist.
14. As a release engineer, I want the release build to refuse to run when a
    transition edge names an endpoint that is not a canonical state, so that
    seeding cannot silently skip a whole issue type's graph.
15. As a release engineer, I want the release build to refuse to run when the
    same transition edge appears twice, so that the artifact stays a clean
    representation of the graph.
16. As a release engineer, I want the release build to refuse to run when a
    terminal state has outgoing edges or a state is unreachable from its type's
    start state, so that a structurally broken graph is caught at review time
    rather than by a confused user.
17. As a release engineer, I want the artifact declared as a release input in
    the release manifest, so that the set of things a release depends on is
    enumerated in one place.
18. As a release engineer, I want the sidecar packaging recipe to bundle the
    artifact by an explicit entry, so that bundling does not depend on a
    wildcard sweep that a future refactor could quietly remove.
19. As a release engineer, I want a test that fails if the packaged sidecar
    would not contain the artifact, so that "the build ships what I reviewed"
    is enforced rather than assumed.
20. As a release engineer, I want no database bundled into the installer, so
    that no user's data provenance is ambiguous and no stale rows ship.
21. As a person installing Ticketry for the first time, I want my first launch
    to create a state database from migrations alone, so that my installation
    starts from a known-clean schema.
22. As a person installing Ticketry for the first time, I want my first project
    to have exactly the issue types the reviewed artifact declares, so that the
    product behaves as it was reviewed.
23. As a person installing Ticketry for the first time, I want each issue type
    to start in the reviewed start state, so that a new Story lands in Idea, a
    new PathFind in Refinement, and a new Implementation in Implement.
24. As a person installing Ticketry for the first time, I want exactly the
    reviewed transition edges to be available and no others, so that the board
    offers the moves that were reviewed.
25. As a person installing Ticketry for the first time, I want every issue
    type and state combination to have the reviewed launch prompt, so that
    launching an agent from any cell of the board gives it the reviewed
    guidance.
26. As a person using Ticketry, I want my edits to a workflow transition or a
    launch prompt to be mine and to persist, so that the reviewed values are
    starting points rather than enforced policy.
27. As a person using Ticketry, I want a later edit to the artifact in the
    repository to have no effect on my already-running installation, so that
    my configuration is stable and not remotely mutable.
28. As a person upgrading an existing Ticketry installation, I want my
    customized prompts and workflow configuration left alone, so that
    upgrading never silently discards my configuration.
29. As an engineer reading the backend seed code, I want it to name the artifact
    as its input, so that I do not go looking for a table to edit.
30. As an engineer reading the review workbench README, I want it to name the
    artifact as the source of truth and the seed path as a consumer, so that
    the documented direction of authority matches the code.
31. As an engineer reading the release operations documentation, I want the
    artifact validation gate documented as part of the release procedure, so
    that a failed release build is diagnosable from the docs.
32. As an engineer changing the canonical state or issue-type vocabulary, I want
    a test that fails when the artifact's vocabulary and the backend's canonical
    vocabulary disagree, so that a partial vocabulary change is caught.
33. As an engineer, I want a test that fails when AGENTS.md and the artifact's
    guidance field disagree, so that a hand-edit to AGENTS.md is caught rather
    than silently lost at the next finalize.
34. As an engineer running the test suite, I want fresh-project materialization
    asserted against the artifact rather than against duplicated expected
    values, so that the tests cannot drift from the artifact either.

## Implementation Decisions

### The artifact and its ownership

- The existing tracked finalized defaults artifact under the `worktracker`
  package remains the artifact, at its current path. It is not moved; moving it
  would churn packaging, imports, and docs for no benefit.
- It is the **single source of truth**. Its provenance block, which today points
  outward at the backend modules the content was lifted *from*, is replaced by a
  self-declaration naming the artifact itself as authoritative and listing its
  consumers. The direction of the arrow inverts.
- The workbench's local scratch copy of the finalized output is eliminated. The
  workbench reads and writes the tracked artifact and nothing else, so there is
  exactly one file to reason about.
- The artifact's schema version is bumped. Validation accepts exactly the new
  version and rejects anything else, including the current version, so a
  half-migrated artifact cannot be consumed.

### Artifact shape

The artifact carries five blocks:

- **Guidance** — the AGENTS.md body, as a non-empty string.
- **State vocabulary** — the canonical states in canonical order, each with its
  name, board group, and colour. This block exists so the workbench has no
  reason to hold its own copy.
- **Issue types** — the canonical task-level issue types in canonical order.
- **Prompt matrix** — a prompt for every issue type and every state.
- **Workflow graph** — per issue type: a start state, the states that type
  participates in, and a list of directed transition edges as ordered pairs.

Edges are ordered pairs rather than a source-keyed map. The pair form is what
the workbench already publishes and what a graph validator naturally consumes;
the backend adapts it at the seam described below.

State *seeding* continues to run from the backend's existing canonical state
definitions — the artifact's state vocabulary is used for rendering and for
validation cross-checks, not to drive state creation. This keeps state seeding
out of the blast radius while still deleting the workbench's duplicate.

### Validation

- One validator module, written in JavaScript, is the sole definition of the
  rules. It is consumed by the workbench's finalize handler and by the release
  build. There is no second implementation.
- Rules enforced: supported schema version; no unknown top-level keys; a
  well-formed finalization timestamp; non-empty guidance; the exact canonical
  state vocabulary with complete group and colour data; the exact canonical
  issue-type set; a non-empty prompt for every issue type and state pair; each
  type's start state present in the canonical vocabulary and in that type's own
  state set; every edge endpoint present in the canonical vocabulary and in
  that type's state set; no duplicate edges; no self-edges; no outgoing edges
  from a terminal state; every state in a type's set reachable from its start
  state.
- Every rejection carries a message naming the offending type, state, or edge.
  Validation reports all failures it can, not just the first, so a maintainer
  fixing an artifact does not iterate one error at a time.

### Enforcement points

Validation runs at exactly two gates, both before anything irreversible:

- **Before write, at finalize.** The workbench's finalize handler validates the
  complete assembled artifact before opening any file. On rejection it responds
  with an unprocessable-entity status and the accumulated messages, and neither
  the artifact nor AGENTS.md is touched. On acceptance both are written
  atomically via the existing temp-file-and-rename approach.
- **Before build, at release.** The release build's existing release-input
  validation step gains an artifact check: read the declared artifact, parse it,
  and run the validator. A failure raises a release-input error before any
  frontend, sidecar, or bundle command runs, with a distinct error type so the
  failure is attributable in logs and in tests.

There is deliberately **no** backend-side validator. The artifact cannot reach a
packaged sidecar without passing both gates, so a runtime check would be dead
weight that could itself drift.

### Backend consumption

- The workflow-seed module keeps its module path and its exported template
  symbol — historical data migrations and the settings prompt-migration path
  import it, and preserving the symbol keeps their blast radius at zero. Its
  body changes from a hand-authored literal to a derivation from the artifact,
  adapting the artifact's edge pairs into the source-keyed shape the existing
  seed helper consumes.
- The launch-seed module continues to read the artifact's prompt matrix, as
  today. Its legacy single-prompt-per-state projection is retained for older
  callers.
- The seed helpers that materialize issue types, start states, transition edges,
  and launch bindings are unchanged in behaviour. They already create-if-absent
  and never replace an existing row.
- Because the artifact's workflow content and the current hand-maintained table
  are byte-for-byte equivalent in meaning today, this derivation is a no-op for
  existing installations and for historical migration replay. That equivalence
  is asserted by test as part of the change, so the no-op claim is proven rather
  than assumed.

### Upgrade behaviour

- Fresh installations are the case that matters. **No upgrade data migration is
  authored.**
- The upgrade policy is stated explicitly and tested: seeding is purely
  additive. Rows absent from an installation are created; rows already present
  are left exactly as they are, whether or not the user edited them. No
  customization marker is introduced and no schema field is added.
- Nothing in the running system re-reads the artifact after a project's rows are
  materialized, so editing the artifact cannot mutate a live installation.

### Packaging and release inputs

- The release manifest declares the artifact as a sidecar input alongside the
  existing migration directories and dependency-policy entries, so the release's
  dependency set is enumerated in one place.
- The sidecar packaging recipe gains an explicit data entry for the artifact,
  replacing reliance on the wildcard package sweep that bundles it today by
  accident. The sweep stays for everything else; the artifact's inclusion becomes
  intentional and independently asserted.
- No database is produced or bundled at packaging time. This is unchanged and is
  asserted so it stays true.

### Workbench

- The hard-coded state list, issue-type list, workflow graph, and prompt strings
  are deleted from the workbench application.
- On load, the workbench fetches the tracked artifact and renders every view —
  prompt matrix, guidance, and workflow graph — from it. The workflow view
  therefore shows the tracked graph rather than a compiled-in replica.
- The workbench README is rewritten to name the artifact as the source of truth
  and the backend seed modules as consumers.

## Testing Decisions

A good test here asserts externally observable behaviour — what a fresh
installation's database contains, what the finalize endpoint does to the
filesystem, whether the release build refuses to proceed — and never reaches
into a helper's internals. Critically, **expected values are read from the
artifact rather than duplicated in the test**, so the tests cannot become a
fourth copy of the decisions.

Five seams, all of them existing seams:

1. **Project creation** (backend, pytest) — the highest available seam for
   fresh-install materialization. Create a project against a migrated empty
   database through the project-create service, then assert that the resulting
   issue types, per-type start states, transition edges, and launch bindings
   match the artifact exactly, including that no edge exists that the artifact
   does not declare. Prior art: the existing workflow and workflow-API tests,
   which already drive the seed path over a real project; and the existing
   launch-binding seed tests.
2. **The validator function** (JavaScript, node test runner) — a fixture-driven
   table. One valid artifact passes. One mutation per rule is rejected with a
   message naming the offender: bad schema version, unknown key, empty
   guidance, missing prompt cell, empty prompt cell, unknown start state,
   unknown edge endpoint, duplicate edge, self-edge, outgoing edge from a
   terminal state, unreachable state, wrong issue-type set, wrong state
   vocabulary. Prior art: the release manifest validation tests, which are
   already exactly this shape.
3. **The finalize endpoint** (JavaScript, node test runner) — drive the real
   handler over HTTP against a temporary directory. An invalid payload returns
   unprocessable-entity and leaves both the artifact and AGENTS.md byte-identical
   to their prior contents. A valid payload writes both, and the written AGENTS.md
   equals the payload's guidance field. Prior art: the existing workbench server
   tests, which already exercise the handler this way.
4. **Release input validation** (JavaScript, node test runner) — call the
   existing release-input validation entry point with the artifact absent,
   unparseable, and invalid-but-parseable, and assert it raises before any build
   command is attempted. Assert the packaging recipe declares the artifact
   explicitly. Prior art: the existing release-build tests.
5. **Vocabulary and derivation conformance** (backend, pytest) — assert the
   artifact's state vocabulary and issue-type set equal the backend's canonical
   definitions; assert the derived workflow templates are equivalent to the
   graph the artifact declares; assert the committed AGENTS.md equals the
   artifact's guidance field. These are the drift alarms that fire when someone
   changes one side of a pair.

Additionally, the existing workbench render test is extended to assert the
workbench renders from fetched artifact data rather than a compiled-in constant.

Test commands, unchanged: backend tests via pytest from the backend package;
workbench and release-build tests via the node test runner through their
existing package scripts.

## Out of Scope

- **Any upgrade data migration.** Existing installations are explicitly out of
  scope beyond the guarantee that nothing overwrites their rows.
- **A customization marker** on workflow or launch-binding rows, and any
  overwrite-untouched-rows behaviour it would enable.
- **A backend-side runtime validator.** Validation lives at the write gate and
  the build gate only.
- **Driving state creation from the artifact.** State seeding stays on the
  backend's canonical state definitions.
- **Changing any reviewed value.** The prompts, guidance, start states, and
  edges shipped after this change are the ones shipped today. This is a
  consolidation and enforcement change, not a content change.
- **Making the workbench workflow view editable.** It becomes faithful to the
  artifact; whether a maintainer can mutate the graph from the UI is a separate
  decision.
- **Bundling a pre-populated database**, in any form.
- **Non-macOS release targets** and anything about signing, notarization, or
  publication.

## Further Notes

- The three copies agreeing today is the reason this is safe to do as a
  mechanical consolidation. That equivalence should be asserted early, in the
  same slice that introduces the derivation, so any later slice that changes
  content does so visibly.
- The workbench currently writes two files that must agree — its own scratch
  copy and the tracked artifact. Eliminating the scratch copy removes a failure
  mode where a partial write leaves them inconsistent, in addition to satisfying
  the one-artifact requirement.
- The wildcard package sweep in the packaging recipe means the artifact is
  bundled today. The explicit entry is therefore not a bug fix but a durability
  measure: it converts an accident into a contract, and the accompanying test is
  what actually earns the acceptance criterion.
- Bumping the schema version is what forces every consumer to be updated in the
  same change. An artifact at the old version being rejected by the new
  validator is the intended behaviour, not a regression.
