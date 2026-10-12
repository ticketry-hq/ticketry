# CODING-2728: Declared mutation cache effects

## Problem Statement

Every Studio write is hand-assembled from the same steps. A feature author who adds or changes a mutation has to:

- send it through Apollo or through the runtime writer;
- build an optimistic response under the right root field;
- work out which lists became stale and re-read them;
- remove deleted identities from the cache;
- record local convergence so the status stream does not echo the write back;
- map GraphQL failures into the REST-shaped errors the UI expects;
- manage pending, error and callback state.

Each copy makes these choices slightly differently, and the differences show up as defects:

- **Post-write refreshes can be stale.** A refresh after a write can attach to a read that was already in flight from before the write. Apollo then adopts the pre-write ranks or membership, and the user sees a move or create "undo itself" until something else refreshes.
- **Writes that miss the cache leave screens stale.** Project and workflow writes bypass the Apollo cache entirely. Their screens only converge because hand-written follow-up reads happen to exist; if a read is missing, a list stays stale.
- **Copies drift apart.** Some writes refresh every affected module, some refresh one, and some refresh none. Some report a refresh that failed after the write committed as a separate phase; others report it as a failed write.
- **Each new mutation repeats the work.** The next mutation costs another copy of all of this. Nothing in the repository tells the author which copy is the right one to imitate.

The capability guide lists "Mutation cache effects" as *Proposed* under this Story. Until it is delivered, authors are told to follow the current hand-written pattern.

## Solution

Provide one shared Studio module for declared mutations. A feature declares a mutation with:

- its generated GraphQL document;
- how to build variables from the caller's arguments;
- which returned entity is authoritative;
- its cache effects:
  - which queries (with exact variables) become stale;
  - which identities are removed;
  - how list membership or order changes;
  - an optional domain-specific optimistic transform;
  - what to record once the write has committed.

The shared module runs the mutation through the one Apollo client and handles the rest:

- applies and rolls back the optimistic layer;
- normalizes the authoritative entity;
- applies membership changes and evictions;
- refreshes every declared query without joining an in-flight pre-write request;
- keeps the write phase separate from the refresh phase;
- maps failures into the established UI error contract;
- exposes pending, error and callback state to React callers.

Work-item, project and workflow writes all move onto this module in this Story. Project and workflow writes stop bypassing Apollo, but they still reach the same GraphQL transport. Their duplicated orchestration is deleted. After this Story, a new ordinary mutation needs only its generated document and a short effects declaration, and the capability guide lists the module as *Supported now*.

User-visible behavior does not change except where today's behavior is a defect, for example a stale refresh or an unrefreshed list.

## User Stories

