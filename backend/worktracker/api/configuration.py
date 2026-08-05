import uuid

from worktracker.api.router import _http_errors, router
from worktracker.schemas import (
    AddWorkflowTransitionIn,
    ScopedWorkflowOut,
    SetWorkflowStartStateIn,
    SetWorkflowTransitionPermissionIn,
    WorkflowRevisionIn,
)
from worktracker.services import scoped_workflows


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
        return scoped_workflows.remove_state(type_id, state_id, **payload.dict())


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
