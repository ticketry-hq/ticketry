"""Root-mounted operations sharing the generated SDK transport.

The generated CRUD contract is rooted at ``/api/work-tracker`` while these
host operations are rooted at ``/api``. OpenAPI Generator assumes one base URL
for the whole client, so this small extension reuses its ``ApiClient`` instead
of generating incorrect ``/api/work-tracker/work-items/...`` URLs.

The response models intentionally live here rather than reusing the legacy
hand-written resource models: this is the contract-phase surface that remains
when the legacy client and its models are removed.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel

from worktracker_sdk.generated.api_client import ApiClient


class GraphNodeOut(BaseModel):
    task_id: str
    status: str
    agent_run_id: str | None = None
    error: str | None = None


class GraphOut(BaseModel):
    root_id: str
    project_id: str
    module_id: str
    agent: str | None = None
    nodes: list[GraphNodeOut]


class DependencyGraphNodeOut(BaseModel):
    id: str
    state: str
    parent_id: str | None = None
    blocked_by: list[str]


class DependencyGraphOut(BaseModel):
    root_id: str
    nodes: list[DependencyGraphNodeOut]


class LeafLldRunOut(BaseModel):
    task_id: str
    status: str
    agent_run_id: str | None = None
    error: str | None = None


class GenerateLeafLldsOut(BaseModel):
    root_id: str
    runs: list[LeafLldRunOut]


class PlanningRunOut(BaseModel):
    task_id: str
    project_id: str
    module_id: str
    agent: str | None = None
    phase: str
    status: str
    agent_run_id: str | None = None
    error: str | None = None


class ReleasePlanningRunOut(BaseModel):
    task_id: str
    status: str
    released: PlanningRunOut


class LaunchedAgentOut(BaseModel):
    target_id: str
    agent: str
    agent_run_id: str


class _RootApi:
    def __init__(self, api_client: ApiClient | None = None) -> None:
        self.api_client = api_client or ApiClient.get_default()

    @property
    def _host(self) -> str:
        host = self.api_client.configuration.host.rstrip("/")
        suffix = "/work-tracker"
        return host[: -len(suffix)] if host.endswith(suffix) else host

    def _request(
        self,
        method: str,
        path: str,
        *,
        path_params: dict[str, str | UUID],
        body: dict[str, Any] | None,
        success_status: int,
    ) -> Any:
        request = self.api_client.param_serialize(
            method=method,
            resource_path=path,
            path_params=path_params,
            header_params={
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
            body=body,
            auth_settings=["ApiKeyAuth"],
            collection_formats={},
            _host=self._host,
        )
        response = self.api_client.call_api(*request)
        response.read()
        response_types = {
            str(success_status): "object",
            "4XX": "object",
            "5XX": "object",
        }
        return self.api_client.response_deserialize(
            response_data=response,
            response_types_map=response_types,
        ).data


class ExecutionApi(_RootApi):
    """Generated-client extension for root-mounted execution operations."""

    def get_dependency_graph(self, root_id: str | UUID) -> DependencyGraphOut:
        data = self._request(
            "GET",
            "/work-items/{root_id}/dependency-graph",
            path_params={"root_id": root_id},
            body=None,
            success_status=200,
        )
        return DependencyGraphOut.model_validate(data)

    def execute_graph(self, root_id: str | UUID, agent: str | None = None) -> GraphOut:
        data = self._request(
            "POST",
            "/work-items/{root_id}/execute-graph",
            path_params={"root_id": root_id},
            body={} if agent is None else {"agent": agent},
            success_status=201,
        )
        return GraphOut.model_validate(data)

    def reset_graph(self, root_id: str | UUID) -> GraphOut:
        data = self._request(
            "DELETE",
            "/work-items/{root_id}/execute-graph",
            path_params={"root_id": root_id},
            body=None,
            success_status=200,
        )
        return GraphOut.model_validate(data)

    def generate_leaf_llds(
        self, root_id: str | UUID, agent: str | None = None
    ) -> GenerateLeafLldsOut:
        data = self._request(
            "POST",
            "/work-items/{root_id}/generate-leaf-llds",
            path_params={"root_id": root_id},
            body={} if agent is None else {"agent": agent},
            success_status=201,
        )
        return GenerateLeafLldsOut.model_validate(data)

    def release_planning_run(self, task_id: str | UUID) -> ReleasePlanningRunOut:
        data = self._request(
            "DELETE",
            "/work-items/{task_id}/planning-run",
            path_params={"task_id": task_id},
            body=None,
            success_status=200,
        )
        return ReleasePlanningRunOut.model_validate(data)


class LaunchApi(_RootApi):
    """Generated-client extension for the root-mounted direct launch."""

    def default_coding_agent(
        self, target_id: str | UUID, agent: str | None = None
    ) -> LaunchedAgentOut:
        data = self._request(
            "POST",
            "/work-items/{target_id}/launch-agent",
            path_params={"target_id": target_id},
            body={} if agent is None else {"agent": agent},
            success_status=201,
        )
        return LaunchedAgentOut.model_validate(data)