1. As a feature author, I want to declare a mutation as its generated document plus an effects declaration, so that I don't hand-write optimistic, refresh, eviction and convergence orchestration.
2. As a feature author, I want the declaration to be typed against the generated document's variables and result, so that a wrong root field or variable fails type-checking.
3. As a feature author, I want to name the authoritative returned entity once, so that every caller gets the same normalized record and domain mapping.
4. As a feature author, I want to declare the queries a write makes stale, with exact variables, so that every list showing the changed record converges.
5. As a feature author, I want stale queries to be computable from both the caller's arguments and the authoritative result, so that a cross-module move refreshes both the source module and the destination module returned by the server.
6. As a feature author, I want to declare identities to remove, so that a delete removes the correct cache row without my writing eviction and garbage collection by hand.
7. As a feature author, I want to declare a membership or ordering change separately from a re-read, so that a create appears in its list immediately and a reorder settles to server ranks.
8. As a feature author, I want to supply a domain-specific optimistic transform (rank-between, transition, synthetic blocker edges, created-row shape), so that the shared module stays generic and the domain rules stay in my feature.
9. As a feature author, I want to declare a post-commit hook, so that local convergence bookkeeping runs exactly once per committed write.
10. As a feature author, I want to declare diagnostics phases, so that story-move diagnostics keep reporting requested, mutation-succeeded, refresh-succeeded and failed events with the failing phase.
11. As a feature author, I want a React hook that exposes pending, variables, error, success, `mutate` and `mutateAsync` with `onSuccess`/`onError`/`onSettled` callbacks, so that I don't re-implement mutation state per feature.
12. As a feature author, I want concurrent calls of one hook to keep it pending until every call settles, so that a fast second call cannot clear the pending state of a slow first one.
13. As a feature author, I want an imperative entry point with the same effects, so that non-React callers (stores, launch flows, other features) share the same behavior.
14. As a feature author adding the next ordinary mutation, I want the capability guide to point me to the module and a worked example, so that I copy the supported path instead of an old hand-written one.
15. As a Studio user, I want a moved, created, reparented, deleted or reordered work item to show in its final position in every visible list, so that I never see the stale pre-write order snap back.
16. As a Studio user, I want lists I am not currently looking at to be correct when I open them, so that switching modules does not show stale membership.
17. As a Studio user, I want a created work item to appear once, so that the optimistic row and the server row never show together.
18. As a Studio user, I want a deleted work item to disappear from every list and not reappear, so that delete feels final.
19. As a Studio user, I want a reorder that rebalances neighbours to show every sibling's new position, so that list order matches the server.
20. As a Studio user, I want a failed write to roll back its optimistic change, so that the screen does not claim a change that did not happen.
21. As a Studio user, I want a write that committed but whose refresh failed to keep the committed result, report the refresh failure honestly, and never re-send the write, so that I don't get duplicate creates or double moves.
22. As a Studio user, I want an older server response never to overwrite a newer cached work item, so that racing responses cannot regress a state or field.
23. As a Studio user, I want my own committed write not echoed back as an external change by the status stream, so that edits do not flicker or raise false "changed elsewhere" signals.
24. As a Studio user, I want project create, rename and delete to update the project list and project view through the same cache, so that the switcher and the open project agree.
25. As a Studio user, I want onboarding acknowledgement to keep working exactly as it does now, so that first-run flows do not regress.
26. As a Studio user, I want module reorder to keep its optimistic movement, its retry when neighbours changed elsewhere, and its error toast, so that dragging modules behaves as it does now.
27. As a Studio user editing workflows, I want issue-type and state create, update, delete and reorder to show immediately and survive reloads, so that the workflow editor and the rest of Studio agree.
28. As a Studio user editing a workflow, I want a revision conflict to keep showing "Workflow changed elsewhere. Latest settings loaded." with the latest settings, so that concurrent edits are handled honestly.
29. As a Studio user editing launch bindings, I want omitted fields to stay omitted and cleared fields to stay cleared, so that partial edits never erase a configured prompt or profile.
30. As a Studio user, I want error messages, error statuses and conflict handling unchanged, so that every screen that branches on 404, 409, 422 or 503 behaves as before.
31. As a Studio user on desktop or in browser development, I want writes to reach the same GraphQL transport as before, so that no runtime gains or loses a write path.
32. As a reviewer, I want each migrated mutation's declaration to be short and read like its effects, so that I can check list convergence by reading it.
33. As a reviewer, I want the old orchestration deleted rather than left beside the new module, so that there is one way to write.
34. As a reviewer, I want tests to exercise the real Apollo cache against a scripted transport, so that the tests prove cache behavior rather than call patterns.
35. As a maintainer, I want Apollo to remain the only owner of server and client state, so that this Story adds no second snapshot of server data.
36. As a maintainer, I want the shared module split into small, purpose-named files under shared Apollo plumbing, so that it follows the repository's structure rules.
37. As a maintainer, I want `reuse:check`, typecheck, architecture lint, build and the numbered overhaul gate to pass, so that delivery meets the repository gates.

## Implementation Decisions

### Reuse record (answers the CLAUDE.md "Reuse before writing code" questions)

