"""Compatibility operations sharing the complete generated SDK transport.

The response models intentionally live here rather than reusing the legacy
hand-written resource models: this is the contract-phase surface that remains
when the legacy client and its models are removed.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from worktracker_sdk.generated.api_client import ApiClient


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
