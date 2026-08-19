---
name: drf-rest-api-audit
description: Audit Ticketry's Django backend for deviations from the DRF-first REST contract — handwritten APIViews, manual request parsing, model CRUD bypassing ModelSerializers, ad-hoc responses, or missing schema/contract coverage. Use when asked whether the backend, a branch, an app, or an endpoint is over-customized, bypasses DRF, or needs a framework-convergence plan.
---

# DRF REST compliance audit

Audit first; do not change application code unless the user also asks for a
fix. The audit answers two questions:

1. Where did the code bypass DRF's native machinery without proving it was
   necessary?
2. In what order should those deviations be moved back to the framework?

## Load the governing rubric

Before inspecting code:

1. Read `../../../AGENTS.md` and the code-structure rules in
   `../../../CLAUDE.md`.
2. Read the complete sibling skill at `../drf-rest-api/SKILL.md`, including
   its override-record reference.
3. Confirm the DRF and drf-spectacular configuration in
   `backend/studio_server/settings.py`. Treat authentication, permission, and
   exception-handler defaults as part of the contract.

The sibling `drf-rest-api` skill is the implementation authority. This skill
finds and prioritizes drift; it must not invent a competing architecture.

## Establish the intended surface

Inventory these before judging any endpoint:

- models, migrations, and their server-owned fields;
- serializers, their `fields` lists, and `read_only_fields`;
- ViewSets/generics and their `perform_*` delegation to services;
- URL bindings in each `urls.py`;
- the named-domain-operation registry
  (`backend/worktracker/rest/domain_ops.py`);
- service modules in `backend/worktracker/services/` and `backend/apps/*`;
- `openapi.json`, the generated SDKs, and the contract scripts
  (`npm run contract:generate`, `npm run contract:check`).

Use `rg` and the generated `openapi.json` as the first-pass inventory. Useful
searches:

```bash
rg -n "class .*\(APIView\)|class .*\(.*views.APIView" backend
rg -n "request\.data\.get|request\.data\[|json\.loads\(request" backend
rg -n "HttpResponse|JsonResponse" backend --glob '!**/tests/**'
rg -n "inline_serializer" backend
rg -n "class .*\(serializers\.Serializer\)" backend
rg -n "extend_schema" backend | rg -v "operation_id"
rg -n "try:\s*$" backend/worktracker/rest backend/apps
```

Search results are leads, not findings. Trace each public endpoint through its
view, serializer, and service to persistence before classifying it.

## Check for deviations

### Views

Flag:

- any `APIView` subclass — the repo's hard rule is ViewSets/generics only,
  with RPC-shaped operations as `@action`s on the owning resource's ViewSet;
- views reading `request.data` directly, calling `json.loads`, or validating
  with Pydantic instead of a DRF serializer;
- responses built from hand-assembled dicts, `HttpResponse`, or
  `JsonResponse` instead of a declared response serializer;
- business logic (validation, locking, cascades, repair) inside a view
  instead of a service function;
- per-view `try/except` blocks mapping errors that `ServiceError` plus the
  installed `service_exception_handler` already express;
- endpoints missing `@extend_schema` operation ids or excluded from the
  generated contract without a recorded reason.

### Serializers and field exposure

Flag:

- model-backed payloads expressed as plain `serializers.Serializer` mirrors
  instead of `ModelSerializer` with explicit `fields`;
- writable server-owned fields (ids, ranks, revisions, timestamps, counters,
  derived fields, protected foreign keys) missing from `read_only_fields`;
- `inline_serializer` used for reused or model-shaped payloads;
- intentionally-open JSON payloads without a named, documented serializer;
- patch endpoints that collapse `omitted | null | value` semantics.

### Scope, identity, and authorization

Flag:

- updates/deletes without a concrete URL identity bound to a scoped queryset;
- row ownership enforced ad hoc in the view body instead of `get_queryset`;
- endpoints overriding the default `IsAuthenticated`/`ApiKeyAuthentication`
  stack without a recorded reason;
- model fields or relationships exposed as separate public RPCs instead of
  fields on the model's update contract;
- named domain operations absent from the registry in `domain_ops.py`.

### Services and persistence

Flag:

- domain invariants living only in a DRF serializer or view when MCP,
  background, or test writers also mutate the same rows;
- multi-row or invariant-heavy writes without `transaction.atomic` in the
  service;
- raw SQL or `.update()`/bulk operations used for ordinary model CRUD where
  model/service semantics are bypassed;
- a pass-through layer that merely mirrors the ORM or a service that merely
  mirrors a serializer.

Do not flag raw SQL in migrations or a documented database primitive the ORM
cannot express.

### Contract and drift protection

Flag:

- hand-edited `openapi.json` or generated SDK files;
- endpoint changes without regenerated contract artifacts
  (`npm run contract:check` failing);
- frontend callers bypassing the generated SDK with ad-hoc fetch shapes;
- missing authorization, row-scope, rollback, or allowlist tests at the
  boundary that makes an override safe;
- user-visible Studio behavior without an acceptance case.

## Classify each surface

Use exactly one classification:

- **Conformant** — ViewSet/generic with declared serializers, correct layer
  placement, generated contract coverage.
- **Justified override** — a completed override record exists, the seam is
  minimal, and a regression test covers it.
- **Deviation** — custom/direct behavior duplicates a DRF capability or lacks
  the required evidence.
- **Needs proof** — source suggests an exception, but invariants or tests are
  insufficient to decide safely.

Rank findings:

- **P0:** writable protected fields, missing identity/scope, authorization
  bypass, or invariants enforced only at the REST transport.
- **P1:** `APIView` endpoints, manual request parsing, model CRUD bypassing
  `ModelSerializer`, per-view error mapping, unregistered domain RPCs.
- **P2:** inline/mirror serializers, missing operation ids, caller-shaping in
  the backend, missing drift tests, cleanups that do not currently threaten
  correctness.

## Report concisely

Lead with one verdict: `aligned`, `mostly aligned`, or `drifted`.

Then report:

```text
Endpoints inventoried: <n>
ViewSet/generic endpoints: <n>
APIView endpoints: <n>
Model CRUD paths bypassing ModelSerializer: <n>
Views with manual request parsing: <n>
Registered domain operations: <n>
Documented justified overrides: <n>
Unjustified/needs-proof overrides: <n>
```

List findings with exact file and line evidence:

| Priority | Surface | Why it deviates | Framework replacement | Blocker |
| --- | --- | --- | --- | --- |

Finally give a least-complex-to-most-complex convergence queue. Prefer:

1. schema annotations, named serializers, and error-handler adoption;
2. read endpoints onto generics/mixins with scoped querysets;
3. model CRUD onto `ModelSerializer` + `perform_*` service delegation;
4. RPC-shaped `APIView`s onto `@action`s with declared serializers;
5. invariant-heavy writes into services with `transaction.atomic`;
6. contract regeneration and drift tests last, sealing each batch.

Do not dump every search hit. Group repeated patterns and name the exact
surfaces affected.

## Remediation handoff

When the user asks to fix findings, explicitly switch to the sibling
`drf-rest-api` skill. Remediate one coherent batch at a time:

1. read its full instructions again;
2. start from the model/serializer/view/URL/service chain;
3. complete an override record for every custom seam that remains;
4. run the sibling skill's required focused, contract, typecheck, and
   acceptance tests;
5. report the reduced custom counts and blockers that remain.

Never turn an audit finding directly into a rewritten endpoint without
performing that safety workflow.