| Question | Answer | Existing example |
| --- | --- | --- |
| Which existing module or framework can do this? | Apollo Client's `mutate` (optimistic responses, optimistic layers, the `update` callback, `refetchQueries` / `query` with the `queryDeduplication` context, `evict`/`gc`) and the one Studio Apollo client with its error, revision-guard and transport links. | The current work-item transport's optimistic, update and evict usage; the project read transport's `queryDeduplication: false` option; the module-reorder optimistic layer. |
| What can be configuration or generated code? | Documents, variables and result types come from the generated GraphQL documents (`npm run graphql:generate`). Each mutation's effects are a declaration (data), not code. | Generated `*.documents` modules in each feature. |
| What genuinely new behavior must we implement? | A small executor that applies a declaration with defined phase semantics (write, then effects, then refresh). It turns off request deduplication for refreshes, keeps refresh failures separate from write failures, applies the error contract once, and provides one React state hook. | None; this is the capability the guide currently lists as Proposed. |

### Shared module

- **Placement and files.** One new shared module in Studio's shared Apollo plumbing, because it is cross-feature infrastructure with no domain knowledge. Split it into purpose-named files:
  - the declaration types;
  - the executor;
  - post-write refresh;
  - the React mutation-state hook;
  - the failure-mapping entry.
  
  Keep each file well under the repository's 300–400 line guidance.
- **Declaration shape.** A declared mutation has:
  - the generated document;
  - a variables builder from caller arguments;
  - the authoritative-result selector (root field) and an optional domain mapping;
  - an optional optimistic builder that receives the current cached entity and the arguments, and returns the optimistic result or nothing;
  - an optional cache-membership update applied with the authoritative result;
  - identities to evict;
  - a refresh list of `{ query, variables }` computed from arguments and the authoritative result;
  - an optional post-commit hook;
  - optional diagnostics hooks keyed by phase.
  
  Declarations are owned by the feature that owns the document. The shared module knows nothing about work items, projects or workflows.
- **Phase semantics.** These are part of the contract and must be tested:
  1. **Write.** Send the mutation with its optimistic response. If it fails, Apollo discards the optimistic layer, the failure is mapped and reported as a write failure, and nothing else runs.
  2. **Commit effects.** Once the write commits, normalize the authoritative entity, apply the membership update, apply evictions (with garbage collection after a delete), and run the post-commit hook. These run exactly once.
  3. **Refresh.** Re-read every declared query, deduplicated by query and variables, using network-only reads with request deduplication off. A post-write read must never join a read that started before the write.
  
  If a refresh fails, the committed entity stays in the cache, the failure is reported with a refresh phase, and the mutation is never re-sent. As today, the caller's promise rejects when a refresh fails, and the error carries the phase so callers and diagnostics can tell "your change saved but the view could not refresh" from "your change failed".
- **Inactive lists.** A declared refresh re-reads its query whether or not a component is currently watching it. This covers the exact module variables of a source or destination that is not on screen. Refreshes do not rely on Apollo finding active queries from a document alone.
- **Error contract.** The executor applies the existing GraphQL-to-`ApiError` mapping (FoundationGraphQlError code → 404/400/409/403/401/503/422 with the code and detail in the body) once, for every declared mutation. The two duplicated per-feature wrappers are deleted.
- **Transport.** All declared mutations go through the one Studio Apollo client. Its transport link uses the same runtime GraphQL transport proxy that the runtime writer uses today, so desktop (Tauri `graphql_execute`) and browser development (the Rust adapter) keep exactly one write path each. The runtime contract's `writeWorkTracker` route is kept for any remaining non-migrated caller. Once no Studio caller uses it for WorkTracker writes, remove it only if nothing else depends on it.
- **Mutation-state hook.** Lift the current work-item hook's behavior unchanged:
  - pending count across concurrent calls;
  - last variables;
  - error and success;
  - `mutate` (swallows the rejection) and `mutateAsync` (rethrows);
  - `onSuccess`/`onError`/`onSettled` callbacks;
  - optimistic construction from the optimistic cached entity when the feature supplies a reader.

