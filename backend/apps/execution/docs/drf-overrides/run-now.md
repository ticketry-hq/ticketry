# Run Now DRF override record

## Run Now

- DRF-native capability attempted: a serializer-backed detail action on the work-item execution ViewSet.
- Exact missing behavior: one synchronous command preflights a pinned destination policy, performs a guarded Ideas-to-Implement transition, and launches exactly one task run; a launch failure after the transition must report the committed state without rolling it back.
- Why a frontend adapter over the generated SDK is insufficient: eligibility, live-run exclusion, transition authorization, launch policy resolution, and the durable partial outcome are backend-owned invariants.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the request serializer validates caller origin, but cross-model workflow and launch invariants must apply to HTTP, MCP, and internal callers.
- Why `permission_classes` and `get_queryset` scoping are insufficient: the default API key protects the operation, while an optional Studio-signed run credential identifies only the caller run that may be excluded from the liveness check.
- Why a database constraint/default is insufficient: database constraints cannot preflight an external terminal runtime, suppress auto-start duplication, or represent a committed transition followed by a failed launch.
- Why an existing service function is insufficient: `apps.execution.run_now.execute` remains the orchestration authority; the custom action is still required to expose the non-CRUD command and its partial-outcome contract.
- Smallest custom seam: one POST detail action validates a named request serializer, reads the trusted optional caller identity from DRF authentication, calls the service once, and serializes the success result.
- Service module / `transaction.atomic` used: `apps.execution.run_now.execute`; workflow persistence remains atomic inside `worktracker.services.work_items.update_work_item`, while launching intentionally occurs after that commit.
- Protected fields excluded from the request schema: target id, destination state, launch configuration, committed state, run identity, and caller run identity are server-owned; callers may supply only `origin`.
- Identity/scope binding (URL kwarg + queryset filter): target identity comes only from `issue_id`; the service resolves an unarchived task and the signed credential can exclude only its cryptographically bound caller run.
- Contract-drift and regression test: Run Now API tests cover API-key authentication, signed-caller liveness, preflight-before-write, exactly-once auto-start suppression, origin gating, and committed-state launch failure; `test_openapi_contract.py` and `npm run contract:check` protect the generated refusal contract.
- Registry entry, if this is genuinely non-CRUD: `MODEL_ROUTES["RunNow"]` registers the POST command, implemented by `WorkItemExecutionDomainActionMixin.run_now`.
