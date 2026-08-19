"""Compatibility operations sharing the complete generated SDK transport.

The response models intentionally live here rather than reusing the legacy
hand-written resource models: this is the contract-phase surface that remains
when the legacy client and its models are removed.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel

from worktracker_sdk.generated.api_client import ApiClient


class ExecuteGraphOut(BaseModel):
    root_id: str
    launched: list[str]


class ResetGraphOut(BaseModel):
    root_id: str
    cleared: list[str]


class DependencyGraphNodeOut(BaseModel):
    id: str
    state: str
    parent_id: str | None = None
    blocked_by: list[str]


class DependencyGraphOut(BaseModel):
    root_id: str
    nodes: list[DependencyGraphNodeOut]


class LaunchedAgentOut(BaseModel):
    target_id: str
    agent: str
    agent_run_id: str


class CommittedStateOut(BaseModel):
    id: str
    name: str


class RunNowOut(BaseModel):
    target_id: str
    committed_state: CommittedStateOut
    run: LaunchedAgentOut


class _RootApi:
    def __init__(self, api_client: ApiClient | None = None) -> None:
        self.api_client = api_client or ApiClient.get_default()

    @property
    def _host(self) -> str:
        return self.api_client.configuration.host.rstrip("/")

    def _request(
        self,
        method: str,
        path: str,
        *,
        path_params: dict[str, str | UUID],
        body: dict[str, Any] | None,
        success_status: int,
        headers: dict[str, str] | None = None,
        error_type: str = "object",
    ) -> Any:
        request = self.api_client.param_serialize(
            method=method,
            resource_path=path,
            path_params=path_params,
            header_params={
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if body is not None else {}),
                **(headers or {}),
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
            "4XX": error_type,
            "5XX": error_type,
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
            "/work-tracker/work-items/{root_id}/graph-run",
            path_params={"root_id": root_id},
            body=None,
            success_status=200,
        )
        return DependencyGraphOut.model_validate(data)

    def execute_graph(
        self,
        root_id: str | UUID,
        agent: str | None = None,
        mode: str | None = None,
    ) -> ExecuteGraphOut:
        """Arm a graph run; an omitted ``mode`` stays parallel on the wire."""

        body: dict[str, Any] = {}
        if agent is not None:
            body["agent"] = agent
        if mode is not None:
            body["mode"] = mode
        data = self._request(
            "POST",
            "/work-tracker/work-items/{root_id}/graph-run",
            path_params={"root_id": root_id},
            body=body,
            success_status=201,
        )
        return ExecuteGraphOut.model_validate(data)

    def reset_graph(self, root_id: str | UUID) -> ResetGraphOut:
        data = self._request(
            "DELETE",
            "/work-tracker/work-items/{root_id}/graph-run",
            path_params={"root_id": root_id},
            body=None,
            success_status=200,
        )
        return ResetGraphOut.model_validate(data)

    def run_now(
        self,
        target_id: str | UUID,
        *,
        origin: str,
        authorization: str | None = None,
    ) -> RunNowOut:
        data = self._request(
            "POST",
            "/work-tracker/work-items/{target_id}/run-now",
            path_params={"target_id": target_id},
            body={"origin": origin},
            success_status=201,
            error_type="RunNowRefusal",
            headers=(
                {"Authorization": authorization}
                if authorization is not None
                else None
            ),
        )
        return RunNowOut.model_validate(data)


class LaunchApi(_RootApi):
    """Generated-client extension for the root-mounted direct launch."""

    def default_coding_agent(
        self, target_id: str | UUID, agent: str | None = None
    ) -> LaunchedAgentOut:
        data = self._request(
            "POST",
            "/work-tracker/work-items/{target_id}/launch-agent",
            path_params={"target_id": target_id},
            body={} if agent is None else {"agent": agent},
            success_status=201,
        )
        return LaunchedAgentOut.model_validate(data)


class RevisionedDeleteApi(_RootApi):
    """DELETE bodies retained by DRF but not emitted by OpenAPI Generator."""

    @property
    def _host(self) -> str:
        return self.api_client.configuration.host.rstrip("/")

    def _delete_with_revision(
        self,
        path: str,
        *,
        path_params: dict[str, str | UUID],
        workflow_revision: int,
    ) -> None:
        request = self.api_client.param_serialize(
            method="DELETE",
            resource_path=path,
            path_params=path_params,
            header_params={
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            body={"workflow_revision": workflow_revision},
            auth_settings=["ApiKeyAuth"],
            collection_formats={},
            _host=self._host,
        )
        response = self.api_client.call_api(*request)
        response.read()

    def delete_transition(
        self,
        type_id: str | UUID,
        from_state_id: str | UUID,
        to_state_id: str | UUID,
        workflow_revision: int,
    ) -> None:
        self._delete_with_revision(
            "/work-tracker/issue-types/{type_id}/transitions/{from_state_id}/{to_state_id}",
            path_params={
                "type_id": type_id,
                "from_state_id": from_state_id,
                "to_state_id": to_state_id,
            },
            workflow_revision=workflow_revision,
        )

    def delete_launch_binding(
        self,
        type_id: str | UUID,
        state_id: str | UUID,
        workflow_revision: int,
    ) -> None:
        self._delete_with_revision(
            "/work-tracker/issue-types/{type_id}/workflow-settings/launch-bindings/{state_id}",
            path_params={"type_id": type_id, "state_id": state_id},
            workflow_revision=workflow_revision,
        )
