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
    path("runs/module-activity", rest_api.ModuleActivityView.as_view(), name="module-activity"),
    path("runs/authorization", rest_api.RunAuthorizationView.as_view(), name="run-authorization"),
    path("runs/mcp-authorize", rest_api.RunPrincipalView.as_view(), name="run-mcp-authorize"),
    path("documents", rest_api.DocumentsView.as_view(), name="documents"),
    path("docs/<str:doc_id>", rest_api.DocumentSaveView.as_view(), name="document-save"),
    path("docs/<str:doc_id>/<path:asset_path>", rest_api.DocumentAssetView.as_view(), name="document-asset"),
    path("fs/complete", rest_api.FsCompleteView.as_view(), name="fs-complete"),
    path("worktrees", rest_api.WorktreeView.as_view(), name="worktree"),
    path("worktrees/<str:task_id>/create", rest_api.WorktreeCreateView.as_view(), name="worktree-create"),
    path("worktrees/<str:task_id>/discard", rest_api.WorktreeDiscardView.as_view(), name="worktree-discard"),
]