### Existing guards and state owners (reused, not duplicated)

- The issue revision guard link keeps sole authority over rejecting older `WorktrackerIssue` rows. The executor adds no revision comparison of its own.
- Work-item local convergence (record on commit, consume on stream echo) stays in the work-items feature and is called from that feature's post-commit hooks.
- Story-move diagnostics stay in the work-items feature. The executor exposes phase hooks so transition and reorder keep their exact event names, payloads and failing phase (`mutation` / `module-refresh`).
- Apollo's InMemoryCache stays the only state owner. Declarations write cache rows; they never return or retain a separate snapshot.

### Work-items migration

- Re-express all seven work-item writes as declarations: create, update details (name, description, type), transition, reparent, set blockers, reorder and delete. Keep their public entry points and signatures so existing callers keep working. These include the project store's create, the ticket details delete, and sprint epic entry.
- **Create.** The membership update appends the authoritative row to the exact module list and strips the optimistic row, so the item appears once. It refreshes that module.
- **Reparent.** Refresh the caller's memberships plus the module returned by the server (the destination of a cross-module move), each once.
- **Reorder.** Refresh the exact module list so every rebalanced sibling rank converges. Keep the domain optimistic transform: rank-between from module-list ranks, skip on duplicate neighbour ranks, record optimistic failure.
- **Transition and set blockers.** Refresh the item's module. Keep the optimistic transition and synthetic blocker edges as feature-owned transforms.
- **Delete.** Evict the compacted `WorktrackerIssue` identity, garbage-collect, and refresh the declared modules.
- Delete the old helpers: the shared refresh helper, the affected-module helper and every inlined refresh copy.
- Sprint planning (the plan mutation with its per-id write claim) can stay as it is. Migrating it is optional and must not drop the claim guard.

### Projects migration

- Move create, update and delete project, and onboarding acknowledgement, from the runtime writer to declared Apollo mutations. Onboarding acknowledgement stays the quarantined domain operation it is now.
- **Refreshes.**
  - Create and delete refresh the projects list.
  - Update refreshes the projects list and that project's open query.
  - Delete also evicts the project identity, garbage-collects, and refreshes the projects list.
  - Onboarding acknowledgement refreshes whatever onboarding read it currently affects. Spec-to-tickets must confirm the exact read from the onboarding flow and must not invent new behavior.
- Move module-presentation reorder onto the same executor and hook. Keep its behaviour:
  - the optimistic project-open order;
  - its own pending signal, now coming from the shared hook state;
  - the "before/after are not ordered neighbors" re-plan-and-retry against an authoritative non-deduplicated read;
  - the error toast.
  
  The retry is an explicit second mutation with a new plan, not a replay of a committed write.

### Workflows migration

- Move every workflow write onto declared Apollo mutations:
  - issue types: create, update, delete, reorder;
  - states: create, update, delete, reorder;
  - per-type workflow writes: start state, add, remove and update transition, remove state from workflow, launch-binding upsert, auto-start, subtree run.
