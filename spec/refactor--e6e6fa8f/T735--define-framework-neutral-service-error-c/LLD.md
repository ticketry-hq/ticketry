# LLD — T735: Define framework-neutral service error contract

**Module:** `refactor--e6e6fa8f` (Refactor WorkTracker backend around a domain service layer)
**Work item:** #735
**Phase:** LLD (no implementation in this phase)
**Repo:** `worktracker-stack/worktracker/worktracker/`

---

## 1. Objective

Make `services/errors.py` the single, framework-neutral error contract for the
service layer and make the route layer the single, uniform place that converts
those errors into Ninja `HttpError`. Preserve every existing HTTP status code
and response message. No API path, schema, or OpenAPI changes.

This is a contract + boundary standardization, not a behavior change. Three
problems are corrected:

1. **No named conflict type.** Conflicts are raised as raw `ServiceError(409, …)`
   at 15 sites; the contract has named `NotFoundError`/`ValidationError` but no
   peer for 409.
2. **Framework leakage into services.** `services/work_items.py` and
   `services/modules.py` import `ninja.errors.HttpError` purely to catch the
   `HttpError` raised by the shared helper `resolve_issue_type`.
3. **Inconsistent translation boundary.** `api/configuration.py` uses a clean
   `_http_errors()` context manager; the other route modules each repeat an
   inline `try/except ServiceError → HttpError`.

---

## 2. The contract (target state)

The canonical contract lives in `services/errors.py` and consists of:

- `ServiceError(status_code: int, message: str)` — base; carries `status_code`
  and `message`, plus the existing `status` alias property. Unchanged.
- `NotFoundError(message)` → `status_code == 404`. Unchanged.
- `ValidationError(message)` → `status_code == 422`. Unchanged.
- `ConflictError(message)` → `status_code == 409`. **New named class** (the only
  structural addition). Behaviorally identical to today's `ServiceError(409, …)`.

Contract rules the service layer must obey after this ticket:

- A service module may raise **only** `ServiceError` or one of its subclasses.
- A service module must **not** import or reference any Ninja symbol
  (`HttpError`, `Status`, request/response schemas) or any Django HTTP helper
  whose contract is "raise a framework error" (e.g. `get_object_or_404`).
- Every raised error carries an HTTP-mappable `status_code` and a
  human-readable `message`. Nothing else is required of the contract; no new
  status codes (401/403/500) are introduced.

Status-code semantics, frozen and preserved: **404 = not found**, **422 =
validation**, **409 = conflict**.

`services/exceptions.py` stays as a compatibility alias layer (per the ticket
decision). It is not deleted and legacy imports are not migrated in this scope.
Its `Conflict` alias is re-pointed so it is a subclass/alias of the new
`ConflictError` rather than a parallel ad-hoc 409 subclass; `NotFound` and
`Unprocessable` aliases are unchanged. A one-line module docstring marks it
deprecated plumbing that should not be used by new code.

---

## 3. The translation boundary (target state)

One shared converter, used by every route module:

- A single `_http_errors()` context manager (the one currently in
  `api/configuration.py`) is promoted to the shared route module `api/router.py`,
  which every route module already imports for the shared `Router`/auth. It
  catches `ServiceError` and re-raises `HttpError(exc.status_code, exc.message)`.
- All route modules (`api/work_items.py`, `api/projects.py`, `api/sprints.py`,
  `api/modules.py`, `api/configuration.py`, and `api/attachments.py` if it
  performs any service call that can raise `ServiceError`) wrap their
  service-call sections with this one helper, replacing every inline
  `try/except ServiceError`.
- The route layer remains the **only** place that mentions `HttpError`. The
  mapping is exactly `status_code → HttpError(status_code, message)`, so 404/422/
  409 and all messages are preserved byte-for-byte at the boundary.

Note: where a route currently calls a Django HTTP helper directly (e.g. a
`get_object_or_404` in the route body, outside the service), that is route-layer
code and may stay; the framework-neutrality rule applies to the service layer.

---

## 4. Decision-complete change list

### 4.1 `services/errors.py`
- Add `ConflictError(ServiceError)` that initializes with status code 409 and the
  given message, mirroring `NotFoundError`/`ValidationError`.
- No other change. Base `ServiceError` and its `status` property stay as-is.

### 4.2 Conflict call-site migration (raw 409 → `ConflictError`)
Replace every raw `ServiceError(409, <message>)` with `ConflictError(<message>)`,
keeping the message text identical:
- `services/sprints.py`: lines 39, 66, 95 (`"another sprint is active"`),
  122 (`"sprint already completed"`).
- `services/workflow_config.py`: lines 37, 67, 79, 106, 112, 205, 213, 217.
- `services/projects.py`: line 50 (duplicate slug).
- `services/modules.py`: line 51 (module has children).
- `services/work_items.py`: line 200 (issue has children).

Behavior is unchanged: `ConflictError` is a `ServiceError` with `status_code ==
409`, so the `conflict()` test helper and every route mapping still see 409 with
the same message.

