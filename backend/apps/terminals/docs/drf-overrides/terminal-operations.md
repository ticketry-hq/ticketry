# Terminal operation DRF override records

## Terminal collection list

- DRF-native capability attempted: `GenericViewSet.list` with a named query serializer and model-derived response serializer.
- Exact missing behavior: the active collection is reconciled against the selected runtime namespace and excludes doc-chat and shell scopes before scheduling background reconciliation.
- Why a frontend adapter over the generated SDK is insufficient: runtime ownership and reconciliation are sidecar facts.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the serializer validates `task_id` and exposes only immutable session fields; runtime reconciliation remains application behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: API-key authentication applies, but the collection combines durable rows with current runtime-namespace ownership.
- Why a database constraint/default is insufficient: tmux liveness and namespace ownership are external state.
- Why an existing service function is insufficient: `apps.terminals.api.list_terminals` is retained; the list override is only its DRF adapter.
- Smallest custom seam: `TerminalDomainActionMixin.list`.
- Service module / `transaction.atomic` used: terminal DAO reads and the reconciliation scheduler retain their existing boundaries; this read opens no new transaction.
- Protected fields excluded from the request schema: the query accepts only `task_id`; runtime names, lifecycle fields, and output state are never caller-writable.
- Identity/scope binding (URL kwarg + queryset filter): the required `task_id` query value binds the service-owned task scope.
- Contract-drift and regression test: terminal API list, runtime-namespace, immutable-field, authentication, and required-query tests plus `npm run contract:check`.
- Registry entry, if this is genuinely non-CRUD: not applicable; this is the resource collection's list operation.

## Terminal creation

- DRF-native capability attempted: `GenericViewSet.create` with a named command serializer and declared result serializer.
- Exact missing behavior: creation validates the established spawn contract, resolves launch configuration, creates a durable run, and starts its tmux runtime before returning the run identity.
- Why a frontend adapter over the generated SDK is insufficient: launch policy, persistence, compensation, and process creation are sidecar-owned.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: DRF owns the public command allowlist, while provider policy, work-item launch rules, and runtime failures apply to every caller.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies; creation does not mutate a caller-selected terminal row.
- Why a database constraint/default is insufficient: the operation coordinates database state with an external tmux process.
- Why an existing service function is insufficient: `apps.terminals.api.create_terminal` and the shared control plane are retained; the create override invokes them once.
- Smallest custom seam: `TerminalDomainActionMixin.create`.
- Service module / `transaction.atomic` used: `apps.terminals.control_plane.create_terminal_run` and durable-launch services retain persistence, compensation, and transaction behavior.
- Protected fields excluded from the request schema: run id, runtime name, timestamps, lifecycle, output state, and resolved launch metadata are server-owned.
- Identity/scope binding (URL kwarg + queryset filter): project, module, and optional task inputs cross the command serializer; domain services resolve their authoritative records and launch policy.
- Contract-drift and regression test: shared-control-plane, spawn-validation, structured-failure, required-skill, authentication, and serializer-allowlist tests plus `npm run contract:check`.
- Registry entry, if this is genuinely non-CRUD: not applicable; this is the terminal collection's create operation.

## Terminal termination and resume

- DRF-native capability attempted: serializer-backed collection actions on `TerminalViewSet`.
- Exact missing behavior: termination soft-deletes durable metadata while stopping a runtime; resume creates a new run from a terminated provider conversation and preserves predecessor identity and provider-specific refusal semantics.
- Why a frontend adapter over the generated SDK is insufficient: only the sidecar owns runtime termination, provider resume, and durable run state.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the query serializer binds `agent_run_id`; termination, resume eligibility, idempotency, and compensation are service behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: API-key authentication applies, but the target spans the run, terminal mirror, provider session, and runtime rather than one ordinary queryset update.
- Why a database constraint/default is insufficient: tmux and provider session state are external to the database.
- Why an existing service function is insufficient: `terminate_terminal` and `resume_terminal` are used directly; only their HTTP command adapters remain custom.
- Smallest custom seam: `TerminalDomainActionMixin.terminate` and `.resume`.
- Service module / `transaction.atomic` used: terminal launch/termination services own durable state and runtime compensation; the DRF actions add no transaction.
- Protected fields excluded from the request schema: the only caller input is the existing query-bound run identity; successor ids and termination state are server-owned.
- Identity/scope binding (URL kwarg + queryset filter): `agent_run_id` is required by `TerminalIdentityQuerySerializer` and resolved by the service against durable run/session state.
- Contract-drift and regression test: termination persistence/runtime tests, resume success/refusal tests, missing-identity tests, default-auth tests, and `npm run contract:check`.
- Registry entry, if this is genuinely non-CRUD: both routes are declared in `worktracker.registry.HOST_ROUTES` and implemented in `TerminalDomainActionMixin`.

## Resumable and scratch terminal projections