- Per-type writes keep sending the caller's `workflow_revision`. A stale revision still arrives as a 409 `ApiError`, and the workflow editor's existing conflict path still reloads the latest settings and shows the same notice.
- **Launch-binding upsert** keeps its feature-owned variable builder. It resolves provider, model and reasoning from the workflow catalog, rejects unknown catalog entries with the same messages, and preserves omitted versus cleared for prompt, required skills, stage skills and profile (tickets #1372 and #1824).
- **Delete state** keeps ignoring the `reassignTo` argument, exactly as it does today.
- **Refreshes.** Each declaration names the reads its write makes stale:
  - the project open query (the workflow catalog);
  - the per-type workflow settings read for the affected type;
  - for state deletion, the reads the editor reloads today (states, all workflow settings, project items for counts).
  
  The workflow editor store's post-write reloads become declared refreshes. The store still sequences its UI state (action, notice, control errors, project-switch guard) around the call.
- The workflow editor store must not gain any new copy of server data. Its existing mirrored fields stay where they are unless the migration has to touch them. Removing them is out of scope (see below).

### Documentation

- In the capability guide, change the "Mutation cache effects" row to *Supported now*. Name the shared module and declaration as the approved path, `npm run graphql:generate` as the generator, and a migrated ordinary mutation (for example work-item rename or project update) as the closest working example.
- Remove CODING-2728 from the reuse gate's "candidate future rules" comment if a blocking rule is added. Otherwise leave it with a note that the replacement is now Supported now.
- Add a feature-map document for frontend mutations and list it in the feature-map index. It covers what the module does, its entry points, how to declare a mutation, and how it is tested. The three feature-map documents named in the Story (ticket details, stories list, workflows and issue types) do not exist; do not invent them for this Story.

## Testing Decisions

### What a good test is here

A good test drives only public behavior and observes only externally visible results:

- the GraphQL operations and variables that reached the transport, in order;
- what the real Apollo cache returns for the affected queries, including ones no component is watching;
- the errors and error statuses callers receive;
- the diagnostics events recorded.

It does not assert private helper calls, Apollo method spies or internal call counts.

### Seam 1 (primary): the GraphQL transport

- Install a Studio runtime whose GraphQL transport proxy is a disposable scripted fixture. Keep the real Studio Apollo client, InMemoryCache, error link, revision-guard link and transport link.
- The fixture records each operation name and its variables. It can answer, fail, or hold a response until the test releases it, which simulates concurrent, stale and slow requests.
- Tests call each feature's public write entry points, mutation hooks and workflow-editor store actions.
- Prior art:
  - the WorkTracker write runtime acceptance test (overhaul-74), which builds a desktop runtime around a scripted `graphql_execute`;
  - the shared desktop GraphQL runtime test fixture, which records operations;
  - the existing work-item mutation, module-presentation transport and Apollo client, cache and revision-guard tests.
- Required scenarios:
  - **Inactive lists.** A write refreshes a module list no component is watching, and the cache afterwards holds the server's rows for those exact variables.
  - **Cross-module move.** Reparent refreshes the source and the returned destination module once each, and both lists end with the correct membership.
  - **Stale join.** A module read is held in flight, then a write commits. The post-write refresh is a new request, not the held one, and the cache ends with post-write data even if the held pre-write response arrives last.
  - **Concurrent and stale responses.** An older `WorktrackerIssue` revision arriving after a newer one does not overwrite it.
  - **Create.** No duplicate after the optimistic row resolves, and the created row is in the exact module list.
  - **Delete.** The correct compacted identity is evicted and stays gone after refresh.
  - **Reorder.** After rebalancing, every sibling's rank in the exact module list matches the server.
  - **Optimistic failure.** A write error rolls back the optimistic layer, rejects with the mapped `ApiError`, records the write-phase diagnostic, and sends no refresh.
  - **Committed-write refresh failure.** The authoritative entity stays in the cache, the rejection is identified as a refresh-phase failure, the diagnostic records the refresh phase, and the mutation was sent exactly once.
  - **Error contract.** Domain error codes reach callers as the same `ApiError` statuses as before. A workflow `stale_revision` drives the editor's conflict path and its notice.
  - **Projects and workflows on Apollo.** Project and workflow writes reach the same transport with the same payloads, and their declared reads are refreshed.
  - **Launch binding.** Upsert preserves omitted versus cleared fields and rejects unknown catalog entries with the same messages.

### Seam 2 (secondary): the shared module

- Directly test the shared executor and the mutation-state hook with test-only declarations built on existing generated documents. Use the same scripted transport fixture under a real Apollo client.
- These tests pin the generic contract on its own:
  - refresh deduplication by query and variables;
  - deduplication turned off for post-write reads;
  - phase ordering and phase-tagged failures;
  - no re-send after a refresh failure;
  - eviction with garbage collection;
  - the post-commit hook runs exactly once;
  - pending stays true across overlapping calls until every call settles;
  - `mutate` vs `mutateAsync` rejection behavior and callback order.
- One of these tests is the "next ordinary mutation" demonstration. It declares a new mutation using only a generated document and a short effects declaration, and shows that it gets every behavior above with no other code.

### Overhaul acceptance

- Update the WorkTracker write runtime acceptance (overhaul-74) to the declared path. It must still send the same operations through the desktop GraphQL contract, now including project and workflow writes through Apollo.
- Add one numbered overhaul acceptance test using the next free overhaul number at implementation time. It covers the user-visible convergence guarantees: cross-module move, inactive list, create without duplicate, delete, rebalancing reorder, and honest committed-write refresh failure.
- Re-run the existing overhaul acceptance tests that touch these paths:
  - module creation;
  - onboarding module;
  - launch-binding runtime;
  - workflow Codex profile;
  - module order;
  - launch configuration convergence;
  - instant tickets.

### Gates

- Run the focused mutation, convergence and cache tests.
- Run `npm run typecheck`, `npm run lint:architecture`, `npm run test --workspace @worktracker/studio`, `npm run build --workspace @worktracker/studio`, `npm run test:overhaul` and `npm run reuse:check`.
- The existing call-spy scoping test for the work-item transport is replaced by the transport-seam tests above. It is not kept alongside them.

## Out of Scope

- **No Rust or GraphQL contract changes.** This means no new or changed GraphQL operations, Seaography registrations, migrations or Rust crates. Writes keep using the existing restricted, model-shaped contracts and quarantined operations.
- **No workflow editor store rewrite.** Removing the workflow editor store's existing mirrored copies of issue types, states and workflow settings is out of scope. This Story must not add new copies, and it replaces the store's post-write reloads with declared refreshes only.
- **Other features' writes.** Mutations owned by agents, terminals, execution, settings, documents and sprints are not migrated here; they can adopt the module later. Sprint planning's plan mutation is optional, as described above.
- **No blocking reuse rule.** This Story does not add a blocking reuse-gate rule for mutation effects. The guide row becomes Supported now, so a later Story may add one.
- **No new product behavior.** Example: deleting a state does not start using `reassignTo`.
- **No invented feature-map documents.** The three documents the Story names (ticket details, stories list, workflows and issue types) do not exist and are not created here.

## Further Notes

- **Decision record.**
  - Ideas triage moved this Story to Spec on 2026-10-10.
  - On 2026-10-12 the user decided that project and workflow writes move onto Apollo in this Story rather than in a follow-up.
  - The user also chose two test seams: the transport seam, plus a seam on the shared module itself.
- **Transport parity.** Both runtimes route the runtime writer to the same function as WorkTracker reads, over the runtime GraphQL transport proxy. Apollo's transport link uses the same proxy. Moving project and workflow writes onto Apollo therefore changes cache participation and link-chain processing (error mapping, revision guard), not the wire path.
- **Behavior to preserve.**
  - Work-item reorder and transition currently reject when the post-commit refresh fails. That stays, but the rejection must now identify the refresh phase, and the write must not be replayed.
  - Module-presentation reorder's neighbour-mismatch retry is the one place that intentionally re-sends a reorder. It is a new mutation with a new plan built from an authoritative read, and it stays.
- **Precedent for avoiding stale joins.** The codebase already turns off request deduplication when it must not join a stale read: module loading after a reorder retry, and status-stream invalidation. The shared refresh makes that the default for every declared post-write read.
- **Sibling Stories.** The capability guide and reuse-gate comment list sibling Stories for typed MCP handlers (CODING-2726), generated frontend contracts (CODING-2727) and settings editor workflows (CODING-2729). Declarations should use generated documents directly so they line up with CODING-2727.
