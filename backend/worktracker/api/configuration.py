import uuid
from typing import Dict, List, Optional

from django.shortcuts import get_object_or_404
from ninja import Status

from worktracker.api.router import _http_errors, router
from worktracker.launch_capabilities import capabilities_payload
from worktracker.models import IssueType, Project, State
from worktracker.schemas import (
    AddWorkflowTransitionIn,
    IssueTypeIn,
    IssueTypeOut,
    IssueTypePatch,
    LaunchBindingOut,
    ProviderCapabilitiesOut,
    ReorderIn,
    StateIn,
    StateImpactOut,
    StateOut,
    StatePatch,
    ScopedLaunchBindingIn,
    ScopedWorkflowImpactIn,
    ScopedWorkflowImpactOut,
    ScopedWorkflowOut,
    SetWorkflowAutoStartIn,
    SetWorkflowSubtreeRunIn,
    SetWorkflowStartStateIn,
    SetWorkflowTransitionPermissionIn,
    WorkflowRevisionIn,
)
from worktracker.services import (
    launch_bindings,
    scoped_workflows,
    workflow_config,
)


@router.get(
    "/projects/{project_id}/states",
    response=List[StateOut],
    operation_id="listStates",
    tags=["States"],
)
def list_states(request, project_id: uuid.UUID):
    """List the project's workflow states, ordered by ``(sort_order, created_at)``."""
    return State.objects.filter(project_id=project_id).order_by(
        "sort_order", "created_at"
    )


@router.get(
    "/projects/{project_id}/issue-types",
    response=List[IssueTypeOut],
    operation_id="listIssueTypes",
    tags=["IssueTypes"],
)
def list_issue_types(request, project_id: uuid.UUID):
    """List a project's issue types, ordered by ``(sort_order, created_at)``."""

    get_object_or_404(Project, pk=project_id)
    return IssueType.objects.filter(project_id=project_id).order_by(
        "sort_order", "created_at"
    )


@router.post(
    "/projects/{project_id}/issue-types",
    response=IssueTypeOut,
    operation_id="createIssueType",
    tags=["IssueTypes"],
)
def create_issue_type(request, project_id: uuid.UUID, payload: IssueTypeIn):
    """Create an issue type at the tail of its level's order."""

    with _http_errors():
        return workflow_config.create_issue_type(
            project_id,
            name=payload.name,
            level=payload.level,
            color=payload.color,
        )


@router.patch(
    "/issue-types/{type_id}",
    response=IssueTypeOut,
    operation_id="updateIssueType",
    tags=["IssueTypes"],
)
def patch_issue_type(request, type_id: uuid.UUID, payload: IssueTypePatch):
    """Rename, recolor, or reorder an issue type."""

    with _http_errors():
        return workflow_config.update_issue_type(
            type_id, payload.dict(exclude_unset=True)
        )


@router.delete(
    "/issue-types/{type_id}",
    response={204: None},
    operation_id="deleteIssueType",
    tags=["IssueTypes"],
)
def delete_issue_type(
    request, type_id: uuid.UUID, reassign_to: Optional[uuid.UUID] = None
):
    """Delete a type; 409 if it is in use without ``reassign_to``."""

    with _http_errors():
        workflow_config.delete_issue_type(type_id, reassign_to)
    return Status(204, None)


@router.post(
    "/projects/{project_id}/issue-types/reorder",
    response=List[IssueTypeOut],
    operation_id="reorderIssueTypes",
    tags=["IssueTypes"],
)
def reorder_issue_types(request, project_id: uuid.UUID, payload: ReorderIn):
    """Rewrite every type's ``sort_order`` from the given full id order."""

    with _http_errors():
        return workflow_config.reorder_issue_types(project_id, payload.ordered_ids)


@router.post(
    "/projects/{project_id}/states",
    response=StateOut,
    operation_id="createState",
    tags=["States"],
)
def create_state(request, project_id: uuid.UUID, payload: StateIn):
    """Create a state in one of the five groups at the tail of the order."""

    with _http_errors():
        return workflow_config.create_state(
            project_id,
            name=payload.name,
            group=payload.group,
            color=payload.color,
        )


