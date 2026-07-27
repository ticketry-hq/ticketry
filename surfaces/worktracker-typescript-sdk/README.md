# WorkTracker TypeScript SDK

Private workspace package generated from the checked-in WorkTracker OpenAPI contract.

## Generate

From the repository root:

- `npm run openapi:export` exports deterministic `openapi.json`.
- `npm run sdk:generate` recreates `src/generated` with OpenAPI Generator 7.23.0 and the `typescript-fetch` target.
- `npm run contract:generate` runs both steps.

Generated files are committed and carry a generated-code notice. Do not edit them manually. Configuration, authentication, errors, and compatibility behavior live in hand-written files outside `src/generated`.

## Consume locally

The repository root is an npm workspace. Studio depends on `@worktracker/typescript-sdk` through the local workspace package.

Create a client with a WorkTracker API root and optional API key:

- Base URL example: `http://127.0.0.1:8787/api/work-tracker`
- Authentication header: `x-api-key`
- Node consumers require a runtime with standard Fetch.

The client exposes resource APIs such as `projects`, `modules`, `workItems`, and `attachments`. Generated methods accept an optional `RequestInit`, including `AbortSignal`. Non-2xx responses throw `WorkTrackerApiError`; native abort errors remain unchanged.

Representative workflow: create a client, call `client.projects.listProjects()`, select a project, then call `client.workItems.listProjectWorkItems({ projectId })`.
