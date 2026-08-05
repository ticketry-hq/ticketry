---
status: accepted
---

# Model-shaped CRUD via DRF, domain RPC quarantined, and every route declared in a registry

The worktracker HTTP surface moves its CRUD half to Django REST Framework `ModelViewSet`s with `ModelSerializer`s derived from the models, its non-CRUD half into a named quarantine module, and gains a per-model registry of reads and writes with a test that fails if the live route table does not match it — including on any undeclared route. `django-ninja` stays for the 28 async handlers in `apps/*` (terminals, documents, runs, worktrees, execution) because those drive tmux, watchers and subprocesses; channels consumers already sit outside the API layer and are untouched. The route inventory that prompted this splits 44 operations roughly evenly: ~22 are model-shaped CRUD (work-items, states, issue-types, projects, modules, attachments) and ~21 are domain RPC (transitions, reorder, impact, workflow settings, launch bindings, capabilities, scope-context, workspace). Today every one of the 44 is an independently hand-authored view with a hand-authored schema, which is why one model has seven schemas (`WorkItemOut`, `WorkItemDetailOut`, `WorkItemPatch`, `WorkItemIn`, `ModuleWorkItemIn`, `WorkItemReorderIn`, `ScopeContextOut`) and why `attachments` has one write and **zero reads** — reading them is bundled into `getWorkItem`, so the only way to fetch attachments is to re-fetch a record the caller already holds. A nested router would have generated that read endpoint by default; the drift happened because every endpoint was a free-form choice. The argument for DRF is therefore its *default*, not its plumbing: a conventional CRUD core makes the ~21 exceptions countable and conspicuous rather than hidden among 44 equally-bespoke handlers. Separately and explicitly, **DRF alone would not have fixed the actual defect**, so the read contract is fixed too — one canonical collection read per scope, sub-collections on their own endpoints, hide-flags (`include_archived`, `include_pathfind`, `parent`) no longer varied by clients so they cannot form cache keys, and a stated pagination policy where none exists today. Those flags currently produce four list reads that are nested subsets of the same rows, which is what let a request-keyed client cache accumulate six copies of a work item and produce the rename bug in Studio. Both SDKs are regenerated and `surfaces/worktracker-agent` updated; this is a breaking change, accepted as such. We rejected DRF everywhere (it would convert 28 async handlers to sync) and rejected keeping ninja with a bespoke registry (cheaper, but the convention would be a house rule, and house rules are what did not hold) — though the registry and conformance test were kept from that option and are the durable artefact here, because they assert against the route table rather than the framework and therefore survive a framework or language change. That last point re-opened the Rust plan: `loco.rs` has no `ModelSerializer` analogue, registers free-form handlers, and idiomatically hand-writes response structs, so `WORKTRACKER_RUST_LLD.md` as designed would regress the property this ADR buys. Full reasoning: [`docs/decisions/2026-08-04-frontend-state-and-api-contract.md`](../../../../docs/decisions/2026-08-04-frontend-state-and-api-contract.md).

Computed serializer fields are admitted only when all three conditions hold:
the value is derived solely from the model row or one of its own relations, it
is read-only, and it is explicitly declared on the serializer. Work items use
that rule for `key`, `sub_issues_count`, `blocked_by_ids`, and `blocks_ids`.
Their `state` and `issue_type` relations serialize as bare primary keys.

The final quarantine contains exactly five writes: work-item reorder, state
reorder, issue-type reorder, remove-state-from-workflow, and onboarding
acknowledge. Remove-state remains exceptional because workflow membership is
reachability rather than a persisted row. Transition rows are ordinary CRUD;
their delete performs the existing workflow prune. Changing `start_state` is a
revision-guarded issue-type update with the same prune. The former composite
workflow-settings read is removed: issue-type, transition, and launch-binding
reads provide its rows, and clients derive standing warnings from those rows.

Every WorkTracker operation, including those five quarantined writes, is now a
DRF view. The old ninja router and its bespoke schema builder are deleted;
drf-spectacular is the sole source of `openapi.json`, both generated SDKs, and
the MCP client's generated surface. Ninja remains only for the deliberately
async application routes outside the WorkTracker mount.

The launch vocabulary is persisted in three catalog tables: `Provider`,
`Model`, and `ReasoningLevel`, with model-to-reasoning-level links. Launch
bindings store catalog foreign keys; a model determines its provider, and a
reasoning level must be linked to that model. Provider activation is a property
of the Provider row, deletion of referenced catalog rows is protected, and
free-text models are no longer part of the contract.

Two service changes are deliberate exceptions to the interface-only rewrite.
Deleting an occupied state is refused instead of silently reassigning its work
items. A graph-run header is reshaped as a work-item-scoped singleton resource:
create arms it, read returns it, and delete resets it, while its async handlers
remain outside DRF.
