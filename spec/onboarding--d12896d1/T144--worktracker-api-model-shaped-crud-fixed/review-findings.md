# Backend review findings — CODING-144 and children

Backend/API-only review of CODING-144 and its children (CODING-153, 154, 155,
156, 157, 158, 159, 160, 161, 165, 166) plus CODING-168.

**Reviewed and repaired on:** 2026-08-06  
**Scope:** Django/DRF, sidecar host routes, persistence, OpenAPI, the Python SDK,
MCP-facing API behavior, packaging, migrations, and backend documentation.

## Verification

| Check | Result |
|---|---|
| Full backend suite | **1177 passed, 3 skipped** |
| Route and OpenAPI contract tests | **90 passed** |
| Python SDK and generated-boundary tests | **12 passed** |
| Contract drift | **current** |
| Migration model drift | **none** |
| Targeted Ruff check over repaired backend files | **passes** |

The remaining warnings are existing deprecations around `jsonschema.RefResolver`
and `forkpty`, plus a test-database teardown warning. None is a failed finding
from this review.

## Resolved findings

### F1 — Schema-conformance path lookup

Schema tests now derive the mounted prefix from the OpenAPI document's
`servers` entry before resolving a path. Declared reads reach their schema
assertions and pass.

### F2 — Python SDK integration host

The generated client is configured at the document server root (`/api`), so
its generated `/work-tracker/...` operation paths are not duplicated. The MCP
client uses the same convention.

### F5 — Seeded provider models

Migration 0037 now seeds concrete model rows for every built-in provider,
including `vendor/model` as Agy's explicit replacement for unrestricted model
text. Migration tests pin the catalog.

### F6 — Deleting unused catalog rows

Model-to-reasoning permission links now cascade with their parent catalog row.
Launch bindings retain protective foreign keys, so only genuinely referenced
models and reasoning levels return a conflict.

### F7 and F21 — Authentication and exact public-route policy

Host routes are authenticated by default. The four routes that cannot use the
desktop API key have explicit, reviewed reasons in the route registry:

- supervisor health probe;
- provider lifecycle hook intake;
- run-scoped terminal self-termination;
- document assets loaded as webview subresources.

Tests cover every declared route and assert the exact public operation set in
OpenAPI; changing a route's security posture requires an intentional registry
change.

### F8 — Provider identity ownership

Provider identity and adapter capabilities are code-owned. The API exposes
provider list and activation updates only; provider create and delete return
method-not-allowed. Models and reasoning levels remain catalog CRUD resources.

### F9 and F22 — Superseded backend documentation

ADR 0005 now identifies ADR 0007 as its superseding transport decision and no
longer claims that active routes use the retired framework. Backend module
documentation describes the current DRF and transport-independent boundaries.

### F10 — Persisted provider vocabulary

Execution and settings input shapes accept normalized strings. Provider,
model, and reasoning validity is checked against persisted catalog rows at the
owning service seam. The obsolete hard-coded capability vocabulary was removed.

### F11 — Error envelope

Host and WorkTracker failures now use the same `detail` plus optional `code`
envelope. The host adapter preserves useful metadata such as conflict digests
and response headers such as `ETag` while normalizing legacy service responses.

### F12 — Work-item resource root

Graph-run and launch-agent are mounted below
`/api/work-tracker/work-items/{issue_id}`. Stable explicit operation IDs keep
generated client method names independent of the corrected path.

### F13 — PathFind subtree behavior

Issue types now carry a stable `is_pathfind` role. Default work-item lists hide
both each PathFind root and its descendants; renaming the type does not disable
the behavior. `include_pathfind=true` restores the complete subtree.

### F14 — Module archive filter

`include_archived` is declared in OpenAPI and is available to generated clients.

### F15 — Required workflow revision

Launch-binding update and delete validate the request serializer before taking
the revision lock. Missing or malformed revisions return a validation error;
actual stale revisions return a conflict.

### F16 — Trailing-slash route drift

The legacy terminal delete route was removed. Route normalization preserves a
trailing slash, so distinct live patterns can no longer collapse into one
registry key.

### F17 — Service boundary

The REST layer uses the public `get_issue` service helper, and validation
imports are module-level.

### F18 — Issue-type reassignment body

Issue-type deletion accepts optional `reassign_to` in a typed JSON body, and
OpenAPI declares that body. The ADR records why reassignment is valid for
classification deletion while state deletion remains guarded by transition
semantics.

### F20 — Landing-state observation

This was reclassified as release/branch administration rather than a code
defect. Generated package metadata no longer names the retired dependency or
allowlist. Commit state and ticket-board state should be handled when this work
is landed; they are not runtime acceptance failures.

## Confirmed delivered behavior

- The route registry and live route table conform in both directions.
- The quarantine remains exactly five reasoned domain operations.
- Transition rejection retains its required HTTP 422 contract.
- State deletion guards, transition CRUD, scoped reads, and finding-absorbing
  creation remain service-owned and covered.
- Packaging contains DRF and the OpenAPI generator and does not depend on the
  retired HTTP framework.
- Generated contract artifacts match the live schema.

## Outstanding backend findings

None from this review.
