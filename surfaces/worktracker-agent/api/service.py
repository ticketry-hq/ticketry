"""Owned worktracker implementation of the MCP tool service surface."""

from __future__ import annotations

import os
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

from worktracker_sdk.generated import (
    ApiClient,
    AttachmentsApi,
    Configuration,
    IssueTypeTransition,
    IssueTypesApi,
    LaunchBinding,
    LaunchBindingsApi,
    ModelsApi,
    ModulesApi,
    PatchedIssueType,
    PatchedIssueTypeTransition,
    PatchedWorkItemPatch,
    ProjectsApi,
    ProvidersApi,
    ReasoningLevelsApi,
    StatesApi,
    WorkItemCreate,
    WorkItemsApi,
    WorkflowsApi,
)
from worktracker_sdk.generated.exceptions import ApiException, NotFoundException
from worktracker_sdk.root_api import ExecutionApi, LaunchApi, RevisionedDeleteApi

from worktracker_agent.api.schemas import (
    WorktrackerAttachmentInfo,
    WorktrackerIssueType,
    WorktrackerModule,
    WorktrackerOperationResult,
    WorktrackerProject,
    WorktrackerScopeContext,
    WorktrackerState,
    WorktrackerTask,
    WorktrackerTaskDetail,
)

# Owned backend used when no base url is supplied.

DEFAULT_BASE_URL = "http://127.0.0.1:8787/api"
RESOLVED_STATE_GROUPS = frozenset({"completed", "cancelled"})
REVIEW_STATE_NAME = "Review"


def _dependency_state_resolved(state: Any | None) -> bool:
    """Match graph scheduling: Review releases dependents before completion."""

    return state is not None and (
        state.group in RESOLVED_STATE_GROUPS or state.name == REVIEW_STATE_NAME
    )


@dataclass(frozen=True)
class GeneratedSdk:
    """The generated per-tag clients sharing one configured transport."""

    api_client: ApiClient
    projects: ProjectsApi
    modules: ModulesApi
    issue_types: IssueTypesApi
    states: StatesApi
    work_items: WorkItemsApi
    workflows: WorkflowsApi
    launch_bindings: LaunchBindingsApi
    models: ModelsApi
    providers: ProvidersApi
    reasoning_levels: ReasoningLevelsApi
    attachments: AttachmentsApi
    execution: ExecutionApi
    launch: LaunchApi
    revisioned_delete: RevisionedDeleteApi

    @classmethod
    def connect(cls, base_url: str, api_key: Optional[str]) -> "GeneratedSdk":
        configuration = Configuration(
            host=base_url,
            api_key={"ApiKeyAuth": api_key} if api_key else {},
        )
        api_client = ApiClient(configuration)
        return cls(
            api_client=api_client,
            projects=ProjectsApi(api_client),
            modules=ModulesApi(api_client),
            issue_types=IssueTypesApi(api_client),
            states=StatesApi(api_client),
            work_items=WorkItemsApi(api_client),
            workflows=WorkflowsApi(api_client),
            launch_bindings=LaunchBindingsApi(api_client),
            models=ModelsApi(api_client),
            providers=ProvidersApi(api_client),
            reasoning_levels=ReasoningLevelsApi(api_client),
            attachments=AttachmentsApi(api_client),
            execution=ExecutionApi(api_client),
            launch=LaunchApi(api_client),
            revisioned_delete=RevisionedDeleteApi(api_client),
        )


