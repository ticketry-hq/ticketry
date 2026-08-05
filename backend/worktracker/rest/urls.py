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
    WorkspaceRetrieveView,
)
from worktracker.rest.domain_ops import (
    AcknowledgeOnboardingView,
    IssueTypeReorderView,
    RemoveStateFromWorkflowView,
    StateReorderView,
    WorkItemReorderView,
)
from worktracker.rest.work_items import (
    AttachmentCollectionView,
    WorkItemCreateView,
    WorkItemDetailView,
    WorkItemListView,
)


app_name = "worktracker-rest"


@extend_schema_view(get=extend_schema(exclude=True))
class WorkTrackerSchemaView(SpectacularAPIView):
    pass

provider_collection = ProviderViewSet.as_view({"get": "list", "post": "create"})
provider_detail = ProviderViewSet.as_view(
    {"patch": "partial_update", "delete": "destroy"}
)
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
module_collection = ModuleViewSet.as_view({"get": "list", "post": "create"})

urlpatterns = [
    path("schema", WorkTrackerSchemaView.as_view(), name="schema"),
    path("workspace", WorkspaceRetrieveView.as_view(), name="workspace-retrieve"),
    path(
        "workspace/onboarding/acknowledge",
        AcknowledgeOnboardingView.as_view(),
        name="workspace-onboarding-acknowledge",
    ),
    path("projects", project_collection, name="project-list"),
    path("projects/<uuid:project_id>", project_detail, name="project-detail"),
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
        StateReorderView.as_view(),
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
        IssueTypeTransitionListView.as_view(),
        name="issue-type-transition-list",
    ),
    path(
        "issue-types/<uuid:type_id>/transitions/"
        "<uuid:from_state_id>/<uuid:to_state_id>",
        IssueTypeTransitionDetailView.as_view(),
        name="issue-type-transition-detail",
    ),
    path(
        "issue-types/<uuid:type_id>/workflow-settings/states/<uuid:state_id>",
        RemoveStateFromWorkflowView.as_view(),
        name="remove-state-from-workflow",
    ),
    path(
        "projects/<uuid:project_id>/issue-types/reorder",
        IssueTypeReorderView.as_view(),
        name="issue-type-reorder",
    ),
    path("work-items", WorkItemListView.as_view(), name="work-item-list"),
    path(
        "projects/<uuid:project_id>/work-items",
        WorkItemCreateView.as_view(),
        name="work-item-create",
    ),
    path(
        "work-items/<str:issue_id>/attachments",
        AttachmentCollectionView.as_view(),
        name="work-item-attachment-list",
    ),
    path(
        "work-items/<uuid:issue_id>/reorder",
        WorkItemReorderView.as_view(),
        name="work-item-reorder",
    ),
    path(
        "work-items/<str:issue_id>",
        WorkItemDetailView.as_view(),
        name="work-item-detail",
    ),
    path("providers", provider_collection, name="provider-list"),
    path("providers/<uuid:id>", provider_detail, name="provider-detail"),
    path("models", model_collection, name="model-list"),
    path("models/<uuid:id>", model_detail, name="model-detail"),
    path(
        "projects/<uuid:project_id>/launch-bindings",
        LaunchBindingListView.as_view(),
        name="launch-binding-list",
    ),
    path(
        "issue-types/<uuid:type_id>/workflow-settings/launch-bindings/<uuid:state_id>",
        LaunchBindingDetailView.as_view(),
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
