---
name: drf-rest-api
description: Build or migrate Ticketry's backend HTTP endpoints using Django REST Framework's native machinery — ModelSerializers, ViewSets/generics, permissions, queryset scoping, drf-spectacular schema, and the generated OpenAPI SDK contract. Use whenever adding, changing, reviewing, or removing a backend REST endpoint, serializer, or view.
---

# DRF-first REST API

Use Django REST Framework's declarative machinery as the default API and make
custom code prove why it exists. The desired path is:

```text
model + migration -> ModelSerializer -> ViewSet (mixins/generics)
                  -> path()/router binding -> drf-spectacular operation
                  -> openapi.json -> npm run contract:generate -> generated SDKs
```

Do not begin with a handwritten view, ad-hoc dict payload, or manual
`request.data` parsing.

## Before changing code

1. Read the code-structure rules in `../../../AGENTS.md` and `../../../CLAUDE.md`.
2. Confirm the DRF configuration in `backend/studio_server/settings.py`
   (`REST_FRAMEWORK`, `SPECTACULAR_SETTINGS`): `ApiKeyAuthentication` and
   `IsAuthenticated` are installation-wide defaults, `AutoSchema` generates the
   contract, and `worktracker.rest.exceptions.service_exception_handler` maps
   `ServiceError` to responses.
3. Identify the model, serializer, view, URL binding, service function, and
   generated-contract consumer affected by the change.
4. Locate the reference implementation: `backend/worktracker/rest/views.py`
   (ViewSets delegating to `worktracker/services` via `perform_*`) and
   `backend/worktracker/rest/urls.py` (explicit `path()` bindings of ViewSet
   actions with contract-stable URL shapes).

## Views: ViewSets and generics only — no APIView

Every endpoint is a `GenericViewSet` with the mixins it needs (or a DRF
generic view). Handwritten `APIView` subclasses are not allowed anywhere in
this backend, including `backend/apps/`.

- Model-backed CRUD uses the matching mixins (`ListModelMixin`,
  `CreateModelMixin`, `UpdateModelMixin`, `DestroyModelMixin`,
  `RetrieveModelMixin`) with a `queryset`, `serializer_class`, and
  `lookup_url_kwarg`.
- Non-model or RPC-shaped operations (terminals, runs, worktrees, settings,
  reorders, acknowledgements) become `@action` methods on the owning
  resource's ViewSet — with a declared request serializer, a declared response
  serializer, and an `@extend_schema(operation_id=...)` annotation.
- Bind actions in `urls.py` with explicit `path()` +
  `ViewSet.as_view({...})` mappings, matching the existing URL shapes. Do not
  invent new URL conventions per endpoint.

Every input crosses a serializer: `serializer.is_valid(raise_exception=True)`
via the generic machinery, never `request.data.get(...)`, `json.loads`, or
Pydantic models validated inside a view. Every output is
`Response(Serializer(instance).data)` — never a hand-built dict, `HttpResponse`
with JSON, or `JsonResponse`.

## Serializers are the field allowlist

- Model-backed payloads use `ModelSerializer` with an explicit `fields` list
  and `read_only_fields` for server-owned values (ids, ranks, revisions,
  timestamps, counters, derived fields).
- The generated `openapi.json` is the public contract. Protected fields must
  be absent from generated *request* schemas — enforce with
  `read_only_fields`, not by hoping clients omit them.
- One-field coercion or formatting belongs in a serializer field
  (`validate_<field>`, `to_representation`, or a custom field class), not in
  the view or the service.
- Do not write a plain `serializers.Serializer` that mirrors a model's
  columns, and do not use `inline_serializer` for anything reused or
  model-shaped. Named serializers live in the app's `serializers.py`.

## Put behavior in the correct layer

Use the lowest layer that owns the rule:

| Need | Put it here |
| --- | --- |
| Caller-specific names or presentation shape | frontend feature adapter over the generated SDK |
| Single-field validation, coercion, codec | serializer field / `validate_<field>` |
| Cross-field input validation | `Serializer.validate` |
| Operation-level authorization | `permission_classes` / DRF permission class |
| Field exposure control | `ModelSerializer.fields` + `read_only_fields` |
| Mandatory row ownership or scope | `get_queryset` filtering |
| Uniqueness, referential integrity, defaults | database constraint / model default |
| Domain invariant that must hold for every writer (REST, MCP, background, tests) | `worktracker/services/` or the owning `apps/<capability>` service module |
| Atomic multi-row behavior, locking, revision CAS | `transaction.atomic` inside the service |
| Error-to-response mapping | `ServiceError` + `service_exception_handler`, never per-view `try/except` |
| Durable side effects | the service layer, never the view |

Views are thin transport: ViewSet `perform_create`/`perform_update`/
`perform_destroy` and `@action` bodies delegate to a service function and
serialize its result. DRF serializers validate the *transport*; they are not a
substitute for domain rules that must also hold for MCP, background, or test
writers.

## Named domain operations

An RPC-shaped operation (not model CRUD) is allowed only when it is listed in
the quarantined registry, `backend/worktracker/rest/domain_ops.py` (or the
owning app's equivalent), with its reason. The current allowed exceptions are
work-item reorder, state reorder, issue-type reorder,
remove-state-from-workflow, and onboarding acknowledgement. Do not split model
fields or relationships into separate RPCs — parent, blockers, classification,
archive, and state remain fields of the work-item update contract.

Before adding any custom seam — a new `@action`, a non-`ModelSerializer`
payload, an `extend_schema` override that diverges from AutoSchema, or any
by-hand response shaping — copy and complete
[the override record](references/override-record.md). An incomplete record
means the override is not ready to implement.

## The contract is generated, never patched

- Annotate operations with `@extend_schema(operation_id=..., tags=...)` so the
  generated contract is stable and readable.
- After any endpoint change run `npm run contract:generate` (exports
  `openapi.json`, regenerates the TypeScript and Python SDKs, and exports wire
  frames) and commit the results together.
- Never hand-edit `openapi.json` or generated SDK files.
- Frontend callers consume the generated SDK from their feature folder and
  adapt shape there; backend endpoints do not reshape payloads for one screen.

## Verification

Test the boundary that made the design safe:

- serializer allowlist behavior — protected/read-only fields rejected or
  ignored on write;
- unauthorized and out-of-scope rows for permissions and queryset scoping;
- service invariants and transaction rollback for invariant-heavy writes;
- contract drift (`npm run contract:check` must pass);
- a Studio acceptance case for every user-visible behavior change.

Run the smallest focused tests first, then at minimum:

```bash
(cd backend && uv run --extra dev pytest -q)
npm run contract:check
npm run typecheck
npm run test:overhaul --workspace @worktracker/studio
```

When handing off, state which endpoints now use plain DRF machinery, which
remain custom, and the exact invariant blocking each remaining override.