### 4.3 Remove framework leakage from the service-call helpers
The shared helper module `work_items.py` (top-level, callable from services) is
the leak source. Convert its raised errors to domain errors:
- `resolve_issue_type` (currently raises `HttpError(422, …)` on level mismatch
  and relies on `get_object_or_404` for the missing-type case): raise
  `ValidationError` for the level mismatch; raise `NotFoundError` for a missing
  `IssueType` (replace the `get_object_or_404` lookup with a domain lookup that
  raises `NotFoundError`). Status codes preserved: level mismatch stays 422,
  missing type stays 404.
- `reorder_neighbor` (raises `HttpError(422, "Neighbor belongs to another
  project.")` and uses `get_object_or_404`): raise `ValidationError` for the
  cross-project case; raise `NotFoundError` for a missing neighbor. **Audit step
  first:** confirm callers. The private `_reorder_neighbor` inside
  `services/work_items.py` is the in-service path; verify whether the top-level
  `reorder_neighbor` has any non-service (route) caller. If a route calls it
  directly, that route must be inside `_http_errors()` after this change so the
  domain error maps identically (422/404). If it has no caller, note that in the
  PR and leave it converted for consistency.
- After conversion, the helper module must not import `ninja.errors.HttpError`
  for these paths.

### 4.4 Drop `HttpError` from the service layer
- `services/work_items.py`: remove `from ninja.errors import HttpError` (line 7)
  and the two `except HttpError as exc: raise ValidationError(...)` blocks
  (around lines 43 and 102) — `resolve_issue_type` now raises the domain error
  directly, so the wrap is redundant.
- `services/modules.py`: remove `from ninja.errors import HttpError` (line 6) and
  the `except HttpError` block (around line 24), same reasoning.
- Confirm no other `services/*.py` references any Ninja symbol.

### 4.5 Unify the route translation boundary
- Move `_http_errors()` from `api/configuration.py` into `api/router.py` (or a
  small dedicated `api/_errors.py` imported by `router.py`); export it.
- `api/configuration.py`: import the shared helper instead of defining its own.
- `api/work_items.py`, `api/projects.py`, `api/sprints.py`, `api/modules.py`:
  replace each inline `try/except ServiceError → HttpError` with the shared
  `_http_errors()` context manager wrapping the service-call section. The
  resulting `HttpError(status_code, message)` is identical to today.
- `api/attachments.py`: wrap with `_http_errors()` only if it makes a service
  call that can raise `ServiceError`; otherwise leave unchanged.

---

## 5. Test plan

### 5.1 Service-layer tests (assert domain errors directly)
Assert the exception type and `status_code` (and key `message` where a test
already pins text), never `HttpError`, inside service tests:
- Add a focused test that `ConflictError` carries `status_code == 409` and is a
  subclass of `ServiceError`, and that each migrated 409 site now raises
  `ConflictError` (extend existing `test_service_sprints.py`,
  `test_workflow_config_services.py`, `test_project_services.py`,
  `test_module_services.py`, `test_service_work_items.py`). The existing
  `conflict()` helper continues to assert `status_code == 409`.
- Add tests that `resolve_issue_type` raises `ValidationError` (422) on level
  mismatch and `NotFoundError` (404) on a missing issue type — asserting the
  domain types, confirming no `HttpError` escapes the service path.
- Add an import-guard test: assert that no module under `services/` imports
  `ninja` (scan the imported module set or source) — a regression fence for the
  framework-neutrality rule.

### 5.2 Route-layer tests (pin HTTP mapping only where needed)
- Keep `test_t734_error_mapping.py`'s existing 404 and 422 route assertions.
- Add one route test that a conflict path returns HTTP **409** with the expected
  message (e.g. duplicate project slug, or "another sprint is active"), pinning
  the `ConflictError → HttpError(409)` mapping at the boundary.
- No new tests for paths already covered; the goal is to pin each of 404/422/409
  once at the route boundary, not to re-test every site.

### 5.3 Regression bar
- Full backend suite passes with the same pass count as before plus the new
  focused tests; no existing status code or message assertion changes.

---

## 6. Out of scope (explicit)
- Any API path, request/response schema, `Status`, or OpenAPI change.
- New status codes (401/403/500) or new error classes beyond `ConflictError`.
- Migrating legacy imports off `services/exceptions.py`; it stays as the
  compatibility alias layer.
- Broader service-layer refactor unrelated to the error contract and its
  translation boundary.
- Any Coding-overlay work.

---

## 7. Acceptance signal
- `services/errors.py` defines `ServiceError`, `NotFoundError`, `ValidationError`,
  `ConflictError`; no service module raises raw `ServiceError(409, …)` or imports
  any Ninja symbol.
- Exactly one `_http_errors()` converter exists and every route module routes
  `ServiceError` through it; `HttpError` appears only in the route layer.
- 404/422/409 codes and all response messages are unchanged at the API boundary,
  verified by the existing and added mapping tests.
- `services/exceptions.py` remains present as a documented compatibility alias
  layer.