- DRF-native capability attempted: serializer-backed filtered list actions.
- Exact missing behavior: resumable history de-duplicates provider sessions, excludes live successors and unsupported scopes, and caps results; scratch listing filters active runtime-owned sentinel sessions by project and optional module.
- Why a frontend adapter over the generated SDK is insufficient: durable history, current run liveness, and runtime ownership are server facts.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: query serializers constrain scope and response serializers constrain visibility, but selection and reconciliation are domain behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies; both projections combine specialized filters and, for scratch, live runtime reconciliation.
- Why a database constraint/default is insufficient: live provider successors and runtime namespace ownership change independently of a request schema.
- Why an existing service function is insufficient: `list_resumable_terminals` and `list_scratch_terminals` are retained; custom actions only validate, invoke, and serialize.
- Smallest custom seam: `TerminalDomainActionMixin.resumable` and `.scratch`.
- Service module / `transaction.atomic` used: terminal API/DAO reads retain connection and reconciliation behavior; no new write transaction is introduced.
- Protected fields excluded from the request schema: callers may provide only task/project/module scope; provider ids, launch snapshots, lifecycle, and runtime metadata are read-only.
- Identity/scope binding (URL kwarg + queryset filter): named query serializers bind the accepted task or project/module scope before service filtering.
- Contract-drift and regression test: history de-duplication, ordering, live-successor, scratch-scope, runtime-namespace, authentication, required-query, and contract tests.
- Registry entry, if this is genuinely non-CRUD: both filtered list routes are declared in `worktracker.registry.HOST_ROUTES` and implemented in `TerminalDomainActionMixin`.

## Module shell collection

- DRF-native capability attempted: serializer-backed list and create actions on the owning terminal ViewSet.
- Exact missing behavior: shells are agentless durable runs rooted in configured module folders; creation coordinates run persistence and runtime launch, while listing restores live runtime-owned shells.
- Why a frontend adapter over the generated SDK is insufficient: module-folder resolution, run creation, and tmux state exist only in the sidecar.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: serializers bind the module and output fields; launch refusal, compensation, and reconciliation are service behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: API-key authentication applies, but live shell listing and creation are not ordinary row CRUD.
- Why a database constraint/default is insufficient: module filesystem validity and tmux creation are external state.
- Why an existing service function is insufficient: `create_module_shell` and `list_module_shells` are retained; the actions are their minimal DRF transport adapters.
- Smallest custom seam: `TerminalDomainActionMixin.list_shells` and `.create_shell`.
- Service module / `transaction.atomic` used: shell launch and durable-launch services retain persistence and compensation; listing uses the terminal DAO and reconciliation scheduler.
- Protected fields excluded from the request schema: creation accepts only `module_id`; run id, runtime identity, timestamps, and lifecycle are server-owned.
- Identity/scope binding (URL kwarg + queryset filter): the named body/query serializers require module identity, which the service resolves through selected-profile module links.
- Contract-drift and regression test: module shell creation, refusal, compensation, listing, restart, authentication, required-query, and contract tests.
- Registry entry, if this is genuinely non-CRUD: shell GET and POST are declared in `worktracker.registry.HOST_ROUTES` and implemented in `TerminalDomainActionMixin`.

## Viewer lease acquisition, renewal, release, and output observation

- DRF-native capability attempted: a `ModelSerializer`-backed lease create command plus named serializers for lease identity, release, and output-report actions.
- Exact missing behavior: lease acquisition is newest-viewer-wins arbitration serialized on the durable run; renewal detects replacement or expiry; release is holder-specific and idempotent; native output reporting invokes live screen observation without exposing screen contents.
- Why a frontend adapter over the generated SDK is insufficient: concurrent viewer authority and terminal-output observation must be decided by the shared sidecar control plane.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: serializers enforce caller-owned fields and transport choices, while locking, expiry, replacement, output capture, and publication are service behavior.
- Why `permission_classes` and `get_queryset` scoping are insufficient: default API-key authentication applies; acquisition locks the parent run before creating or replacing the singleton lease, and output is a runtime observation rather than row CRUD.
- Why a database constraint/default is insufficient: the one-to-one constraint prevents duplicate lease rows but cannot implement newest-viewer-wins replacement, TTL renewal, or output capture.
- Why an existing service function is insufficient: existing terminal API, viewer-lease, and output-activity services are retained; actions only validate, invoke, and serialize.
- Smallest custom seam: four serializer-backed methods on `TerminalDomainActionMixin`.
- Service module / `transaction.atomic` used: `apps.terminals.viewer_leases.acquire` and `.renew` use `transaction.atomic` with `select_for_update`; release uses a scoped delete; output observation retains its asynchronous capture/publication boundary.
- Protected fields excluded from the request schema: lease acquisition accepts only run id, viewer id, and transport; acquisition/expiry timestamps and replacement details are server-owned; output accepts only run id.
- Identity/scope binding (URL kwarg + queryset filter): request serializers bind run/viewer identity; the lease service locks and resolves the durable parent run and scopes renew/release to both ids.
- Contract-drift and regression test: serializer allowlist, invalid transport, default authentication, concurrent acquisition, replacement, renewal/release, native-output behavior, and `npm run contract:check`.
- Registry entry, if this is genuinely non-CRUD: all four routes are declared in `worktracker.registry.HOST_ROUTES` and implemented in `TerminalDomainActionMixin`.
