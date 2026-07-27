# LLD - T739: Define worktracker_gateway boundary before direct WorkTracker service calls

**Module:** `refactor--e6e6fa8f` (Refactor)
**Work item:** `CODIN-739`
**Phase:** LLD only; no implementation in this ticket
**Applies to:** CODIN-737 packaging merge and CODIN-738 direct WorkTracker call slice

---

## 1. Objective

Resolve the packaging boundary before CODIN-737 moves former `core/` code into
`server/` and before CODIN-738 replaces loopback HTTP with direct WorkTracker
service calls.

The final decision is that `worktracker_gateway` must not survive as a durable package,
API boundary, or backend switchability abstraction. WorkTracker is the owned
backend. Server code that needs WorkTracker-owned behavior should call the
owned WorkTracker app/service surface directly.

This ticket produces the implementation harness for that decision only. It does
not move files, edit imports, add services, delete code, or implement CODIN-737
or CODIN-738.

---

## 2. Boundary Decision

### 2.1 Rejected abstraction

The WorkTracker/WorkTracker bridge premise is rejected.

Do not introduce or preserve:

- `server/worktracker_gateway/` as a long-lived package.
- Any `worktracker_gateway` public API that hides whether the backend is WorkTracker or
  WorkTracker.
- Any runtime switch between WorkTracker and WorkTracker backends.
- Any compatibility layer whose main purpose is to keep WorkTracker replaceable.
- Any CODIN-738 direct-call route that goes through `worktracker_gateway`.

### 2.2 Owned backend rule

WorkTracker is the owned backend. Calls for WorkTracker-owned behavior must go
through the WorkTracker app/service boundary selected by the service-layer
refactor, not through a WorkTracker compatibility module.

### 2.3 WorkTracker debris rule

Former `core/config`, DTO schemas, and `worktracker_client` code should be classified
as migration debris unless CODIN-737 proves a concrete current caller and a
current responsibility unrelated to backend replaceability.

Retained code must answer both questions:

- Which current server caller still needs this code after WorkTracker ownership
  is accepted?
- What responsibility does it have that is not "make WorkTracker swappable with
  WorkTracker"?

If either answer is missing, the code is deleted or left unmoved by CODIN-737.

---

## 3. Package/App Classification Harness

CODIN-737 should classify every former `core/` area using this order:

| Former area | Target classification | Rule |
| --- | --- | --- |
| `agents/` launcher/hooks | Existing Django app package, likely `terminals` | Move only if `terminals` remains the real owner of launch behavior. |
| `design_docs` | Existing Django app package, likely `documents` | Move only as document/spec path behavior owned by `documents`. |
| `config` | Delete or relocate narrowly | Retain only settings that still have a non-WorkTracker-switch responsibility. |
| DTO schemas from former `core/models.py` | Delete or relocate narrowly | Do not preserve as bridge DTOs. Retain only if a current non-bridge caller requires them. |
| `worktracker_client` | Delete or isolate as one-off migration/export plumbing | Do not preserve as a shared server integration package. |
| `worktracker_gateway` | Not created | No durable package, no app registration, no public backend abstraction. |

Classification constraints:

- A moved area becomes a Django app only if it owns ORM models, migrations,
  admin registration, app startup hooks, or another real Django app lifecycle
  responsibility.
- A moved area becomes a plain package only if it has an actual current owner
  and a bounded internal responsibility.
- Former WorkTracker integration code does not get a package merely because it is
  coupled to itself.

---

## 4. CODIN-737 Implementation Harness

CODIN-737 should update its existing mapping before implementation:

1. Remove `worktracker_gateway` from the module-to-home table.
2. Reclassify the former `config` + DTO schema + `worktracker_client` cluster using
   the package/app classification harness above.
3. Add an explicit "no backend switchability" note to the packaging design.
4. Keep `INSTALLED_APPS` free of any `worktracker_gateway` entry because no such app is
   created.
5. Remove any planned package discovery entry such as `worktracker_gateway*`.
6. Do not add tests under `worktracker_gateway/tests/`.
7. For any retained WorkTracker-specific file, document its owner, current caller,
   and non-replaceability responsibility in the CODIN-737 change summary.
8. Add a regression check that fails if a `server/worktracker_gateway` package or
   `worktracker_gateway` import is introduced by the packaging move.

Decision-complete retained-code rule:

- Keep only code with a current caller and a concrete non-bridge responsibility.
- Delete or omit code whose only job is WorkTracker compatibility, WorkTracker backend
  selection, WorkTracker/WorkTracker DTO normalization, or hiding the owned backend.

---

## 5. CODIN-738 Consumption Harness

CODIN-738 must consume the direct WorkTracker ownership model:

1. Treat WorkTracker as the target backend, not as one backend behind a bridge.
2. Route direct calls through the appropriate WorkTracker app/service surface.
3. Do not introduce `worktracker_gateway` as an adapter for direct WorkTracker calls.
4. Do not add broad dependencies from server integration code into
   `worktracker.services.*` through a WorkTracker-named package.
5. If a server-side adapter is needed, name and place it for the owning
   responsibility, not for WorkTracker compatibility.
6. Keep WorkTracker behavior owned by WorkTracker; the server composition layer
   may call it but should not duplicate its domain policy.

---

## 6. Verification Plan

CODIN-737 verification should include:

- No `server/worktracker_gateway/` directory exists after the packaging move.
- No import path begins with or references `worktracker_gateway`.
- No `worktracker_gateway` entry appears in Django `INSTALLED_APPS`.
- No package discovery config includes `worktracker_gateway*`.
- No test directory named `worktracker_gateway/tests` is created.
- Any retained WorkTracker-specific file has a documented current caller and a
  responsibility unrelated to backend replaceability.
- Existing moved tests still pass from their owning app/package locations.

CODIN-738 verification should include:

- Direct WorkTracker calls do not route through a WorkTracker-named module.
- WorkTracker-owned behavior is delegated to the WorkTracker service/app
  boundary.
- No backend switch, backend selector, or WorkTracker/WorkTracker compatibility API is
  added.

---

## 7. Out of Scope

- Implementing CODIN-737 file moves.
- Implementing CODIN-738 direct service calls.
- Designing a new WorkTracker API.
- Preserving WorkTracker as a swappable backend.
- Adding a new bridge package under a different name with the same purpose.
- Changing database schema, route contracts, frontend behavior, or SDK output.

---

## 8. Acceptance Signal

This LLD is acceptable when it makes the following decisions unambiguous:

- `worktracker_gateway` is not created or preserved as a durable package.
- WorkTracker/WorkTracker backend switchability is removed from the packaging plan.
- Retained former WorkTracker code requires a concrete current caller and a
  non-replaceability responsibility.
- CODIN-737 has a clear package/app mapping rule for former `core/` modules.
- CODIN-738 can proceed with direct WorkTracker ownership and must not reopen
  the bridge decision.