@router.patch(
    "/states/{state_id}",
    response=StateOut,
    operation_id="updateState",
    tags=["States"],
)
def patch_state(request, state_id: uuid.UUID, payload: StatePatch):
    """Rename / recolor / reorder a state, or move it among the five groups."""

    with _http_errors():
        return workflow_config.update_state(state_id, payload.dict(exclude_unset=True))


@router.get(
    "/states/{state_id}/impact",
    response=StateImpactOut,
    operation_id="getStateImpact",
    tags=["States"],
)
def get_state_impact(request, state_id: uuid.UUID):
    """Preview work-item, workflow, and protection consequences of deletion."""

    with _http_errors():
        return workflow_config.get_state_impact(state_id)


@router.delete(
    "/states/{state_id}",
    response={204: None},
    operation_id="deleteState",
    tags=["States"],
)
def delete_state(
    request,
    state_id: uuid.UUID,
    reassign_to: Optional[uuid.UUID] = None,
    impact_token: Optional[str] = None,
):
    """Delete a state, atomically replacing all confirmed references when needed."""

    with _http_errors():
        workflow_config.delete_state(state_id, reassign_to, impact_token)
    return Status(204, None)


@router.post(
    "/projects/{project_id}/states/reorder",
    response=List[StateOut],
    operation_id="reorderStates",
    tags=["States"],
)
def reorder_states(request, project_id: uuid.UUID, payload: ReorderIn):
    """Rewrite every state's ``sort_order`` from the given full id order."""

    with _http_errors():
        return workflow_config.reorder_states(project_id, payload.ordered_ids)


@router.get(
    "/issue-types/{type_id}/workflow-settings",
    response=ScopedWorkflowOut,
    operation_id="getIssueTypeWorkflowSettings",
    tags=["Workflows"],
)
def get_issue_type_workflow_settings(request, type_id: uuid.UUID):
    with _http_errors():
        return scoped_workflows.get_workflow(type_id)


@router.post(
    "/issue-types/{type_id}/workflow-settings/transitions",
    response=ScopedWorkflowOut,
    operation_id="addIssueTypeWorkflowTransition",
    tags=["Workflows"],
)
def add_issue_type_workflow_transition(
    request, type_id: uuid.UUID, payload: AddWorkflowTransitionIn
):
    with _http_errors():
        return scoped_workflows.add_transition(type_id, **payload.dict())


@router.patch(
    "/issue-types/{type_id}/workflow-settings/transitions/"
    "{from_state_id}/{to_state_id}",
    response=ScopedWorkflowOut,
    operation_id="setIssueTypeWorkflowTransitionPermission",
    tags=["Workflows"],
)
def set_issue_type_workflow_transition_permission(
    request,
    type_id: uuid.UUID,
    from_state_id: uuid.UUID,
    to_state_id: uuid.UUID,
    payload: SetWorkflowTransitionPermissionIn,
):
    with _http_errors():
        return scoped_workflows.set_transition_permission(
            type_id, from_state_id, to_state_id, **payload.dict()
        )


@router.delete(
    "/issue-types/{type_id}/workflow-settings/transitions/"
    "{from_state_id}/{to_state_id}",
    response=ScopedWorkflowOut,
    operation_id="removeIssueTypeWorkflowTransition",
    tags=["Workflows"],
)
def remove_issue_type_workflow_transition(
    request,
    type_id: uuid.UUID,
    from_state_id: uuid.UUID,
    to_state_id: uuid.UUID,
    payload: WorkflowRevisionIn,
):
    with _http_errors():
        return scoped_workflows.remove_transition(
            type_id, from_state_id, to_state_id, **payload.dict()
        )


@router.post(
    "/issue-types/{type_id}/workflow-settings/impact",
    response=ScopedWorkflowImpactOut,
    operation_id="previewIssueTypeWorkflowImpact",
    tags=["Workflows"],
)
def preview_issue_type_workflow_impact(
    request, type_id: uuid.UUID, payload: ScopedWorkflowImpactIn
):
    with _http_errors():
        return scoped_workflows.preview_impact(type_id, **payload.dict())


