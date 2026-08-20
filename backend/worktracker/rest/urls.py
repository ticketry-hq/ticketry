"""Canonical WorkTracker routes implemented with Django REST Framework."""

from django.urls import path
from drf_spectacular.utils import extend_schema, extend_schema_view
from drf_spectacular.views import SpectacularAPIView

from worktracker.rest.views import (
    AgentModelViewSet,
    LaunchBindingDetailView,
    LaunchBindingListView,
    ModuleViewSet,
    IssueTypeTransitionDetailView,
    IssueTypeTransitionListView,
    IssueTypeViewSet,
    ProviderViewSet,
    ProjectViewSet,
    ReasoningLevelViewSet,
    StateViewSet,
)
from worktracker.rest.work_items import (
    AttachmentViewSet,
    WorkItemViewSet,
)


app_name = "worktracker-rest"


@extend_schema_view(get=extend_schema(exclude=True))
class WorkTrackerSchemaView(SpectacularAPIView):
    pass


provider_collection = ProviderViewSet.as_view({"get": "list"})
provider_detail = ProviderViewSet.as_view({"patch": "partial_update"})
model_collection = AgentModelViewSet.as_view({"get": "list", "post": "create"})
model_detail = AgentModelViewSet.as_view(
    {"patch": "partial_update", "delete": "destroy"}
)
reasoning_level_collection = ReasoningLevelViewSet.as_view(
    {"get": "list", "post": "create"}
)
reasoning_level_detail = ReasoningLevelViewSet.as_view(
    {"patch": "partial_update", "delete": "destroy"}
)
state_collection = StateViewSet.as_view({"get": "list", "post": "create"})
state_detail = StateViewSet.as_view({"patch": "partial_update", "delete": "destroy"})
issue_type_collection = IssueTypeViewSet.as_view({"get": "list", "post": "create"})
issue_type_detail = IssueTypeViewSet.as_view(
    {"get": "retrieve", "patch": "partial_update", "delete": "destroy"}
)
project_collection = ProjectViewSet.as_view({"get": "list", "post": "create"})
project_detail = ProjectViewSet.as_view(
    {"patch": "partial_update", "delete": "destroy"}
)
project_onboarding_acknowledge = ProjectViewSet.as_view(
    {"post": "acknowledge_onboarding"}
)
module_collection = ModuleViewSet.as_view({"get": "list", "post": "create"})
issue_type_transition_collection = IssueTypeTransitionListView.as_view(
    {"get": "list", "post": "create"}
)
issue_type_transition_detail = IssueTypeTransitionDetailView.as_view(
    {"patch": "update", "delete": "destroy"}
)
launch_binding_list = LaunchBindingListView.as_view({"get": "list"})
launch_binding_detail = LaunchBindingDetailView.as_view(
    {"put": "update", "delete": "destroy"}
)
state_reorder = StateViewSet.as_view({"post": "reorder"})
issue_type_reorder = IssueTypeViewSet.as_view({"post": "reorder"})
remove_state_from_workflow = IssueTypeViewSet.as_view(
    {"delete": "remove_state"}
)
work_item_collection = WorkItemViewSet.as_view({"get": "list"})
work_item_batch = WorkItemViewSet.as_view({"post": "batch"})
work_item_create = WorkItemViewSet.as_view({"post": "create"})
work_item_detail = WorkItemViewSet.as_view(
    {"get": "retrieve", "patch": "partial_update", "delete": "destroy"}
)
work_item_attachments = AttachmentViewSet.as_view(
    {"get": "list", "post": "create"}
)
work_item_reorder = WorkItemViewSet.as_view({"post": "reorder"})

urlpatterns = [
    path("schema", WorkTrackerSchemaView.as_view(), name="schema"),
    path("projects", project_collection, name="project-list"),
    path("projects/<uuid:project_id>", project_detail, name="project-detail"),
    path(
        "projects/<uuid:project_id>/onboarding/acknowledge",
        project_onboarding_acknowledge,
        name="project-onboarding-acknowledge",
    ),
    path(
        "projects/<uuid:project_id>/modules",
        module_collection,
        name="module-list",
    ),
    path(
        "projects/<uuid:project_id>/states",
        state_collection,
        name="state-list",
    ),
    path("states/<uuid:state_id>", state_detail, name="state-detail"),
    path(
        "projects/<uuid:project_id>/states/reorder",
        state_reorder,
        name="state-reorder",
    ),
    path(
        "projects/<uuid:project_id>/issue-types",
        issue_type_collection,
        name="issue-type-list",
    ),
    path(
        "issue-types/<uuid:type_id>",
        issue_type_detail,
        name="issue-type-detail",
    ),
    path(
        "issue-types/<uuid:type_id>/transitions",
        issue_type_transition_collection,
        name="issue-type-transition-list",
    ),
    path(
        "issue-types/<uuid:type_id>/transitions/"
        "<uuid:from_state_id>/<uuid:to_state_id>",
        issue_type_transition_detail,
        name="issue-type-transition-detail",
    ),
    path(
        "issue-types/<uuid:type_id>/workflow-settings/states/<uuid:state_id>",
        remove_state_from_workflow,
        name="remove-state-from-workflow",
    ),
    path(
        "projects/<uuid:project_id>/issue-types/reorder",
        issue_type_reorder,
        name="issue-type-reorder",
    ),
    path("work-items", work_item_collection, name="work-item-list"),
    path("work-items/batch", work_item_batch, name="work-item-batch"),
    path(
        "projects/<uuid:project_id>/work-items",
        work_item_create,
        name="work-item-create",
    ),
    path(
        "work-items/<str:issue_id>/attachments",
        work_item_attachments,
        name="work-item-attachment-list",
    ),
    path(
        "work-items/<uuid:issue_id>/reorder",
        work_item_reorder,
        name="work-item-reorder",
    ),
    path(
        "work-items/<str:issue_id>",
        work_item_detail,
        name="work-item-detail",
    ),
    path("providers", provider_collection, name="provider-list"),
    path("providers/<uuid:id>", provider_detail, name="provider-detail"),
    path("models", model_collection, name="model-list"),
    path("models/<uuid:id>", model_detail, name="model-detail"),
    path(
        "projects/<uuid:project_id>/launch-bindings",
        launch_binding_list,
        name="launch-binding-list",
    ),
    path(
        "issue-types/<uuid:type_id>/workflow-settings/launch-bindings/<uuid:state_id>",
        launch_binding_detail,
        name="launch-binding-detail",
    ),
    path(
        "reasoning-levels",
        reasoning_level_collection,
        name="reasoning-level-list",
    ),
    path(
        "reasoning-levels/<uuid:id>",
        reasoning_level_detail,
        name="reasoning-level-detail",
    ),
]
