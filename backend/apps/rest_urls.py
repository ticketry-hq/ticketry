"""Complete host-level DRF URL surface."""

from django.urls import path

from apps import rest_api


urlpatterns = [
    path("healthz", rest_api.HealthView.as_view(), name="health"),
    path("settings/keybindings", rest_api.KeybindingsView.as_view(), name="keybindings"),
    path("settings/provider-catalog", rest_api.ProviderCatalogView.as_view(), name="provider-catalog"),
    path("config", rest_api.ConfigView.as_view(), name="config"),
    path("config/profiles", rest_api.ProfileCollectionView.as_view(), name="profile-list"),
    path("config/profiles/<int:index>", rest_api.ProfileDetailView.as_view(), name="profile-detail"),
    path("config/folders/validate", rest_api.ModuleFolderValidationView.as_view(), name="module-folder-validate"),
    path("automation-attempts/<str:attempt_id>/retry", rest_api.AutomationRetryView.as_view(), name="automation-retry"),
    path("lifecycle/events", rest_api.LifecycleEventView.as_view(), name="lifecycle-events"),
    path("runs/module-activity", rest_api.ModuleActivityView.as_view(), name="module-activity"),
    path("runs/agent-status", rest_api.AgentStatusView.as_view(), name="agent-status"),
    path("terminals/viewers/lease", rest_api.ViewerLeaseView.as_view(), name="viewer-lease"),
    path("terminals/viewers/lease/renew", rest_api.ViewerLeaseRenewView.as_view(), name="viewer-lease-renew"),
    path("terminals/viewers/lease/release", rest_api.ViewerLeaseReleaseView.as_view(), name="viewer-lease-release"),
    path("terminals/viewers/output", rest_api.ViewerOutputReportView.as_view(), name="viewer-output"),
    path("terminals", rest_api.TerminalCollectionView.as_view(), name="terminal-list"),
    path("terminals/resume", rest_api.TerminalResumeView.as_view(), name="terminal-resume"),
    path("terminals/resumable", rest_api.ResumableTerminalsView.as_view(), name="terminal-resumable"),
    path("terminals/scratch", rest_api.ScratchTerminalsView.as_view(), name="terminal-scratch"),
    path("terminals/shells", rest_api.ModuleShellCollectionView.as_view(), name="terminal-shells"),
    path("terminals/self-terminate", rest_api.SelfTerminateView.as_view(), name="terminal-self-terminate"),
    path("documents", rest_api.DocumentsView.as_view(), name="documents"),
    path("docs/<str:doc_id>", rest_api.DocumentSaveView.as_view(), name="document-save"),
    path("docs/<str:doc_id>/<path:asset_path>", rest_api.DocumentAssetView.as_view(), name="document-asset"),
    path("fs/complete", rest_api.FsCompleteView.as_view(), name="fs-complete"),
    path("worktrees", rest_api.WorktreeView.as_view(), name="worktree"),
    path("worktrees/<str:task_id>/create", rest_api.WorktreeCreateView.as_view(), name="worktree-create"),
    path("worktrees/<str:task_id>/discard", rest_api.WorktreeDiscardView.as_view(), name="worktree-discard"),
    path("work-tracker/work-items/<str:issue_id>/graph-run", rest_api.GraphRunView.as_view(), name="graph-run"),
    path("work-tracker/work-items/<str:issue_id>/launch-agent", rest_api.LaunchAgentView.as_view(), name="launch-agent"),
    path("work-tracker/work-items/<str:issue_id>/run-now", rest_api.RunNowView.as_view(), name="run-now"),
]
