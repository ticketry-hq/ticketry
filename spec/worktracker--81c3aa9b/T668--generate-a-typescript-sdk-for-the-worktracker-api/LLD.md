# LLD — Generate a TypeScript SDK for the WorkTracker API (#668)

Status: Approved on June 24, 2026.

Interactive review artifact: [LLD.html](./LLD.html)

## Implementation harness

### Generator decision

- Generate the SDK with `@openapitools/openapi-generator-cli` version `2.39.0`, configured to download and use OpenAPI Generator `7.23.0`.
- Use the OpenAPI Generator `typescript-fetch` client target. It produces browser-native Fetch endpoint classes and TypeScript models without introducing a framework-specific runtime.
- Keep the wrapper package version, generator JAR version, and generator options pinned in committed files and the root lockfile.
- Do not use Orval, Hey API, or openapi-typescript for this ticket: each would require a different generated/runtime boundary than the accepted OpenAPI Generator Fetch-package design.

### Contract export and normalization

- `worktracker/worktracker/openapi.py` — new isolated API-schema builder that mounts the WorkTracker router at the schema root so operation paths remain API-root-relative, records `/api/work-tracker` as the default server URL, fixes API metadata/version, and exposes the same contract used by the export command and schema tests.
- `worktracker/worktracker/management/commands/export_openapi.py` — new one-shot export command. It serializes the schema with recursively sorted object keys, stable indentation, UTF-8, and one trailing newline; output defaults to repository-root `openapi.json` and accepts an explicit destination for tests/CI.
- `worktracker/worktracker/api.py` — add explicit stable `operation_id` values and resource tags to every supported operation; declare route-specific success and non-success responses without changing route behavior.
- `worktracker/worktracker/schemas.py` — add shared error/validation response shapes where Django Ninja does not already emit a reusable component; preserve PATCH fields as optional properties whose nullable members still distinguish omitted from explicit `null`.
- `worktracker/worktracker/tests/test_openapi_contract.py` — new contract tests for deterministic export, operation-id uniqueness, API-key security, JSON bodies, query/path parameters, nullable PATCH fields, multipart upload, declared errors, and empty `204` responses.
- `openapi.json` — new checked-in generated contract; never manually edited.

### Repository workspace and generated package

- `package.json` — new private repository workspace root with `studio` and `worktracker-typescript-sdk` workspaces plus contract generation/check scripts.
- `package-lock.json` — new root lockfile replacing the workspace-local Studio lockfile; generated from the two declared workspaces.
- `studio/package-lock.json` — removed after the root workspace lock is established.
- `openapitools.json` — new generator configuration pinning the OpenAPI Generator CLI version.
- `scripts/generate-typescript-sdk.mjs` — new orchestration script that requires a clean exported schema, clears only the package’s generated directory, invokes the pinned `typescript-fetch` generator, and stamps generated notices deterministically.
- `scripts/check-contract-drift.mjs` — new CI helper that exports and generates into temporary locations, compares both against committed output, and exits non-zero with the stale paths.
- `worktracker-typescript-sdk/package.json` — new private package named `@worktracker/typescript-sdk`, ESM-first, with committed build output excluded from source control and standard build/typecheck/test scripts.
- `worktracker-typescript-sdk/tsconfig.json` — new strict browser/modern-Node TypeScript configuration with DOM Fetch types and declaration output.
- `worktracker-typescript-sdk/openapi-generator-config.json` — new pinned options for `typescript-fetch`, original JSON property names, resource-tag API classes, ES modules, and deterministic file layout.
- `worktracker-typescript-sdk/src/generated/` — generated models, resource API classes, runtime, and generated-code notices; deleted and recreated by generation, never manually edited.
- `worktracker-typescript-sdk/src/client.ts` — hand-written client factory configuring base URL, `x-api-key`, caller-provided Fetch, and per-call `AbortSignal`.
- `worktracker-typescript-sdk/src/errors.ts` — hand-written stable `WorkTrackerApiError` mapping status, message, response body, headers, and Django Ninja validation details from generated transport failures.
- `worktracker-typescript-sdk/src/index.ts` — public exports for the client factory, stable error type, generated models, and generated resource APIs.
- `worktracker-typescript-sdk/test/` — package tests for configuration, auth headers, query encoding, JSON, multipart bodies, cancellation, `204`, and error normalization.
- `worktracker-typescript-sdk/README.md` — generation, regeneration, local workspace consumption, authentication, cancellation, error handling, and one representative workflow.

