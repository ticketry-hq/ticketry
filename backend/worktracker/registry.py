"""Canonical declaration of the live WorkTracker HTTP surface."""

from dataclasses import dataclass


@dataclass(frozen=True, order=True)
class RouteDeclaration:
    method: str
    path: str
    purpose: str

    @property
    def key(self):
        return self.method, self.path


MODEL_ROUTES = {
    "GraphRun": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/work-items/{issue_id}/graph-run",
                "Retrieve the factual dependency subtree for a graph-run root.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "POST",
                "/api/work-tracker/work-items/{issue_id}/graph-run",
                "Create and arm one graph-run header for a work-item root.",
            ),
            RouteDeclaration(
                "DELETE",
                "/api/work-tracker/work-items/{issue_id}/graph-run",
                "Reset one graph run by deleting its header and launch ledger.",
            ),
        ),
    },
    "LaunchAgent": {
        "reads": (),
        "writes": (
            RouteDeclaration(
                "POST",
                "/api/work-tracker/work-items/{issue_id}/launch-agent",
                "Launch one task-scoped coding agent for a work item.",
            ),
        ),
    },
    "Workspace": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/workspace",
                "Retrieve the installation workspace singleton.",
            ),
        ),
        "writes": (),
    },
    "Project": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/projects",
                "List projects in explicit creation order.",
            ),
        ),
        "writes": (
            RouteDeclaration("POST", "/api/work-tracker/projects", "Create a project."),
            RouteDeclaration(
                "PATCH",
                "/api/work-tracker/projects/{project_id}",
                "Update a project's mutable fields.",
            ),
            RouteDeclaration(
                "DELETE",
                "/api/work-tracker/projects/{project_id}",
                "Delete a project aggregate.",
            ),
        ),
    },
    "Module": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/projects/{project_id}/modules",
                "List a project's module rows in its Canonical module order.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "POST",
                "/api/work-tracker/projects/{project_id}/modules",
                "Create a module row.",
            ),
        ),
    },
    "State": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/projects/{project_id}/states",
                "List a project's states in explicit display order.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "POST",
                "/api/work-tracker/projects/{project_id}/states",
                "Create a state at the tail of the project order.",
            ),
            RouteDeclaration(
                "PATCH",
                "/api/work-tracker/states/{state_id}",
                "Update one state without changing its display rank.",
            ),
            RouteDeclaration(
                "DELETE",
                "/api/work-tracker/states/{state_id}",
                "Delete one empty, unreferenced, unprotected state.",
            ),
        ),
    },
    "IssueType": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/projects/{project_id}/issue-types",
                "List a project's issue types in explicit display order.",
            ),
            RouteDeclaration(
                "GET",
                "/api/work-tracker/issue-types/{type_id}",
                "Retrieve one issue type, including its start state and workflow revision.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "POST",
                "/api/work-tracker/projects/{project_id}/issue-types",
                "Create an issue type at the tail of its level order.",
            ),
            RouteDeclaration(
                "PATCH",
                "/api/work-tracker/issue-types/{type_id}",
                "Update mutable fields on one issue type.",
            ),
            RouteDeclaration(
                "DELETE",
                "/api/work-tracker/issue-types/{type_id}",
                "Delete an unused issue type or reassign its work items.",
            ),
        ),
    },
    "IssueTypeTransition": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/issue-types/{type_id}/transitions",
                "List one issue type's transitions in explicit state order.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "POST",
                "/api/work-tracker/issue-types/{type_id}/transitions",
                "Create one revision-guarded workflow transition.",
            ),
            RouteDeclaration(
                "PATCH",
                "/api/work-tracker/issue-types/{type_id}/transitions/{from_state_id}/{to_state_id}",
                "Update one transition's agent permission at the supplied revision.",
            ),
            RouteDeclaration(
                "DELETE",
                "/api/work-tracker/issue-types/{type_id}/transitions/{from_state_id}/{to_state_id}",
                "Delete one transition and prune disconnected workflow rows.",
            ),
        ),
    },
    "WorkItem": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/work-items",
                "List task work items with project, module, and state narrowing.",
            ),
            RouteDeclaration(
                "GET",
                "/api/work-tracker/work-items/{issue_id}",
                "Retrieve one bare work item by id or key.",
            ),
            RouteDeclaration(
                "POST",
                "/api/work-tracker/work-items/batch",
                "Retrieve up to one hundred bare work items by exact id.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "POST",
                "/api/work-tracker/projects/{project_id}/work-items",
                "Create a task or an absorbed review finding.",
            ),
            RouteDeclaration(
                "PATCH",
                "/api/work-tracker/work-items/{issue_id}",
                "Update a work item through its domain mutation service.",
            ),
            RouteDeclaration(
                "DELETE",
                "/api/work-tracker/work-items/{issue_id}",
                "Delete an empty work item.",
            ),
        ),
    },
    "Attachment": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/work-items/{issue_id}/attachments",
                "List one work item's attachments without re-reading the item.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "POST",
                "/api/work-tracker/work-items/{issue_id}/attachments",
                "Append an attachment to one work item.",
            ),
        ),
    },
    "Provider": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/providers",
                "List provider catalog rows in slug order.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "PATCH",
                "/api/work-tracker/providers/{id}",
                "Activate or deactivate one code-owned provider row.",
            ),
        ),
    },
    "AgentModel": {
        "reads": (
            RouteDeclaration(
                "GET", "/api/work-tracker/models", "List model catalog rows."
            ),
        ),
        "writes": (
            RouteDeclaration("POST", "/api/work-tracker/models", "Create a model row."),
            RouteDeclaration(
                "PATCH", "/api/work-tracker/models/{id}", "Update a model row."
            ),
            RouteDeclaration(
                "DELETE", "/api/work-tracker/models/{id}", "Delete an unused model row."
            ),
        ),
    },
    "ReasoningLevel": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/reasoning-levels",
                "List reasoning-level catalog rows.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "POST",
                "/api/work-tracker/reasoning-levels",
                "Create a reasoning level.",
            ),
            RouteDeclaration(
                "PATCH",
                "/api/work-tracker/reasoning-levels/{id}",
                "Update a reasoning level.",
            ),
            RouteDeclaration(
                "DELETE",
                "/api/work-tracker/reasoning-levels/{id}",
                "Delete an unused reasoning level.",
            ),
        ),
    },
    "LaunchBinding": {
        "reads": (
            RouteDeclaration(
                "GET",
                "/api/work-tracker/projects/{project_id}/launch-bindings",
                "List launch-binding rows for one project.",
            ),
        ),
        "writes": (
            RouteDeclaration(
                "PUT",
                "/api/work-tracker/issue-types/{type_id}/workflow-settings/launch-bindings/{state_id}",
                "Create or replace one composite-key launch binding.",
            ),
            RouteDeclaration(
                "DELETE",
                "/api/work-tracker/issue-types/{type_id}/workflow-settings/launch-bindings/{state_id}",
                "Delete one composite-key launch binding.",
            ),
        ),
    },
}

