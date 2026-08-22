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
    host="http://localhost:8787/api",
    api_key={"ApiKeyAuth": "secret"},
)
with ApiClient(configuration) as client:
    projects: list[ProjectOut] = ProjectsApi(client).list_projects()
```

The package is regenerated from the owned OpenAPI contract. Run
`npm run python-sdk:generate` from the repository root after changing that
contract, and use `npm run contract:check` to verify generated-source drift.

Generated exceptions retain parsed error data on `exception.data` and the JSON
response body on `exception.body`.
