from typing import Any, Dict, List, Optional

from worktracker_agent.api.service import get_worktracker_service
from worktracker_agent.api.schemas import (
    WorktrackerProject,
    WorktrackerIssueType,
    WorktrackerModule,
    WorktrackerTask,
    WorktrackerTaskDetail,
    WorktrackerScopeContext,
    WorktrackerOperationResult,
)


class WorktrackerToolset:
    """Owned-worktracker tool surface exposed over MCP.

    Each method keeps ``ctx`` as its first positional parameter so the MCP
    adapter can strip it uniformly. ``ctx`` is unused here and typed ``Any``
    because this package is MCP-only and carries no pydantic-ai dependency.
    """

    def __init__(self, service: Optional[Any] = None):
        self.service = service or get_worktracker_service()

    def list_projects_tool(self, ctx: Any) -> List[WorktrackerProject]:
        """List all projects in the worktracker."""
        return self.service.list_projects()

    def list_modules_tool(self, ctx: Any, project_id: str) -> List[WorktrackerModule]:
        """List a project's modules (issues of level ``module``, e.g. Epics)."""
        return self.service.list_modules(project_id)

    def list_issue_types_tool(
        self, ctx: Any, project_id: str
    ) -> List[WorktrackerIssueType]:
        """List a project's configurable issue types.

        Each row carries its ``level`` bucket (``module`` vs ``task``). Use it
        to map a selected type name to the id the create tools require."""
        return self.service.list_issue_types(project_id)

    def list_tasks_tool(
        self,
        ctx: Any,
        project_id: str,
        module_id: Optional[str] = None,
        state_name: Optional[str] = None,
        include_description: bool = False,
    ) -> List[WorktrackerTask]:
        """List tasks (work items) in a project, optionally filtered by module or state."""
        return self.service.list_tasks(project_id, module_id, state_name, include_description)

    def get_issue_type_workflow_settings_tool(
        self,
        ctx: Any,
        type_id: str,
    ) -> Any:
        """Read one issue type's live workflow policy.

        Returns its start state, revision-guarded transition map with agent
        permissions, launch bindings with auto-start, and standing warnings.
        """
        return self.service.get_issue_type_workflow_settings(type_id)

    def add_issue_type_workflow_transition_tool(
        self,
        ctx: Any,
        type_id: str,
        from_state_id: str,
        to_state_id: str,
        workflow_revision: int,
        agent_allowed: bool = True,
    ) -> Any:
        """Add one transition to a type's workflow at the supplied revision."""
        return self.service.add_issue_type_workflow_transition(
            type_id,
            from_state_id,
            to_state_id,
            workflow_revision,
            agent_allowed,
        )

    def remove_issue_type_workflow_transition_tool(
        self,
        ctx: Any,
        type_id: str,
        from_state_id: str,
        to_state_id: str,
        workflow_revision: int,
    ) -> Any:
        """Remove one transition from a type's workflow at the supplied revision."""
        return self.service.remove_issue_type_workflow_transition(
            type_id, from_state_id, to_state_id, workflow_revision
        )

    def set_issue_type_workflow_transition_permission_tool(
        self,
        ctx: Any,
        type_id: str,
        from_state_id: str,
        to_state_id: str,
        agent_allowed: bool,
        workflow_revision: int,
    ) -> Any:
        """Allow or forbid agents on one existing transition."""
        return self.service.set_issue_type_workflow_transition_permission(
            type_id,
            from_state_id,
            to_state_id,
            agent_allowed,
            workflow_revision,
        )

    def set_issue_type_workflow_start_state_tool(
        self,
        ctx: Any,
        type_id: str,
        state_id: str,
        workflow_revision: int,
    ) -> Any:
        """Set the issue type's start state at the supplied revision."""
        return self.service.set_issue_type_workflow_start_state(
            type_id, state_id, workflow_revision
        )

    def upsert_issue_type_workflow_launch_binding_tool(
        self,
        ctx: Any,
        type_id: str,
        state_id: str,
        workflow_revision: int,
        prompt: Optional[str] = None,
        agent: Optional[str] = None,
        model: Optional[str] = None,
        reasoning: Optional[str] = None,
        required_skills: Optional[List[str]] = None,
    ) -> Any:
        """Create or replace one state's launch binding at the supplied revision."""
        return self.service.upsert_issue_type_workflow_launch_binding(
            type_id,
            state_id,
            workflow_revision,
            prompt,
            agent,
            model,
            reasoning,
            required_skills,
        )

    def clear_issue_type_workflow_launch_binding_tool(
        self,
        ctx: Any,
        type_id: str,
        state_id: str,
        workflow_revision: int,
    ) -> Any:
        """Delete one state's launch binding and its auto-start setting."""
        return self.service.clear_issue_type_workflow_launch_binding(
            type_id, state_id, workflow_revision
        )

    def set_issue_type_workflow_auto_start_tool(
        self,
        ctx: Any,
        type_id: str,
        state_id: str,
        auto_start: bool,
        workflow_revision: int,
    ) -> Any:
        """Toggle auto-start; enabling requires a valid launch binding."""
        return self.service.set_issue_type_workflow_auto_start(
            type_id, state_id, auto_start, workflow_revision
        )

    def get_task_details_tool(self, ctx: Any, id_or_key: str) -> Optional[WorktrackerTaskDetail]:
        """Get detailed information about a specific task using its ID or Key (e.g. PROJ-123)."""
        try:
            return self.service.get_task_details(id_or_key)
        except Exception:
            return None

    def create_task_tool(
        self,
        ctx: Any,
        project_id: str,
        name: str,
        issue_type: str,
        description: str = "",
        module_id: Optional[str] = None,
        state_name: Optional[str] = None,
    ) -> str:
        """Create a task with an explicit type, optionally in a named state."""
        return str(
            self.service.create_task(
                project_id=project_id,
                name=name,
                issue_type=issue_type,
                description=description,
                module_id=module_id,
                state_name=state_name,
            )
        )

    def create_sub_task_tool(
        self,
        ctx: Any,
        project_id: str,
        parent_id: str,
        name: str,
        issue_type: str,
        description: str = "",
        state_name: Optional[str] = None,
    ) -> str:
        """Create a sub-task with an explicit type, optionally in a named state."""
        return str(
            self.service.create_sub_task(
                project_id=project_id,
                parent_id=parent_id,
                name=name,
                issue_type=issue_type,
                description=description,
                state_name=state_name,
            )
        )

    def create_review_finding_tool(
        self,
        ctx: Any,
        project_id: str,
        parent_id: str,
        name: str,
        path: str,
        line_start: int,
        line_end: int,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create an Implementation finding under a Story in Review (#905).

        The dedicated review-finding surface: one call creates a direct
        Implementation child, parented to a Story currently in ``Review``, born
        directly in the Implementation workflow's start stage, with a fixed
        evidence-block description — ``Path`` (repo-relative), inclusive
        ``Lines`` (``line_start``..``line_end``), and an optional ``Note``.

        Returns ``{"ok": True, "task_id", "key"}`` on success. On rejection it
        returns ``{"ok": False, ...}`` with a machine-readable reason instead of
        raising: malformed evidence locally (implausible path, or a
        non-inclusive / non-positive line range), and — from the backend gate — a
        parent that is not a Story, a parent not in ``Review``, or a
        foreign-project parent (``detail``/``code``/``from``/``to``).

        Inert by contract: it never launches an agent, moves the parent's state,
        touches the scheduler, or draws a blocker/dependency edge.
        """
        return self.service.create_review_finding(
            project_id, parent_id, name, path, line_start, line_end, note
        )

    def update_task_status_tool(
        self,
        ctx: Any,
        project_id: str,
        task_id: str,
        status_name: str,
    ) -> Dict[str, Any]:
        """Update the status/state of a task (e.g. 'Todo', 'Done').

        Returns ``{"ok": True, ...}`` on success, or ``{"ok": False, ...}`` with
        the gate's structured reason (``detail``/``code``/``from``/``to``) when
        the backend refuses an illegal workflow move (#872).

        This tool always identifies the write as agent-origin, so the configured
        graph and its agent permissions govern the move.
        """
        return self.service.update_task_status(project_id, task_id, status_name)

    def append_task_description_tool(
        self,
        ctx: Any,
        project_id: str,
        task_id: str,
        new_content: str,
    ) -> bool:
        """Append text to the existing description of a task."""
        return self.service.append_task_description(project_id, task_id, new_content)

    def update_task_tool(
        self,
        ctx: Any,
        id_or_key: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Replace a task's supplied title and/or full description."""
        return self.service.update_task(id_or_key, name, description)

    def set_task_blockers_tool(
        self,
        ctx: Any,
        task_id: str,
        blocked_by_ids: List[str],
    ) -> dict:
        """Replace the tasks that block a task. IDs may be UUIDs or keys."""
        return self.service.set_task_blockers(task_id, blocked_by_ids)

    def add_task_blocker_tool(
        self,
        ctx: Any,
        task_id: str,
        blocker_task_id: str,
    ) -> dict:
        """Add a dependency edge: task_id is blocked by blocker_task_id."""
        return self.service.add_task_blocker(task_id, blocker_task_id)

    def add_task_dependent_tool(
        self,
        ctx: Any,
        task_id: str,
        dependent_task_id: str,
    ) -> dict:
        """Add a reverse dependency edge: dependent_task_id depends on task_id."""
        return self.service.add_task_dependent(task_id, dependent_task_id)

    def get_task_scope_context_tool(
        self,
        ctx: Any,
        id_or_key: str,
    ) -> Optional[WorktrackerScopeContext]:
        """Read a task's dependency slice: which tasks it depends on, which
        depend on it, which are owned elsewhere, plus an advisory summary.
        ID may be a UUID or a key (e.g. PROJ-123). Read-only."""
        try:
            return self.service.get_scope_context(id_or_key)
        except Exception:
            return None

    def reparent_tasks_tool(
        self,
        ctx: Any,
        project_id: str,
        parent_task_id: str,
        task_ids: List[str],
        module_id: Optional[str] = None,
    ) -> dict:
        """Reparent existing work items under a parent work item.

        Both parent_task_id and each entry in task_ids may be a UUID or a
        worktracker key (e.g. "VEEVI-68"). If module_id is omitted, the
        reparented tasks inherit the parent's module. Returns a dict with keys:
        parent_task_id, reparented, skipped, failed.
        """
        return self.service.reparent_tasks(project_id, parent_task_id, task_ids, module_id)

    def attach_file_tool(
        self,
        ctx: Any,
        project_id: str,
        task_id: str,
        file_path: str,
    ) -> WorktrackerOperationResult:
        """Attach a local file to a task."""
        return self.service.attach_file(project_id, task_id, file_path)