DOMAIN_OPERATIONS = (
    RouteDeclaration(
        "POST",
        "/api/work-tracker/work-items/{issue_id}/reorder",
        "The server must allocate the sole writable fractional rank value.",
    ),
    RouteDeclaration(
        "POST",
        "/api/work-tracker/projects/{project_id}/states/reorder",
        "A state reorder atomically rewrites the complete project order.",
    ),
    RouteDeclaration(
        "POST",
        "/api/work-tracker/projects/{project_id}/issue-types/reorder",
        "An issue-type reorder atomically rewrites the complete project order.",
    ),
    RouteDeclaration(
        "DELETE",
        "/api/work-tracker/issue-types/{type_id}/workflow-settings/states/{state_id}",
        "No row records workflow membership; removing a state edits the edge set and prunes disconnected rows.",
    ),
    RouteDeclaration(
        "POST",
        "/api/work-tracker/workspace/onboarding/acknowledge",
        "Onboarding acknowledgement is a monotonic write with no inverse route.",
    ),
)


HOST_ROUTES = (
    RouteDeclaration("GET", "/api/healthz", "Report sidecar health."),
    RouteDeclaration("GET", "/api/settings/keybindings", "Read host keybindings."),
    RouteDeclaration("PUT", "/api/settings/keybindings", "Replace host keybindings."),
    RouteDeclaration(
        "GET", "/api/settings/provider-catalog", "Read the host provider default."
    ),
    RouteDeclaration(
        "PUT", "/api/settings/provider-catalog", "Replace the host provider default."
    ),
    RouteDeclaration(
        "GET", "/api/config", "Read local profiles and feature configuration."
    ),
    RouteDeclaration("PATCH", "/api/config", "Select the recent local profile."),
    RouteDeclaration("POST", "/api/config/profiles", "Create a local profile."),
    RouteDeclaration("PUT", "/api/config/profiles/{index}", "Replace a local profile."),
    RouteDeclaration(
        "DELETE", "/api/config/profiles/{index}", "Delete a local profile."
    ),
    RouteDeclaration(
        "POST",
        "/api/automation-attempts/{attempt_id}/retry",
        "Create an idempotent retry attempt.",
    ),
    RouteDeclaration(
        "POST", "/api/lifecycle/events", "Ingest and publish one lifecycle event."
    ),
    RouteDeclaration(
        "GET", "/api/runs/module-activity", "Read recent module activity."
    ),
    RouteDeclaration(
        "GET", "/api/runs/agent-status", "Read the authoritative agent status snapshot."
    ),
    RouteDeclaration(
        "POST", "/api/terminals/viewers/lease", "Acquire a terminal viewer lease."
    ),
    RouteDeclaration(
        "POST", "/api/terminals/viewers/lease/renew", "Renew a terminal viewer lease."
    ),
    RouteDeclaration(
        "POST",
        "/api/terminals/viewers/lease/release",
        "Release a terminal viewer lease.",
    ),
    RouteDeclaration(
        "POST",
        "/api/terminals",
        "Create a durable terminal run through the control-plane service.",
    ),
    RouteDeclaration("GET", "/api/terminals", "List active terminal runs for a task."),
    RouteDeclaration("DELETE", "/api/terminals", "Terminate one terminal run."),
    RouteDeclaration(
        "POST", "/api/terminals/resume", "Resume a provider conversation."
    ),
    RouteDeclaration(
        "GET", "/api/terminals/resumable", "List resumable provider conversations."
    ),
    RouteDeclaration("GET", "/api/terminals/scratch", "List scratch terminal runs."),
    RouteDeclaration(
        "POST",
        "/api/terminals/self-terminate",
        "Terminate the Studio-authorized current run.",
    ),
    RouteDeclaration(
        "GET", "/api/documents", "List and rescan registered design documents."
    ),
    RouteDeclaration(
        "GET", "/api/docs/{doc_id}/{asset_path}", "Read a registered document asset."
    ),
    RouteDeclaration(
        "PUT", "/api/docs/{doc_id}", "Save a digest-guarded Markdown document."
    ),
    RouteDeclaration("GET", "/api/fs/complete", "Complete local directory names."),
    RouteDeclaration("GET", "/api/worktrees", "Read live worktree status."),
    RouteDeclaration(
        "POST", "/api/worktrees/{task_id}/create", "Create an opt-in worktree."
    ),
    RouteDeclaration(
        "POST", "/api/worktrees/{task_id}/discard", "Discard an opt-in worktree."
    ),
)

