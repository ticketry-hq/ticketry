# worktracker-sdk

OpenAPI-generated synchronous Python client for the owned WorkTracker HTTP API.

## Public surface

The generated `ApiClient`, configuration, tag APIs, models, and exceptions live
under `worktracker_sdk.generated`. The client and tag APIs are also exported
from `worktracker_sdk` for concise application imports:

```python
from worktracker_sdk import ApiClient, Configuration, ProjectsApi
from worktracker_sdk.generated import ProjectIn, ProjectOut
from worktracker_sdk.generated.exceptions import ApiException

configuration = Configuration(
    host="http://localhost:8787/api/work-tracker",
    api_key={"ApiKeyAuth": "secret"},
)
with ApiClient(configuration) as client:
    projects: list[ProjectOut] = ProjectsApi(client).list_projects()
```

The package is regenerated from the owned OpenAPI contract. Run
`npm run python-sdk:generate` from the repository root after changing that
contract, and use `npm run contract:check` to verify generated-source drift.

## Root-mounted companion APIs

Execution and launch operations live at `/api`, above the generated
`/api/work-tracker` contract. `ExecutionApi` and `LaunchApi` reuse the generated
client's authentication, HTTP transport, and exception mapping:

```python
from worktracker_sdk import ApiClient, Configuration, ExecutionApi, LaunchApi

configuration = Configuration(
    host="http://localhost:8787/api/work-tracker",
    api_key={"ApiKeyAuth": "secret"},
)
with ApiClient(configuration) as client:
    graph = ExecutionApi(client).get_dependency_graph("MEML-42")
    launch = LaunchApi(client).default_coding_agent("MEML-42")
```

Generated exceptions retain parsed error data on `exception.data` and the JSON
response body on `exception.body`.