### Studio compatibility migration

- `studio/package.json` — consume `@worktracker/typescript-sdk` through the repository workspace.
- `studio/src/lib/api.ts` — keep every existing exported function signature; replace the hand-written transport with calls through one configured SDK client and translate the stable SDK error into the existing `ApiError` compatibility class.
- `studio/src/lib/types.ts` — re-export or alias generated contract models for API-owned shapes; retain only Studio-only view/filter types locally. No duplicate API interface remains authoritative.
- `studio/src/test/api.test.ts` — preserve the existing adapter behavior suite and extend it for SDK delegation, auth, query encoding, JSON, multipart, cancellation, empty responses, and error compatibility.
- Studio stores, components, and call sites remain unchanged except for any import-only adjustment required by generated type aliases.

### CI

- `.github/workflows/contract.yml` — new workflow that installs Python and root npm dependencies, exports OpenAPI, regenerates the SDK, fails on drift, then runs backend tests, Python SDK tests, TypeScript SDK tests/typecheck/build, and Studio tests/typecheck/build.

## Decision-complete steps

### 1. Freeze the OpenAPI surface before generating

- Assign every route a semantic, unique operation id using the existing public verb/resource vocabulary, such as list, get, create, patch, delete, reorder, archive, upload, start, and complete.
- Split generated API classes by stable resource tags: Projects, Modules, Sprints, WorkItems, Attachments, IssueTypes, and States.
- Keep all current URLs and runtime handlers unchanged. This step improves schema metadata only.
- Declare `x-api-key` once through the existing router-level `ApiKeyAuth`; the exported operations must reference the resulting security scheme.
- Give each route its actual success response and applicable `401`, `404`, `409`, and `422` error components. Validation errors use a structured list; message errors retain Django Ninja’s `detail` string form.
- Preserve delete routes as `204` with no response body. Do not model them as nullable JSON.
- Preserve attachment upload as `multipart/form-data` with one required binary `file` part and its current attachment response.
- Add schema assertions for PATCH fields where `null` clears a relation: `parent_id`, `sprint_id`, `state_id`, and other nullable fields remain optional and nullable; omission remains a no-op.

### 2. Make export deterministic and host-independent

- Build the schema from a dedicated API object rather than importing a long-running development server or making an HTTP request.
- Mount the router at the schema root so generated paths are `/projects`, `/work-items/...`, and similar. Record `/api/work-tracker` as the server/API root; the generated path and configured base URL must never duplicate `work-tracker`.
- Fix title, API version, and OpenAPI version in the builder; do not derive them from wall-clock time, filesystem paths, hostnames, or environment-specific server URLs.
- Canonicalize dictionary key order recursively and preserve array order emitted by route registration.
- The export command writes only when content differs and always emits one trailing newline.
- A test exports twice into separate temporary files and requires byte-for-byte equality.

### 3. Establish one npm workspace without broad repository restructuring

- Add a private root workspace containing only `studio` and `worktracker-typescript-sdk`.
- Move dependency locking to one root `package-lock.json`; do not introduce pnpm, yarn, Turborepo, or a shared UI package.
- Keep each workspace’s existing scripts independently runnable through npm workspace selection.
- The TypeScript SDK remains private and local; registry metadata, publishing credentials, semantic-release automation, and compatibility guarantees are deferred.

### 4. Pin and constrain generation

- Use `@openapitools/openapi-generator-cli@2.39.0` with OpenAPI Generator `7.23.0` and its `typescript-fetch` target; pin the package in the root lockfile and the generator version in `openapitools.json`.
- Commit generator options and generated source. The generation script may replace only `worktracker-typescript-sdk/src/generated`.
- Generated files carry a generated-code notice and fail lint/review expectations if edited outside regeneration.
- Do not place authentication, environment lookup, product-specific errors, or Studio compatibility code inside generated files.
- Generation output must be byte-stable on two consecutive runs with the same schema, lockfile, CLI version, and config.

### 5. Define the hand-written SDK runtime boundary

