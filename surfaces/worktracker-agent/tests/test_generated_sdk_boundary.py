"""Contract checks for the generated-SDK-only agent boundary."""

import json
from pathlib import Path
import subprocess
import sys

from worktracker_sdk.generated import (
    AttachmentsApi,
    IssueTypesApi,
    LaunchBindingsApi,
    ModelsApi,
    ModulesApi,
    ProjectsApi,
    ProvidersApi,
    ReasoningLevelsApi,
    StatesApi,
    WorkItemsApi,
    WorkflowsApi,
)
from worktracker_sdk.generated.exceptions import ApiException
from worktracker_sdk.root_api import ExecutionApi, LaunchApi, RevisionedDeleteApi

from worktracker_agent.api.service import WorktrackerService


AGENT_ROOT = Path(__file__).parents[1]


def test_agent_has_no_hand_rolled_sdk_imports():
    forbidden = (
        "TaskManager" + "Client",
        "worktracker_sdk." + "models",
        "worktracker_sdk." + "errors",
        "worktracker_sdk." + "resources",
    )

    offenders = {
        str(path.relative_to(AGENT_ROOT)): token
        for path in AGENT_ROOT.rglob("*.py")
        for token in forbidden
        if token in path.read_text()
    }

    assert offenders == {}


def test_importing_agent_does_not_load_hand_rolled_sdk_modules():
    probe = """
import sys

from worktracker_agent.api.service import WorktrackerService

prefix = "worktracker_sdk."
forbidden = {
    prefix + "client",
    prefix + "errors",
    prefix + "models",
    prefix + "resources",
}
loaded = sorted(forbidden.intersection(sys.modules))
if loaded:
    raise SystemExit(f"hand-rolled SDK modules loaded: {loaded}")
"""

    result = subprocess.run(
        [sys.executable, "-c", probe],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr


def test_default_service_builds_generated_per_tag_clients():
    service = WorktrackerService(
        base_url="https://worktracker.test/api/work-tracker",
        api_key="secret",
    )

    assert isinstance(service.sdk.projects, ProjectsApi)
    assert isinstance(service.sdk.modules, ModulesApi)
    assert isinstance(service.sdk.issue_types, IssueTypesApi)
    assert isinstance(service.sdk.states, StatesApi)
    assert isinstance(service.sdk.work_items, WorkItemsApi)
    assert isinstance(service.sdk.workflows, WorkflowsApi)
    assert isinstance(service.sdk.attachments, AttachmentsApi)
    assert isinstance(service.sdk.launch_bindings, LaunchBindingsApi)
    assert isinstance(service.sdk.models, ModelsApi)
    assert isinstance(service.sdk.providers, ProvidersApi)
    assert isinstance(service.sdk.reasoning_levels, ReasoningLevelsApi)
    assert isinstance(service.sdk.execution, ExecutionApi)
    assert isinstance(service.sdk.launch, LaunchApi)
    assert isinstance(service.sdk.revisioned_delete, RevisionedDeleteApi)
    # The generated operations already carry the /work-tracker segment, so the
    # SDK host must be the /api root. Keeping the segment here is what produced
    # /api/work-tracker/work-tracker/... and 404'd every read.
    assert service.sdk.api_client.configuration.host == "https://worktracker.test/api"
    assert service.sdk.api_client.configuration.api_key == {"ApiKeyAuth": "secret"}


def test_service_accepts_either_form_of_configured_base_url():
    """Callers configure the base either way; both must reach the /api root."""

    for configured in (
        "https://worktracker.test/api/work-tracker",
        "https://worktracker.test/api/work-tracker/",
        "https://worktracker.test/api",
        "https://worktracker.test/api/",
    ):
        service = WorktrackerService(base_url=configured, api_key="secret")
        assert service.sdk.api_client.configuration.host == "https://worktracker.test/api"


def test_structured_error_body_wins_over_narrow_generated_error_model():
    body = {
        "detail": "A Story cannot move 'Idea' to 'Done'.",
        "code": "illegal_transition",
        "from": "Idea",
        "to": "Done",
    }
    error = ApiException(
        status=422,
        body=json.dumps(body),
        data={"detail": body["detail"]},
    )

    assert WorktrackerService._sdk_error_body(error) == body