class WorktrackerService:
    """Serve the MCP tools from the owned worktracker API.

    - Always targets the owned worktracker backend; there is no WorkTracker SaaS path.
    - Base url and api key fall back to environment variables.
    - The ``x-api-key`` header is omitted entirely when no key is configured.
    """

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        workspace_slug: Optional[str] = None,
        sdk: Optional[GeneratedSdk] = None,
    ) -> None:
        resolved_base_url = (
            base_url or os.getenv("WORKTRACKER_BASE_URL") or DEFAULT_BASE_URL
        )
        resolved_api_key = api_key or os.getenv("WORKTRACKER_API_KEY")

        # The generated operations already carry the /work-tracker segment, so
        # the SDK wants the /api root. Accept either form of the configured
        # base: the documented WORKTRACKER_BASE_URL ends in /work-tracker, and
        # passing that through unchanged doubles the segment and 404s every
        # read. The generated Configuration patches its `host` setter to strip
        # this, but its constructor writes _base_path directly and never calls
        # that setter, so the strip has to happen here too.
        self.base_url = resolved_base_url.rstrip("/").removesuffix("/work-tracker")
        self.api_key = resolved_api_key
        self.workspace_slug = workspace_slug
        self.sdk = sdk or GeneratedSdk.connect(self.base_url, resolved_api_key)

    def _resolve_project_id(self, project_id_or_identifier: str) -> Optional[str]:
        try:
            return str(UUID(project_id_or_identifier))
        except ValueError:
            pass

        target = project_id_or_identifier.lower()
        for project in self.list_projects():
            if project.identifier.lower() == target or project.name.lower() == target:
                return str(project.id)
        return None

    def _map_issue_type(self, it) -> WorktrackerIssueType:
        return WorktrackerIssueType(
            id=it.id,
            name=it.name,
            level=it.level,
            color=it.color,
            sort_order=it.sort_order,
        )

    def _issue_types_by_id(self, project_id: UUID) -> Dict[str, WorktrackerIssueType]:
        """Read the type rows used to enrich bare work-item type ids."""

        return {
            str(item.id): self._map_issue_type(item)
            for item in self.sdk.issue_types.list_issue_types(project_id)
        }

    def _map_task(
        self,
        wi,
        issue_types: Dict[str, WorktrackerIssueType],
        include_description: bool = False,
    ) -> WorktrackerTask:
        return WorktrackerTask(
            id=wi.id,
            name=wi.name,
            project_id=wi.project_id,
            state_id=wi.state,
            description=(wi.description if include_description else None),
            sequence_id=wi.sequence_id or 0,
            key=wi.key,
            parent_id=wi.parent_id,
            issue_type=issue_types[str(wi.issue_type)],
            is_archived=wi.is_archived,
            blocked_by_ids=list(wi.blocked_by_ids or []),
            blocks_ids=list(wi.blocks_ids or []),
        )

    def _sdk_resolve_task_id(self, id_or_key: str) -> UUID:
        try:
            return UUID(id_or_key)
        except ValueError:
            result = self.sdk.work_items.get_work_item(id_or_key)
            return getattr(result, "task", result).id

    def list_projects(self) -> List[WorktrackerProject]:
        return [
            WorktrackerProject(
                id=p.id,
                name=p.name,
                identifier=p.slug,
            )
            for p in self.sdk.projects.list_projects()
        ]

    def list_modules(self, project_id: str) -> List[WorktrackerModule]:
        """List a project's module issues (``Issue`` of level ``module``)."""
        resolved = self._resolve_project_id(project_id)
        if not resolved:
            return []
        issue_types = self._issue_types_by_id(UUID(resolved))
        return [
            WorktrackerModule(
                id=m.id,
                name=m.name,
                project_id=m.project_id,
                sequence_id=m.sequence_id or 0,
                key=m.key,
                is_archived=m.is_archived,
                issue_type=issue_types[str(m.issue_type)],
            )
            for m in self.sdk.modules.list_modules(UUID(resolved))
        ]

    def list_issue_types(self, project_id: str) -> List[WorktrackerIssueType]:
        """List a project's first-class issue types (CODIN-890).

        The name→type surface CODIN-883 resolves against: each row carries its
        ``level`` bucket so a caller can map a chosen name to the id the create
        endpoints require via ``issue_type_id``.
        """
        resolved = self._resolve_project_id(project_id)
        if not resolved:
            return []
        return [
            self._map_issue_type(item)
            for item in self.sdk.issue_types.list_issue_types(UUID(resolved))
        ]

    def _resolve_task_issue_type_id(self, project_id: str, issue_type: str) -> UUID:
        """Resolve a required task-type name or id to its project-scoped UUID."""
        if not issue_type:
            raise ValueError("issue_type is required.")

        task_types = [
            item
            for item in self.sdk.issue_types.list_issue_types(UUID(project_id))
            if item.level == "task"
        ]
        try:
            UUID(issue_type)
        except ValueError:
            is_raw_uuid = False
        else:
            is_raw_uuid = True
        requested = issue_type.casefold()
        matched = next(
            (
                item
                for item in task_types
                if (
                    str(item.id) == issue_type
                    if is_raw_uuid
                    else item.name.casefold() == requested
                )
            ),
            None,
        )
        if matched is not None:
            return matched.id

        valid_names = ", ".join(item.name for item in task_types) or "(none configured)"
        raise ValueError(
            f"Unknown task issue type {issue_type!r}. "
            f"Valid task-level types: {valid_names}."
        )

    def _resolve_state_id(
        self, project_id: str, state_name: Optional[str]
    ) -> Optional[UUID]:
        """Resolve an optional project workflow-state name to its UUID."""
        if state_name is None:
            return None

        states = self.get_states(project_id)
        matched = next(
            (
                state
                for state in states
                if state.name.casefold() == state_name.casefold()
            ),
            None,
        )
        if matched is not None:
            return matched.id

        valid_names = ", ".join(state.name for state in states) or "(none configured)"
        raise ValueError(
            f"Unknown workflow state {state_name!r}. Available states: {valid_names}."
        )

    def list_tasks(
        self,
        project_id: str,
        module_id: Optional[str] = None,
        state_name: Optional[str] = None,
        include_description: bool = False,
    ) -> List[WorktrackerTask]:
        resolved = self._resolve_project_id(project_id)
        if not resolved:
            return []
        state_uuid = None
        if state_name:
            state = next(
                (
                    item
                    for item in self.get_states(resolved)
                    if item.name.lower() == state_name.lower()
                ),
                None,
            )
            if not state:
                return []
            state_uuid = state.id
        project_uuid = UUID(resolved)
        items = self.sdk.work_items.list_work_items(
            project=project_uuid,
            module=UUID(module_id) if module_id else None,
            state=state_uuid,
        )
        issue_types = self._issue_types_by_id(project_uuid)
        return [
            self._map_task(item, issue_types, include_description) for item in items
        ]

    def get_task_details(self, id_or_key: str) -> WorktrackerTaskDetail:
        result = self.sdk.work_items.get_work_item(id_or_key)
        raw = getattr(result, "task", result)
        issue_types = self._issue_types_by_id(raw.project_id)
        task = self._map_task(raw, issue_types, include_description=True)
        children = [
            item
            for item in self.sdk.work_items.list_work_items(project=raw.project_id)
            if item.parent_id == raw.id
        ]
        attachments = [
            WorktrackerAttachmentInfo(
                id=a.id,
                name=a.filename,
                mime_type=a.mime_type or "",
                size=a.size or 0,
                asset_url=a.url or "",
            )
            # raw.id is a UUID after the DRF change; the generated signature
            # takes a str and pydantic rejects the object outright.
            for a in self.sdk.attachments.list_work_item_attachments(str(raw.id))
        ]
        return WorktrackerTaskDetail(
            **task.model_dump(),
            sub_tasks=[self._map_task(c, issue_types) for c in children],
            attachments=attachments,
        )

    def create_task(
        self,
        project_id: str,
        name: str,
        issue_type: str,
        description: str = "",
        module_id: Optional[str] = None,
        state_name: Optional[str] = None,
    ) -> UUID:
        resolved = self._resolve_project_id(project_id)
        if not resolved:
            raise ValueError(f"Could not resolve project: {project_id}")
        issue_type_id = self._resolve_task_issue_type_id(resolved, issue_type)
        state_id = self._resolve_state_id(resolved, state_name)
        created = self.sdk.work_items.create_work_item(
            UUID(resolved),
            WorkItemCreate(
                name=name,
                description=description,
                parent_id=UUID(module_id) if module_id else None,
                issue_type_id=issue_type_id,
                state_id=state_id,
            ),
        )
        return created.id

    def create_sub_task(
        self,
        project_id: str,
        parent_id: str,
        name: str,
        issue_type: str,
        description: str = "",
        state_name: Optional[str] = None,
    ) -> UUID:
        resolved = self._resolve_project_id(project_id)
        if not resolved:
            raise ValueError(f"Could not resolve project: {project_id}")
        issue_type_id = self._resolve_task_issue_type_id(resolved, issue_type)
        state_id = self._resolve_state_id(resolved, state_name)
        parent_uuid = self._sdk_resolve_task_id(parent_id)
        created = self.sdk.work_items.create_work_item(
            UUID(resolved),
            WorkItemCreate(
                name=name,
                description=description,
                parent_id=parent_uuid,
                issue_type_id=issue_type_id,
                state_id=state_id,
            ),
        )
        return created.id

    @staticmethod
    def _build_finding_description(
        path: str,
        line_start: int,
        line_end: int,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Render the fixed ``Path`` / ``Lines`` / ``Note`` evidence block (#905).

        Returns ``{"description": ...}`` for well-formed evidence, or
        ``{"error": {"code", "detail"}}`` when the evidence is malformed —
        rejected *before* any write so the agent learns why. An implausible repo
        path (empty, absolute, containing ``..`` or a newline) or a
        non-positive / inverted line range is rejected; the range is inclusive.
        """
        cleaned = (path or "").strip()
        if (
            not cleaned
            or cleaned.startswith("/")
            or "\n" in cleaned
            or "\r" in cleaned
            or any(segment == ".." for segment in cleaned.split("/"))
        ):
            return {
                "error": {
                    "code": "malformed_path",
                    "detail": f"Implausible repo-relative path {path!r}.",
                }
            }
        try:
            start = int(line_start)
            end = int(line_end)
        except (TypeError, ValueError):
            return {
                "error": {
                    "code": "malformed_range",
                    "detail": "Line range endpoints must be integers.",
                }
            }
        if start < 1 or end < 1 or start > end:
            return {
                "error": {
                    "code": "malformed_range",
                    "detail": (
                        f"Line range {line_start}-{line_end} is not an inclusive "
                        "positive range (expect 1 <= start <= end)."
                    ),
                }
            }
        lines = [f"Path: {cleaned}", f"Lines: {start}-{end}"]
        if note and note.strip():
            lines.append(f"Note: {note.strip()}")
        return {"description": "\n".join(lines)}

    def create_review_finding(
        self,
        project_id: str,
        parent_id: str,
        name: str,
        path: str,
        line_start: int,
        line_end: int,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create an Implementation finding under a Review Story (#905).

        Builds the fixed evidence block from ``path`` / ``line_start`` /
        ``line_end`` / ``note`` and, if it is well-formed, creates a direct
        Implementation child born in its workflow start stage under
        ``parent_id`` through the ordinary work-item create. Every
        rejection is returned as ``{"ok": False, ...}`` carrying a
        machine-readable reason rather than raised: malformed evidence locally
        (``code``/``detail``), and — from the backend gate — a parent that is
        not a Story, not in ``Review``, or in a foreign project
        (``detail``/``code``/``from``/``to``). Success
        returns ``{"ok": True, "task_id", "key"}``.

        Inert by contract: no agent launch, no parent state move, no scheduler,
        no blocker/dependency edge.
        """
        evidence = self._build_finding_description(path, line_start, line_end, note)
        if "error" in evidence:
            return {"ok": False, **evidence["error"]}

        resolved = self._resolve_project_id(project_id)
        if not resolved:
            return {
                "ok": False,
                "code": "unknown_project",
                "detail": f"Could not resolve project: {project_id}",
            }

        try:
            parent_uuid = self._sdk_resolve_task_id(parent_id)
        except ApiException as error:
            body = self._sdk_error_body(error)
            if body is None:
                raise
            return {"ok": False, "parent_id": parent_id, **body}

        try:
            created = self.sdk.work_items.create_work_item(
                UUID(resolved),
                WorkItemCreate.model_construct(
                    parent_id=parent_uuid,
                    name=name,
                    description=evidence["description"],
                    issue_type_id=None,
                    state_id=None,
                ),
            )
        except ApiException as error:
            body = self._sdk_error_body(error)
            if body is None:
                raise
            return {"ok": False, "parent_id": str(parent_uuid), **body}

        return {"ok": True, "task_id": str(created.id), "key": created.key}

    def get_states(self, project_id: str) -> List[WorktrackerState]:
        resolved = self._resolve_project_id(project_id)
        if not resolved:
            return []
        return [
            WorktrackerState(id=s.id, name=s.name, group=s.group)
            for s in self.sdk.states.list_states(UUID(resolved))
        ]

    def _workflow_request(self, operation, *args):
        """Return a scoped workflow response or its unchanged service rejection."""
        try:
            return operation(*args)
        except ApiException as error:
            body = self._sdk_error_body(error)
            if body is None:
                raise
            return {"ok": False, **body}

    def get_issue_type_workflow_settings(self, type_id: str):
        """Assemble the legacy tool shape from canonical CRUD reads."""

        def assemble():
            issue_type = self.sdk.issue_types.get_issue_type(UUID(type_id))
            transitions = self.sdk.workflows.list_issue_type_transitions(
                UUID(type_id)
            )
            bindings = [
                item
                for item in self.sdk.launch_bindings.list_launch_bindings(
                    issue_type.project
                )
                if item.issue_type == UUID(type_id)
            ]
            states = self.sdk.states.list_states(issue_type.project)
            providers = {item.id: item for item in self.sdk.providers.list_providers()}
            models = {item.id: item for item in self.sdk.models.list_agent_models()}
            reasoning_levels = {
                item.id: item for item in self.sdk.reasoning_levels.list_reasoning_levels()
            }

            adjacency: Dict[UUID, set[UUID]] = {}
            reverse: Dict[UUID, set[UUID]] = {}
            for edge in transitions:
                adjacency.setdefault(edge.from_state, set()).add(edge.to_state)
                reverse.setdefault(edge.to_state, set()).add(edge.from_state)

            def reachable(seed, graph):
                seen = set(seed)
                pending = list(seed)
                while pending:
                    current = pending.pop()
                    for neighbor in graph.get(current, set()):
                        if neighbor not in seen:
                            seen.add(neighbor)
                            pending.append(neighbor)
                return seen

            state_by_id = {item.id: item for item in states}
            warnings = []
            if issue_type.start_state not in state_by_id:
                warnings.append(
                    {
                        "code": "start_state_not_configured",
                        "state_id": None,
                        "message": "No start state is configured for this work-item type.",
                    }
                )
            else:
                members = reachable({issue_type.start_state}, adjacency)
                completed = {
                    state.id
                    for state in states
                    if state.id in members and state.group == "completed"
                }
                can_reach_completed = reachable(completed, reverse)
                for state in states:
                    if state.id in members and state.id not in can_reach_completed:
                        warnings.append(
                            {
                                "code": "no_path_to_completed",
                                "state_id": state.id,
                                "message": f"{state.name} has no path to a completed state.",
                            }
                        )

            binding_rows = []
            for binding in bindings:
                model_row = models.get(binding.model)
                provider = providers.get(model_row.provider) if model_row else None
                reasoning = reasoning_levels.get(binding.reasoning)
                if provider is not None and not provider.activated:
                    state_name = state_by_id.get(binding.state)
                    warnings.append(
                        {
                            "code": "provider_not_activated",
                            "state_id": binding.state,
                            "message": (
                                f"{state_name.name if state_name else 'This state'} launches "
                                f"with {provider.slug}, which is deactivated in Settings → "
                                "Model configuration; those launches are blocked."
                            ),
                        }
                    )
                binding_rows.append(
                    {
                        "state_id": binding.state,
                        "prompt": binding.prompt,
                        "required_skills": binding.required_skills,
                        "agent": provider.slug if provider else None,
                        "model": model_row.name if model_row else None,
                        "reasoning": reasoning.name if reasoning else None,
                        "auto_start": binding.auto_start,
                        "subtree_run_enabled": binding.subtree_run_enabled,
                    }
                )

            return {
                "issue_type_id": issue_type.id,
                "start_state_id": issue_type.start_state,
                "workflow_revision": issue_type.workflow_revision,
                "transitions": [
                    {
                        "from_state_id": edge.from_state,
                        "to_state_id": edge.to_state,
                        "agent_allowed": edge.agent_allowed,
                    }
                    for edge in transitions
                ],
                "launch_bindings": binding_rows,
                "warnings": warnings,
            }

        return self._workflow_request(assemble)

    def add_issue_type_workflow_transition(
        self,
        type_id: str,
        from_state_id: str,
        to_state_id: str,
        workflow_revision: int,
        agent_allowed: bool = True,
    ):
        return self._workflow_request(
            self.sdk.workflows.create_issue_type_transition,
            UUID(type_id),
            IssueTypeTransition.model_construct(
                id=0,
                issue_type=UUID(type_id),
                from_state=UUID(from_state_id),
                to_state=UUID(to_state_id),
                agent_allowed=agent_allowed,
                workflow_revision=workflow_revision,
            ),
        )

    def remove_issue_type_workflow_transition(
        self,
        type_id: str,
        from_state_id: str,
        to_state_id: str,
        workflow_revision: int,
    ):
        return self._workflow_request(
            self.sdk.revisioned_delete.delete_transition,
            UUID(type_id),
            UUID(from_state_id),
            UUID(to_state_id),
            workflow_revision,
        )

    def set_issue_type_workflow_transition_permission(
        self,
        type_id: str,
        from_state_id: str,
        to_state_id: str,
        agent_allowed: bool,
        workflow_revision: int,
    ):
        return self._workflow_request(
            self.sdk.workflows.update_issue_type_transition,
            UUID(from_state_id),
            UUID(to_state_id),
            UUID(type_id),
            PatchedIssueTypeTransition(
                agent_allowed=agent_allowed,
                workflow_revision=workflow_revision,
            ),
        )

    def set_issue_type_workflow_start_state(
        self,
        type_id: str,
        state_id: str,
        workflow_revision: int,
    ):
        return self._workflow_request(
            self.sdk.issue_types.update_issue_type,
            UUID(type_id),
            PatchedIssueType(
                start_state=UUID(state_id),
                workflow_revision=workflow_revision,
            ),
        )

    def upsert_issue_type_workflow_launch_binding(
        self,
        type_id: str,
        state_id: str,
        workflow_revision: int,
        prompt: Optional[str] = None,
        agent: Optional[str] = None,
        model: Optional[str] = None,
        reasoning: Optional[str] = None,
        required_skills: Optional[List[str]] = None,
    ):
        def upsert():
            issue_type = self.sdk.issue_types.get_issue_type(UUID(type_id))
            bindings = self.sdk.launch_bindings.list_launch_bindings(
                issue_type.project
            )
            current = next(
                (
                    item
                    for item in bindings
                    if item.issue_type == UUID(type_id)
                    and item.state == UUID(state_id)
                ),
                None,
            )
            providers = {item.id: item for item in self.sdk.providers.list_providers()}
            model_rows = self.sdk.models.list_agent_models()
            reasoning_rows = self.sdk.reasoning_levels.list_reasoning_levels()

            model_id = current.model if current else None
            if model is not None:
                matches = [item for item in model_rows if item.name == model]
                if agent is not None:
                    matches = [
                        item
                        for item in matches
                        if providers.get(item.provider)
                        and providers[item.provider].slug == agent
                    ]
                if len(matches) != 1:
                    raise ValueError(
                        f"Could not resolve one catalog model for provider={agent!r}, model={model!r}."
                    )
                model_id = matches[0].id
            elif agent is not None and current is None:
                raise ValueError("A provider is represented by its model row; supply model.")

            reasoning_id = current.reasoning if current else None
            if reasoning is not None:
                matches = [item for item in reasoning_rows if item.name == reasoning]
                if len(matches) != 1:
                    raise ValueError(
                        f"Could not resolve reasoning level {reasoning!r}."
                    )
                reasoning_id = matches[0].id

            payload = LaunchBinding.model_construct(
                id=current.id if current else 0,
                issue_type=UUID(type_id),
                state=UUID(state_id),
                prompt=prompt if prompt is not None else (current.prompt if current else None),
                required_skills=(
                    required_skills
                    if required_skills is not None
                    else (current.required_skills if current else [])
                ),
                model=model_id,
                reasoning=reasoning_id,
                auto_start=current.auto_start if current else False,
                subtree_run_enabled=current.subtree_run_enabled if current else False,
                workflow_revision=workflow_revision,
                created_at=getattr(current, "created_at", None),
                updated_at=getattr(current, "updated_at", None),
            )
            return self.sdk.launch_bindings.upsert_launch_binding(
                UUID(state_id), UUID(type_id), payload
            )

        return self._workflow_request(upsert)

    def clear_issue_type_workflow_launch_binding(
        self,
        type_id: str,
        state_id: str,
        workflow_revision: int,
    ):
        return self._workflow_request(
            self.sdk.revisioned_delete.delete_launch_binding,
            UUID(type_id),
            UUID(state_id),
            workflow_revision,
        )

    def set_issue_type_workflow_auto_start(
        self,
        type_id: str,
        state_id: str,
        auto_start: bool,
        workflow_revision: int,
    ):
        def update_auto_start():
            issue_type = self.sdk.issue_types.get_issue_type(UUID(type_id))
            current = next(
                (
                    item
                    for item in self.sdk.launch_bindings.list_launch_bindings(
                        issue_type.project
                    )
                    if item.issue_type == UUID(type_id)
                    and item.state == UUID(state_id)
                ),
                None,
            )
            if current is None:
                raise ValueError("Configure a launch binding before changing auto-start.")
            payload_data = current.model_dump()
            payload_data.update(
                auto_start=auto_start, workflow_revision=workflow_revision
            )
            payload = LaunchBinding.model_construct(**payload_data)
            return self.sdk.launch_bindings.upsert_launch_binding(
                UUID(state_id), UUID(type_id), payload
            )

        return self._workflow_request(update_auto_start)

    def update_task_status(
        self,
        project_id: str,
        task_id: str,
        status_name: str,
    ) -> Dict[str, Any]:
        """Move a task to the named workflow state through the guarded PATCH.

        The single write door agents use for the SDLC state machine (#872). On an
        illegal move the backend gate (#860) answers 422 with a structured body
        (``detail``/``code``/``from``/``to``); this surfaces that same
        machine-readable reason to the caller instead of raising, so an agent
        learns *why* a move was refused — identical to what the UI PATCH and the
        bulk fan-out receive through the same chokepoint. Success returns
        ``{"ok": True, ...}``; a rejection returns ``{"ok": False, ...}`` carrying
        the gate's structured reason.

        This agent-owned surface always stamps ``origin="agent"``, so the backend
        enforces the configured graph and its agent permissions.
        """
        resolved_project_id = self._resolve_project_id(project_id)
        states = (
            self.sdk.states.list_states(UUID(resolved_project_id))
            if resolved_project_id
            else []
        )
        state = next(
            (item for item in states if item.name.lower() == status_name.lower()),
            None,
        )
        if not state:
            return {
                "ok": False,
                "error": f"No such state {status_name!r} in this project.",
            }

        try:
            resolved_id = self._sdk_resolve_task_id(task_id)
        except ApiException as error:
            body = self._sdk_error_body(error)
            if body is None:
                raise
            return {"ok": False, "task_id": task_id, **body}

        try:
            self.sdk.work_items.update_work_item(
                str(resolved_id),
                PatchedWorkItemPatch(state_id=state.id, origin="agent"),
            )
        except ApiException as error:
            body = self._sdk_error_body(error)
            if body is None:
                raise
            return {
                "ok": False,
                "task_id": str(resolved_id),
                "status": status_name,
                **body,
            }

        return {"ok": True, "task_id": str(resolved_id), "status": status_name}

    def append_task_description(
        self,
        project_id: str,
        task_id: str,
        new_content: str,
    ) -> bool:
        del project_id
        detail = self.sdk.work_items.get_work_item(task_id)
        existing = detail.description or ""
        merged = f"{existing}\n\n{new_content}" if existing else new_content
        self.sdk.work_items.update_work_item(
            str(detail.id), PatchedWorkItemPatch(description=merged)
        )
        return True

    def update_task(
        self,
        id_or_key: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        if name == "":
            raise ValueError("name must not be empty")
        if name is None and description is None:
            raise ValueError("name or description is required")

        fields: Dict[str, Any] = {}
        updated_fields: List[str] = []
        if name is not None:
            fields["name"] = name
            updated_fields.append("name")
        if description is not None:
            fields["description"] = description
            updated_fields.append("description")

        resolved_id = self._sdk_resolve_task_id(id_or_key)
        updated = self.sdk.work_items.update_work_item(
            str(resolved_id),
            PatchedWorkItemPatch(**fields),
        )
        return {
            "ok": True,
            "task_id": str(updated.id),
            "key": updated.key,
            "updated_fields": updated_fields,
        }

    @staticmethod
    def _sdk_error_body(error: ApiException) -> Optional[Dict[str, Any]]:
        """Return a generated SDK exception's structured 4xx body, if any.

        A 5xx (or a non-object body) yields ``None`` so the caller re-raises; a
        4xx JSON object is returned unchanged so the gate's machine-readable
        rejection (``detail``/``code``/``from``/``to``, #860) reaches the agent
        whole. Generated exceptions expose deserialized ``data`` and the raw
        JSON ``body``; either representation is accepted.
        """
        if error.status is None or error.status >= 500:
            return None
        if isinstance(error.body, str):
            try:
                body = json.loads(error.body)
            except json.JSONDecodeError:
                pass
            else:
                if isinstance(body, dict):
                    return body
        if isinstance(error.data, dict):
            return error.data
        if hasattr(error.data, "model_dump"):
            return error.data.model_dump(mode="json", exclude_none=True)
        return None

    @classmethod
    def _sdk_error_detail(cls, error: ApiException) -> Optional[str]:
        """Pull the ``{"detail": ...}`` message off a generated 4xx."""
        body = cls._sdk_error_body(error)
        return body.get("detail") if body is not None else None

    def _map_edges(self, wi) -> Dict[str, Any]:
        """Project an SDK work item onto the directed-edge result shape."""
        return {
            "task_id": str(wi.id),
            "blocked_by_ids": [str(item) for item in wi.blocked_by_ids or []],
            "blocks_ids": [str(item) for item in wi.blocks_ids or []],
        }

    def set_task_blockers(
        self, task_id: str, blocked_by_ids: List[str]
    ) -> Dict[str, Any]:
        """Replace the tasks that block ``task_id``."""
        resolved_id = self._sdk_resolve_task_id(task_id)
        resolved_blockers = [self._sdk_resolve_task_id(item) for item in blocked_by_ids]
        try:
            updated = self.sdk.work_items.update_work_item(
                str(resolved_id),
                PatchedWorkItemPatch(blocked_by_ids=resolved_blockers),
            )
        except ApiException as error:
            # Self-block / cycle guards return a 4xx with a human message.
            # Surface it as a clean result, never a raw stack trace; no edge is
            # written server-side.
            detail = self._sdk_error_detail(error)
            if detail is None:
                raise
            return {"task_id": str(resolved_id), "error": detail}
        return self._map_edges(updated)

    def add_task_blocker(self, task_id: str, blocker_task_id: str) -> Dict[str, Any]:
        """Make ``task_id`` blocked by ``blocker_task_id`` (additive, idempotent)."""
        resolved_id = self._sdk_resolve_task_id(task_id)
        resolved_blocker = self._sdk_resolve_task_id(blocker_task_id)
        try:
            current = self.sdk.work_items.get_work_item(str(resolved_id))
            blockers = list(current.blocked_by_ids or [])
            if resolved_blocker not in blockers:
                blockers.append(resolved_blocker)
            updated = self.sdk.work_items.update_work_item(
                str(resolved_id), PatchedWorkItemPatch(blocked_by_ids=blockers)
            )
        except ApiException as error:
            detail = self._sdk_error_detail(error)
            if detail is None:
                raise
            return {"task_id": str(resolved_id), "error": detail}
        return self._map_edges(updated)

    def add_task_dependent(
        self, task_id: str, dependent_task_id: str
    ) -> Dict[str, Any]:
        """Make ``dependent_task_id`` depend on ``task_id``."""
        return self.add_task_blocker(dependent_task_id, task_id)

    def get_scope_context(self, id_or_key: str) -> WorktrackerScopeContext:
        """Assemble a task's dependency slice from canonical CRUD reads."""
        result = self.sdk.work_items.get_work_item(id_or_key)
        task = getattr(result, "task", result)
        neighbor_ids = {
            str(item)
            for item in (*list(task.blocked_by_ids or []), *list(task.blocks_ids or []))
        }
        listed = self.sdk.work_items.list_work_items()
        neighbors = {
            str(item.id): item for item in listed if str(item.id) in neighbor_ids
        }

        missing_ids = neighbor_ids - neighbors.keys()
        if missing_ids:
            missing = ", ".join(sorted(missing_ids))
            raise ValueError(
                f"Dependency work item(s) missing from canonical read: {missing}"
            )

        referenced = [task, *neighbors.values()]
        project_ids = {
            item.project_id for item in referenced if getattr(item, "state", None)
        }
        states = {
            str(state.id): state
            for project_id in project_ids
            for state in self.sdk.states.list_states(project_id)
        }

        def scope_ref(item):
            state_id = getattr(item, "state", None)
            state = states.get(str(state_id)) if state_id else None
            group = state.group if state is not None else None
            return {
                "id": item.id,
                "key": item.key,
                "name": item.name,
                "state_group": group,
                "resolved": _dependency_state_resolved(state),
            }

        depends_on_refs = [
            scope_ref(neighbors[str(item)]) for item in task.blocked_by_ids or []
        ]
        depended_by_refs = [
            scope_ref(neighbors[str(item)]) for item in task.blocks_ids or []
        ]

        unresolved = [item for item in depends_on_refs if not item["resolved"]]
        if unresolved:
            keys = ", ".join(item["key"] for item in unresolved)
            advisory = (
                f"{len(unresolved)} of {len(depends_on_refs)} blocker(s) unresolved "
                f"({keys}) - stay within this task; do not implement upstream work."
            )
        else:
            advisory = (
                "No unresolved blockers - deliver only this task and nothing beyond "
                "its scope."
            )

        return WorktrackerScopeContext(
            task=scope_ref(task),
            depends_on=depends_on_refs,
            depended_by=depended_by_refs,
            advisory=advisory,
        )

    @classmethod
    def _sdk_execution_error(cls, error: ApiException) -> Optional[str]:
        """Pull the execution route's ``{"error"}`` message off a 4xx body.

        Reads the message off the generated exception (``{"error", "message"}``);
        a 5xx (or non-object body) yields ``None`` so the caller re-raises. Used
        by the rooted execution surface (#894).
        """
        body = cls._sdk_error_body(error)
        if body is None:
            return None
        return body.get("error") or body.get("detail")

    def execute_dependency_graph(
        self,
        root_task_id: str,
        agent: str | None = None,
        reset: bool = False,
    ) -> Dict[str, Any]:
        """Launch eligible direct children of an armed root task (#721).

        Routes through the SDK's rooted execution resource (#894). The response
        contains only task ids launched by this call. ``reset=True`` first
        clears the root's permanent launch ledger, then performs the normal
        execute. A 4xx becomes ``{"root_id", "error"}``.
        """
        root_task_id = str(self._sdk_resolve_task_id(root_task_id))
        try:
            if reset:
                self.sdk.execution.reset_graph(root_task_id)
            result = self.sdk.execution.execute_graph(root_task_id, agent)
        except ApiException as error:
            detail = self._sdk_execution_error(error)
            if detail is None:
                raise
            return {"root_id": root_task_id, "error": detail}
        return result.model_dump(mode="json")

    def get_dependency_graph(self, root_task_id: str) -> Dict[str, Any]:
        """Read a task subtree's factual workflow state and dependency edges."""
        try:
            root_task_id = str(self._sdk_resolve_task_id(root_task_id))
            graph = self.sdk.execution.get_dependency_graph(root_task_id)
        except ApiException as error:
            detail = self._sdk_execution_error(error)
            if detail is None:
                raise
            return {"root_id": root_task_id, "error": detail}
        return graph.model_dump(mode="json")

    def launch_default_coding_agent(self, id_or_key: str) -> Dict[str, Any]:
        """Launch the current-state coding agent for a target work item (#924).

        Resolves ``id_or_key`` (UUID or ``KEY-N``) to a target id and routes
        through the SDK's rooted launch resource, which starts a normal
        task-scoped coding session whose prompt is built from the target ticket
        — no caller prompt, no orchestration/graph/planning run, no workflow
        move. Returns ``{"target_id", "agent", "agent_run_id"}`` on a durable
        launch, or ``{"target_id", "error"}`` when the backend rejects it (4xx,
        e.g. unknown target, no module ancestry, no selected profile), read off
        the generated exception body; a 5xx (e.g. unavailable tmux) propagates.
        """
        target_id = str(self._sdk_resolve_task_id(id_or_key))
        try:
            launched = self.sdk.launch.default_coding_agent(target_id)
        except ApiException as error:
            body = self._sdk_error_body(error)
            if body and body.get("code") == "required_skill_unavailable":
                return {"target_id": target_id, "error": body}
            detail = self._sdk_execution_error(error)
            if detail is None:
                raise
            return {"target_id": target_id, "error": detail}
        return launched.model_dump(mode="json")

    def reparent_tasks(
        self,
        project_id: str,
        parent_task_id: str,
        task_ids: List[str],
        module_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        del module_id
        resolved = self._resolve_project_id(project_id)
        if not resolved:
            raise ValueError(f"Could not resolve project: {project_id}")
        project_uuid = UUID(resolved)
        parent = self.sdk.work_items.get_work_item(parent_task_id)
        if parent.project_id != project_uuid:
            raise ValueError(
                f"Parent task {parent.id} is not in project {project_uuid}"
            )

        reparented = []
        skipped = []
        failed = []
        for raw_id in task_ids:
            try:
                child = self.sdk.work_items.get_work_item(raw_id)
            except NotFoundException:
                skipped.append({"task_id": raw_id, "reason": "not_found"})
                continue
            if child.id == parent.id:
                skipped.append({"task_id": raw_id, "reason": "self_parent"})
                continue
            if child.project_id != project_uuid:
                skipped.append({"task_id": raw_id, "reason": "cross_project"})
                continue
            try:
                self.sdk.work_items.update_work_item(
                    str(child.id), PatchedWorkItemPatch(parent_id=parent.id)
                )
            except ApiException as error:
                failed.append({"task_id": str(child.id), "error": str(error)})
                continue
            reparented.append(
                {
                    "task_id": str(child.id),
                    "previous_parent_id": (
                        str(child.parent_id) if child.parent_id else None
                    ),
                }
            )
        return {
            "parent_task_id": str(parent.id),
            "reparented": reparented,
            "skipped": skipped,
            "failed": failed,
        }

    def attach_file(
        self, project_id: str, task_id: str, file_path: str
    ) -> WorktrackerOperationResult:
        del project_id
        path = Path(file_path)
        if not path.is_file():
            return WorktrackerOperationResult(success=False, message="File not found")
        task_uuid = self._sdk_resolve_task_id(task_id)
        try:
            attachment = self.sdk.attachments.upload_attachment(
                task_uuid, (path.name, path.read_bytes())
            )
        except ApiException as error:
            return WorktrackerOperationResult(
                success=False,
                message=f"Upload failed: {error.status}",
            )
        return WorktrackerOperationResult(
            success=True,
            message="Attached",
            data={"asset_id": str(attachment.id)},
        )


def get_worktracker_service() -> WorktrackerService:
    """Build a service reading owned-backend env vars on each call."""
    return WorktrackerService()