- `createWorkTrackerClient` accepts `baseUrl`, optional `apiKey`, optional Fetch implementation, and optional default headers.
- Normalize the base URL once by removing a trailing slash; generated relative paths append beneath it without duplicate separators.
- Inject `x-api-key` only when a non-empty key is configured. Caller headers may add values but may not silently erase the configured key.
- Pass a caller’s `AbortSignal` through the generated request-init override; cancellation remains the platform’s native abort error and is not converted into an API error.
- Parse successful `204` responses as `undefined`.
- Convert non-2xx generated transport failures into `WorkTrackerApiError`. Prefer a string `detail`; otherwise preserve the validation-detail array and expose a concise fallback message while retaining the full body.
- Do not add retries, caching, React hooks, state management, telemetry, or Node polyfills. Node consumers require a runtime with standard Fetch.

### 6. Make the generated contract canonical for Studio

- Configure one SDK client from `VITE_WT_API_BASE` and `VITE_WT_API_KEY`, preserving today’s default `/api/work-tracker`.
- Keep the named exports and parameters in `studio/src/lib/api.ts` stable so stores/components do not migrate in this ticket.
- Each adapter function delegates to the corresponding generated operation and unwraps any generated request-parameter object internally.
- Preserve `ApiError` as the Studio-facing compatibility type, populated from `WorkTrackerApiError` with the same `status`, `message`, and `body` fields current callers/tests expect.
- Replace API-owned interfaces in `studio/src/lib/types.ts` with generated type aliases/re-exports. Keep `View`, client-side filters, and other UI-only shapes local.
- If a generated schema name is unsuitable, fix the backend schema/operation metadata or generator mapping; never hand-edit generated names.

### 7. Verify behavior at three layers

- Backend contract tests verify the document, not generated TypeScript.
- SDK tests use a stub Fetch implementation and verify exact URL, headers, method, body/media type, abort signal, response parsing, and error mapping.
- Studio adapter tests verify the old public function surface remains behaviorally compatible while delegating to the SDK.
- Add one compile-time fixture that imports representative models and APIs from `@worktracker/typescript-sdk` in both browser and modern-Node TypeScript configurations.

### 8. Enforce drift in CI

- CI first exports `openapi.json`, then regenerates `src/generated`, then checks the working tree or explicit file comparison for differences.
- Drift failure identifies whether the stale artifact is the schema, generated SDK, or both and prints the exact regeneration command.
- After drift passes, run backend, Python SDK, TypeScript SDK, and Studio validation. Generated artifacts are consumed as committed files; normal Studio/package builds never invoke Java or the generator.

## Failure and edge-case matrix

| Case | Required result |
|---|---|
| Same backend source exported twice | Byte-identical `openapi.json` |
| Duplicate/missing operation id | Backend contract test fails |
| Missing API key | Generated operation documents `401`; runtime returns typed API error |
| Validation failure | `WorkTrackerApiError` retains structured Django Ninja validation details |
| `parent_id` or `sprint_id` omitted | Generated request omits property |
| `parent_id` or `sprint_id` set to `null` | Generated JSON includes explicit `null` |
| Attachment upload | Browser-native `FormData`; generator does not force JSON content type |
| Delete success | Resolves `undefined` without JSON parsing |
| Abort signal fires | Native abort rejection propagates |
| Trailing slash in base URL | No double slash in request URL |
| Backend contract changes without regeneration | CI drift check fails |
| Generator version/config changes output | Reviewable committed diff; CI requires regenerated output |
| Studio migration | Existing store/component call sites and `ApiError` behavior remain stable |

## Build order

1. Add deterministic schema builder/export command and backend contract tests.
2. Normalize operation ids, tags, security, errors, multipart, nullable PATCH fields, and `204` responses until contract tests pass.
3. Add root npm workspace, pinned generator configuration, SDK package skeleton, and committed generated output.
4. Add the hand-written client/error runtime, package tests, and README.
5. Convert Studio’s API/types files into a compatibility adapter over the SDK; keep call sites stable.
6. Add drift CI and run backend, Python SDK, TypeScript SDK, and Studio validation.

## Acceptance signal

The slice is complete when one deterministic command exports `openapi.json`, one pinned command recreates the committed Fetch SDK, Studio uses that package behind its unchanged API facade, contract drift fails CI, and all four validation surfaces remain green. No registry publishing, hooks, Python SDK generation, unrelated API redesign, or broad Studio rewrite is included.