# Public operations are exceptional and must carry a reviewed reason. Every
# other declared operation is protected by the default API-key policy.
PUBLIC_ROUTE_REASONS = {
    (
        "GET",
        "/api/healthz",
    ): "The sidecar supervisor needs a credential-free liveness probe.",
    (
        "POST",
        "/api/lifecycle/events",
    ): "Provider hook subprocesses report best-effort loopback lifecycle events without the desktop API key.",
    (
        "POST",
        "/api/terminals/self-terminate",
    ): "The handler authenticates the calling run with its narrower run-scoped Authorization token.",
    (
        "GET",
        "/api/docs/{doc_id}/{asset_path}",
    ): "Webview document subresources cannot attach the desktop API-key header.",
}

# Framework-owned patterns are intentionally outside the application registry.
FRAMEWORK_ROUTE_EXCLUSIONS = (
    "/api/openapi.json",
    "/api/docs",
    "/api",
    "/api/work-tracker/schema",
    "/media/",
    "/^media/",
    "/static/",
    "/wt-admin/",
)


def declared_model_route_keys():
    return {
        route.key
        for operations in MODEL_ROUTES.values()
        for access in ("reads", "writes")
        for route in operations[access]
    } | {route.key for route in DOMAIN_OPERATIONS}


def declared_route_keys():
    """Return the complete two-way HTTP contract declaration."""

    return declared_model_route_keys() | {route.key for route in HOST_ROUTES}


def declared_public_route_keys():
    """Return the exact reviewed set of credential-free operations."""

    return set(PUBLIC_ROUTE_REASONS)


def declared_api_key_route_keys():
    """Return every operation governed by the default API-key policy."""

    return declared_route_keys() - declared_public_route_keys()
