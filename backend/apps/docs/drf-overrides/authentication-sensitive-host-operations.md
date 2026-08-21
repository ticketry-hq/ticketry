# Authentication-sensitive host operation DRF overrides

## Lifecycle event ingress

- DRF-native capability attempted: a serializer-backed action on the owning run ViewSet with a DRF `BaseAuthentication` implementation.
- Exact missing behavior: provider hook subprocesses do not possess the desktop API key; each request instead carries a Studio-signed Bearer credential bound to one run, and the body `agent_run_id` must match that authenticated identity. Development mode intentionally bypasses this check when `WORKTRACKER_DISABLE_AUTH` is set.
- Why a frontend adapter over the generated SDK is insufficient: lifecycle callers are launched hook subprocesses, not Studio frontend callers, and authentication must be enforced before state mutation.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: request fields cannot authenticate the signed Authorization header or establish a trusted caller identity.
- Why `permission_classes` and `get_queryset` scoping are insufficient: the operation is event ingress rather than row lookup; a custom authentication class must verify the signed credential before the action compares it with the validated body.
- Why a database constraint/default is insufficient: the credential is request-scoped and cryptographically signed; no persisted field can establish caller possession.
- Why an existing service function is insufficient: `ingest_lifecycle_event` owns persistence and publication, but authentication belongs at the HTTP boundary.
- Smallest custom seam: `LifecycleRunScopedAuthentication` returns a run principal (or the established development bypass principal); the action validates a named serializer, compares authenticated and submitted run ids, delegates once, and validates the service response through `LifecycleAcceptedSerializer`.
- Service module / `transaction.atomic` used: `apps.runs.api.ingest_lifecycle_event`; persistence remains in the runs DAO/service path.
- Protected fields excluded from the request schema: only the established lifecycle envelope is accepted; receive timestamps and persisted lifecycle projections are server-owned.
- Identity/scope binding (URL kwarg + queryset filter): the signed principal's `agent_run_id` is required to equal the serializer-validated `agent_run_id` when authentication is enabled.
- Contract-drift and regression test: `npm run contract:check`; unchanged lifecycle API tests cover missing, foreign, and matching run credentials plus persistence and response shape.
- Registry entry, if this is genuinely non-CRUD: `RunLifecycleActionMixin.lifecycle_events` in `apps/runs/domain_ops.py`; lifecycle ingress is an event command, not model CRUD.

## Terminal self-termination

- DRF-native capability attempted: a serializer-backed action on the owning terminal ViewSet with `RunScopedAuthentication` and `IsAuthenticated`.
- Exact missing behavior: the zero-body command must derive the only terminable run id from a Studio-signed Bearer credential and must never accept a run id from caller-controlled body or query data.
- Why a frontend adapter over the generated SDK is insufficient: the caller is the running agent process and authorization must be enforced by the sidecar.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: there is deliberately no identity field in the request body.
- Why `permission_classes` and `get_queryset` scoping are insufficient: `IsAuthenticated` can require a principal, but the custom authentication class must verify and bind the run identity.
- Why a database constraint/default is insufficient: signed credential possession is a per-request fact.
- Why an existing service function is insufficient: the terminal service owns idempotency, runtime termination, and unknown-run handling, while DRF authentication must establish its trusted input.
- Smallest custom seam: `RunScopedAuthentication` verifies the Authorization header; the action passes only `request.user.agent_run_id` to the terminal service and serializes the result.
- Service module / `transaction.atomic` used: `apps.terminals.api.self_terminate_terminal`; existing terminal/runtime transaction behavior is unchanged.
- Protected fields excluded from the request schema: the request has no body and exposes no caller-selectable run id.
- Identity/scope binding (URL kwarg + queryset filter): identity is exclusively the signed run principal; the service confirms the run exists and terminates only that run.
- Contract-drift and regression test: `npm run contract:check`; unchanged terminal tests cover malformed credentials, unknown runs, idempotency, resumed-run isolation, and runtime effects.
- Registry entry, if this is genuinely non-CRUD: `TerminalDomainActionMixin.self_terminate` in `apps/terminals/domain_ops.py`; self-termination is a run command.

## Public document asset read

- DRF-native capability attempted: a detail action on the owning document ViewSet with explicit `AllowAny` and no authentication classes.
- Exact missing behavior: webview HTML, Markdown, image, and SVG subresource loads cannot attach the desktop API-key header and require raw binary responses with the resolved media type, no-store/nosniff headers, and an optional ETag.
- Why a frontend adapter over the generated SDK is insufficient: browsers resolve nested document subresources themselves, outside SDK request hooks.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: the successful response is bytes rather than a JSON representation.
- Why `permission_classes` and `get_queryset` scoping are insufficient: public access is deliberate, while containment, registration, symlink, and extension checks require filesystem-aware service validation.
- Why a database constraint/default is insufficient: safe resolution depends on the current filesystem target and its resolved containment beneath the registered root.
- Why an existing service function is insufficient: `read_document_asset` establishes the safe bytes/media result, but the HTTP adapter must apply binary content type and security/cache headers.
- Smallest custom seam: a public document action delegates once to the service and returns a raw `HttpResponse` with only the established headers; the binary response remains explicitly declared to drf-spectacular.
- Service module / `transaction.atomic` used: `apps.documents.api.read_document_asset`; read-only, so no transaction is required.
- Protected fields excluded from the request schema: there is no request body; only `doc_id` and `asset_path` URL identity are accepted.
- Identity/scope binding (URL kwarg + queryset filter): `doc_id` selects a registered document and `asset_path` is resolved within its registered root; traversal, symlink escape, missing rows, and disallowed extensions uniformly return 404.
- Contract-drift and regression test: `npm run contract:check`; unchanged document tests cover public loading, media types, headers, ETag, traversal, symlinks, unknown documents, and extension allowlisting.
- Registry entry, if this is genuinely non-CRUD: `DocumentDomainActionMixin.asset` in `apps/documents/domain_ops.py`; binary subresource delivery is not model CRUD.

## Public health probe

- DRF-native capability attempted: a serializer-backed action on a system ViewSet with explicit `AllowAny` and no authentication classes.
- Exact missing behavior: the desktop supervisor must determine sidecar liveness before it can obtain or use the desktop API credential.
- Why a frontend adapter over the generated SDK is insufficient: the caller is the native supervisor's raw HTTP readiness probe.
- Why a serializer field / `validate` / `read_only_fields` is insufficient: serialization describes the response but does not establish intentional public access.
- Why `permission_classes` and `get_queryset` scoping are insufficient: explicit `AllowAny` is sufficient at runtime, but the exceptional public route still requires a reviewed registry reason and contract evidence.
- Why a database constraint/default is insufficient: health performs no database read or write.
- Why an existing service function is insufficient: the operation is a constant process-liveness response and has no domain service.
- Smallest custom seam: a zero-input action returns `HealthSerializer({"ok": True}).data`; the public permission and authentication override are local to that action.
- Service module / `transaction.atomic` used: not applicable; the probe intentionally does not touch persistence.
- Protected fields excluded from the request schema: there is no request body.
- Identity/scope binding (URL kwarg + queryset filter): not applicable; this is process liveness rather than resource access.
- Contract-drift and regression test: `npm run contract:check`; unchanged health and origin tests verify the public response and desktop-origin boundary.
- Registry entry, if this is genuinely non-CRUD: `SystemViewSet.health`; health is a registered host operation rather than model CRUD.
