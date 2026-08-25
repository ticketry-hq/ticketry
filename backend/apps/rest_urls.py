"""Complete host-level DRF URL surface."""

from django.urls import path
from rest_framework.permissions import AllowAny

from apps import rest_api
from apps.documents.rest_views import DocumentViewSet
from apps.execution.rest_authentication import RunNowAuthentication
from apps.execution.rest_views import GraphRunViewSet, WorkItemExecutionViewSet
from apps.runs.rest_views import AutomationAttemptViewSet, RunViewSet
from apps.settings_store.rest_views import (
    KeybindingsViewSet,
    ModuleLinkViewSet,
    SettingsViewSet,
)
from apps.source_control.commit_views import (
    ModuleCommitViewSet,
    WorktreeCommitViewSet,
)
from apps.source_control.pull_request_views import (
    ModulePullRequestViewSet,
    WorktreePullRequestViewSet,
)
from apps.source_control.push_views import ModulePushViewSet, WorktreePushViewSet
from apps.source_control.rest_views import (
    ModuleChangesViewSet,
    WorktreeChangesViewSet,
)
from apps.source_control.ship_record_views import (
    ModuleShipRecordViewSet,
    TaskShipRecordViewSet,
)
from apps.system_rest import SystemViewSet
from apps.terminals.rest_authentication import RunScopedAuthentication
from apps.terminals.rest_views import TerminalViewSet
from apps.worktrees.rest_views import WorktreeRecordViewSet, WorktreeViewSet


health = SystemViewSet.as_view({"get": "health"})
lifecycle_events = RunViewSet.as_view({"post": "lifecycle_events"})
automation_attempt_retry = AutomationAttemptViewSet.as_view({"post": "retry"})
terminal_collection = TerminalViewSet.as_view(
    {"get": "list", "post": "create", "delete": "terminate"}
)
terminal_resume = TerminalViewSet.as_view({"post": "resume"})
terminal_resumable = TerminalViewSet.as_view({"get": "resumable"})
terminal_scratch = TerminalViewSet.as_view({"get": "scratch"})
terminal_shells = TerminalViewSet.as_view(
    {"get": "list_shells", "post": "create_shell"}
)
terminal_viewer_lease = TerminalViewSet.as_view({"post": "acquire_viewer_lease"})
terminal_viewer_lease_renew = TerminalViewSet.as_view(
    {"post": "renew_viewer_lease"}
)
terminal_viewer_lease_release = TerminalViewSet.as_view(
    {"post": "release_viewer_lease"}
)
terminal_viewer_output = TerminalViewSet.as_view({"post": "report_viewer_output"})
terminal_self_terminate = TerminalViewSet.as_view(
    {"post": "self_terminate"},
    authentication_classes=[RunScopedAuthentication],
)
document_asset = DocumentViewSet.as_view(
    {"get": "asset"},
    authentication_classes=[],
    permission_classes=[AllowAny],
)
documents = DocumentViewSet.as_view({"get": "list"})
document_save = DocumentViewSet.as_view({"put": "update"})
filesystem_complete = DocumentViewSet.as_view({"get": "complete"})
settings_keybindings = KeybindingsViewSet.as_view({"get": "retrieve", "put": "update"})
module_folder_validation = SettingsViewSet.as_view({"post": "validate_folder"})
module_link_collection = ModuleLinkViewSet.as_view({"get": "list"})
module_link_detail = ModuleLinkViewSet.as_view(
    {"put": "update", "delete": "destroy"}
)
worktree_status = WorktreeViewSet.as_view({"get": "status"})
worktree_records = WorktreeRecordViewSet.as_view({"get": "list"})
module_worktrees = WorktreeViewSet.as_view({"get": "module_worktrees"})
module_ship_records = ModuleShipRecordViewSet.as_view({"get": "list"})
ship_record_pr_state_refresh = ModuleShipRecordViewSet.as_view(
    {"post": "refresh_pr_state"}
)
task_ship_records = TaskShipRecordViewSet.as_view({"get": "list"})
worktree_changes = WorktreeChangesViewSet.as_view({"get": "changes"})
worktree_file_diff = WorktreeChangesViewSet.as_view({"get": "file_diff"})
worktree_commit = WorktreeCommitViewSet.as_view({"post": "commit"})
worktree_commit_push = WorktreePushViewSet.as_view({"post": "commit_push"})
worktree_push_preview = WorktreePushViewSet.as_view({"get": "push_preview"})
worktree_commit_push_pr = WorktreePullRequestViewSet.as_view(
    {"post": "commit_push_pr"}
)
worktree_pull_request = WorktreePullRequestViewSet.as_view(
    {"post": "pull_request"}
)
module_changes = ModuleChangesViewSet.as_view({"get": "changes"})
module_file_diff = ModuleChangesViewSet.as_view({"get": "file_diff"})
module_commit = ModuleCommitViewSet.as_view({"post": "commit"})
module_commit_push = ModulePushViewSet.as_view({"post": "commit_push"})
module_push_preview = ModulePushViewSet.as_view({"get": "push_preview"})
module_commit_push_pr = ModulePullRequestViewSet.as_view(
    {"post": "commit_push_pr"}
)
module_pull_request = ModulePullRequestViewSet.as_view({"post": "pull_request"})
worktree_create = WorktreeViewSet.as_view({"post": "create_worktree"})
worktree_discard = WorktreeViewSet.as_view({"post": "discard"})
graph_run = GraphRunViewSet.as_view(
    {
        "get": "retrieve_graph",
        "post": "create_graph",
        "delete": "reset_graph",
    }
)
run_now = WorkItemExecutionViewSet.as_view(
    {"post": "run_now"},
    authentication_classes=[RunNowAuthentication],
)
launch_agent = WorkItemExecutionViewSet.as_view({"post": "launch_agent"})