@router.delete(
    "/issue-types/{type_id}/workflow-settings/states/{state_id}",
    response=ScopedWorkflowOut,
    operation_id="removeIssueTypeWorkflowState",
    tags=["Workflows"],
)
def remove_issue_type_workflow_state(
    request,
    type_id: uuid.UUID,
    state_id: uuid.UUID,
    payload: WorkflowRevisionIn,
):
    with _http_errors():
        return scoped_workflows.remove_state(
            type_id, state_id, **payload.dict()
        )


@router.put(
    "/issue-types/{type_id}/workflow-settings/start-state",
    response=ScopedWorkflowOut,
    operation_id="setIssueTypeWorkflowStartState",
    tags=["Workflows"],
)
def set_issue_type_workflow_start_state(
    request, type_id: uuid.UUID, payload: SetWorkflowStartStateIn
):
    with _http_errors():
        return scoped_workflows.set_start_state(type_id, **payload.dict())


@router.put(
    "/issue-types/{type_id}/workflow-settings/launch-bindings/{state_id}",
    response=ScopedWorkflowOut,
    operation_id="upsertIssueTypeWorkflowLaunchBinding",
    tags=["Workflows"],
)
def upsert_issue_type_workflow_launch_binding(
    request,
    type_id: uuid.UUID,
    state_id: uuid.UUID,
    payload: ScopedLaunchBindingIn,
):
    with _http_errors():
        return scoped_workflows.upsert_launch_binding(
            type_id, state_id, **payload.dict()
        )


@router.delete(
    "/issue-types/{type_id}/workflow-settings/launch-bindings/{state_id}",
    response=ScopedWorkflowOut,
    operation_id="clearIssueTypeWorkflowLaunchBinding",
    tags=["Workflows"],
)
def clear_issue_type_workflow_launch_binding(
    request,
    type_id: uuid.UUID,
    state_id: uuid.UUID,
    payload: WorkflowRevisionIn,
):
    with _http_errors():
        return scoped_workflows.clear_launch_binding(
            type_id, state_id, **payload.dict()
        )


@router.patch(
    "/issue-types/{type_id}/workflow-settings/launch-bindings/"
    "{state_id}/auto-start",
    response=ScopedWorkflowOut,
    operation_id="setIssueTypeWorkflowAutoStart",
    tags=["Workflows"],
)
def set_issue_type_workflow_auto_start(
    request,
    type_id: uuid.UUID,
    state_id: uuid.UUID,
    payload: SetWorkflowAutoStartIn,
):
    with _http_errors():
        return scoped_workflows.set_auto_start(type_id, state_id, **payload.dict())


@router.put(
    "/issue-types/{type_id}/workflow-settings/launch-bindings/"
    "{state_id}/subtree-run",
    response=ScopedWorkflowOut,
    operation_id="setIssueTypeWorkflowSubtreeRun",
    tags=["Workflows"],
)
def set_issue_type_workflow_subtree_run(
    request,
    type_id: uuid.UUID,
    state_id: uuid.UUID,
    payload: SetWorkflowSubtreeRunIn,
):
    with _http_errors():
        return scoped_workflows.set_subtree_run(
            type_id, state_id, **payload.dict()
        )


@router.get(
    "/projects/{project_id}/launch-bindings",
    response=List[LaunchBindingOut],
    operation_id="listLaunchBindings",
    tags=["LaunchBindings"],
)
def list_project_launch_bindings(request, project_id: uuid.UUID):
    return launch_bindings.list_launch_bindings(project_id)


@router.get(
    "/projects/{project_id}/subtree-run-capabilities",
    response=Dict[str, List[uuid.UUID]],
    operation_id="listSubtreeRunCapabilities",
    tags=["Workflows"],
)
def list_subtree_run_capabilities(request, project_id: uuid.UUID):
    """Return enabled subtree-run states grouped by issue type."""

    get_object_or_404(Project, pk=project_id)
    return launch_bindings.subtree_run_capabilities(project_id)


@router.get(
    "/launch-bindings/provider-capabilities",
    response=List[ProviderCapabilitiesOut],
    operation_id="listLaunchProviderCapabilities",
    tags=["LaunchBindings"],
)
def list_launch_provider_capabilities(request):
    return capabilities_payload()