urlpatterns = [
    path("healthz", health, name="health"),
    path("settings/keybindings", settings_keybindings, name="keybindings"),
    path("module-links", module_link_collection, name="module-link-list"),
    path(
        "module-links/<uuid:module_id>",
        module_link_detail,
        name="module-link-detail",
    ),
    path(
        "settings/provider-catalog",
        rest_api.ProviderCatalogView.as_view(),
        name="provider-catalog",
    ),
    path(
        "config/folders/validate",
        module_folder_validation,
        name="module-folder-validate",
    ),
    path(
        "automation-attempts/<str:attempt_id>/retry",
        automation_attempt_retry,
        name="automation-retry",
    ),
    path("lifecycle/events", lifecycle_events, name="lifecycle-events"),
    path(
        "terminals/viewers/lease",
        terminal_viewer_lease,
        name="viewer-lease",
    ),
    path(
        "terminals/viewers/lease/renew",
        terminal_viewer_lease_renew,
        name="viewer-lease-renew",
    ),
    path(
        "terminals/viewers/lease/release",
        terminal_viewer_lease_release,
        name="viewer-lease-release",
    ),
    path(
        "terminals/viewers/output",
        terminal_viewer_output,
        name="viewer-output",
    ),
    path("terminals", terminal_collection, name="terminal-list"),
    path(
        "terminals/resume",
        terminal_resume,
        name="terminal-resume",
    ),
    path(
        "terminals/resumable",
        terminal_resumable,
        name="terminal-resumable",
    ),
    path(
        "terminals/scratch",
        terminal_scratch,
        name="terminal-scratch",
    ),
    path(
        "terminals/shells",
        terminal_shells,
        name="terminal-shells",
    ),
    path(
        "terminals/self-terminate",
        terminal_self_terminate,
        name="terminal-self-terminate",
    ),
    path("documents", documents, name="documents"),
    path("docs/<str:doc_id>", document_save, name="document-save"),
    path("docs/<str:doc_id>/<path:asset_path>", document_asset, name="document-asset"),
    path("fs/complete", filesystem_complete, name="fs-complete"),
    path("worktrees", worktree_status, name="worktree"),
    path("worktrees/records", worktree_records, name="worktree-record-list"),
    path("worktrees/changes", worktree_changes, name="worktree-changes"),
    path(
        "worktrees/changes/file-diff",
        worktree_file_diff,
        name="worktree-file-diff",
    ),
    path("worktrees/changes/commit", worktree_commit, name="worktree-commit"),
    path(
        "worktrees/changes/commit-push",
        worktree_commit_push,
        name="worktree-commit-push",
    ),
    path(
        "worktrees/changes/push-preview",
        worktree_push_preview,
        name="worktree-push-preview",
    ),
    path(
        "worktrees/changes/commit-push-pr",
        worktree_commit_push_pr,
        name="worktree-commit-push-pr",
    ),
    path(
        "worktrees/changes/pull-request",
        worktree_pull_request,
        name="worktree-pull-request",
    ),
    path("modules/changes", module_changes, name="module-changes"),
    path(
        "modules/changes/file-diff",
        module_file_diff,
        name="module-file-diff",
    ),
    path("modules/changes/commit", module_commit, name="module-commit"),
    path(
        "modules/changes/commit-push",
        module_commit_push,
        name="module-commit-push",
    ),
    path(
        "modules/changes/push-preview",
        module_push_preview,
        name="module-push-preview",
    ),
    path(
        "modules/changes/commit-push-pr",
        module_commit_push_pr,
        name="module-commit-push-pr",
    ),
    path(
        "modules/changes/pull-request",
        module_pull_request,
        name="module-pull-request",
    ),
    path(
        "work-tracker/projects/<uuid:project_id>/modules/<uuid:module_id>/worktrees",
        module_worktrees,
        name="module-worktrees",
    ),
    path(
        "work-tracker/projects/<uuid:project_id>/modules/<uuid:module_id>/ship-records",
        module_ship_records,
        name="module-ship-records",
    ),
    path(
        "work-tracker/projects/<uuid:project_id>/modules/<uuid:module_id>/"
        "ship-records/<uuid:record_id>/refresh-pr-state",
        ship_record_pr_state_refresh,
        name="ship-record-pr-state-refresh",
    ),
    path(
        "work-tracker/projects/<uuid:project_id>/work-items/"
        "<uuid:task_id>/ship-records",
        task_ship_records,
        name="task-ship-records",
    ),
    path(
        "worktrees/<str:task_id>/create",
        worktree_create,
        name="worktree-create",
    ),
    path(
        "worktrees/<str:task_id>/discard",
        worktree_discard,
        name="worktree-discard",
    ),
    path(
        "work-tracker/work-items/<str:issue_id>/graph-run",
        graph_run,
        name="graph-run",
    ),
    path(
        "work-tracker/work-items/<str:issue_id>/launch-agent",
        launch_agent,
        name="launch-agent",
    ),
    path(
        "work-tracker/work-items/<str:issue_id>/run-now",
        run_now,
        name="run-now",
    ),
]
