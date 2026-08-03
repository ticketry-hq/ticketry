import uuid
from datetime import datetime
from typing import List, Literal, Optional

from ninja import Schema
from pydantic import field_validator, model_validator
from pydantic_core import PydanticCustomError


# --- Output shapes ----------------------------------------------------------
# Chosen field-for-field so S3's repository deserializes them straight into the
# unchanged core/models.py pydantic types — no field gymnastics.


class StateOut(Schema):
    """One workflow state — mirrors core.TaskState (plus additive sort_order)."""

    id: Optional[uuid.UUID] = None
    name: str
    group: str = ""
    color: Optional[str] = None
    sort_order: int = 0
    is_protected: bool = False


class StateImpactWorkItemCountOut(Schema):
    issue_type_id: Optional[uuid.UUID] = None
    issue_type_name: Optional[str] = None
    count: int


class WorkflowStateReferenceOut(Schema):
    issue_type_id: uuid.UUID
    issue_type_name: str
    revision: int
    roles: List[str] = []


class StateProtectionRuleOut(Schema):
    code: str
    message: str


class StateImpactOut(Schema):
    state_id: uuid.UUID
    impact_token: str
    total_work_items: int
    work_item_counts: List[StateImpactWorkItemCountOut] = []
    workflow_references: List[WorkflowStateReferenceOut] = []
    protection_rules: List[StateProtectionRuleOut] = []
    valid_replacements: List[StateOut] = []


class IssueTypeOut(Schema):
    """A configurable issue type (G1, S6). ``level`` is the frozen binary bucket."""

    id: uuid.UUID
    name: str
    level: str
    color: Optional[str] = None
    sort_order: int = 0


class ProjectOut(Schema):
    """A project; ``slug`` is the project key.

    ``description`` is plain markdown text (the model field is ``blank=True``,
    so existing rows serialize as ``""``); rendering/sanitization is FE-only.
    """

    id: uuid.UUID
    name: str
    slug: str
    description: str = ""


class WorkspaceOut(Schema):
    """The installation workspace state available before project selection."""

    id: uuid.UUID
    slug: str
    name: str
    onboarding_required: bool


class ModuleOut(Schema):
    """A module issue — mirrors core.ModuleSummary plus additive key fields."""

    id: uuid.UUID
    name: str
    project_id: uuid.UUID
    sequence_id: int
    key: str
    is_archived: bool = False
    issue_type: IssueTypeOut


class WorkItemOut(Schema):
    """A task issue — mirrors core.TaskSummary exactly, plus additive ``key``.

    ``state`` is always one nested object (or null), never a bare id and never
    a sibling ``state_detail`` — the schizophrenic-state branch is impossible
    here by construction.
    """

    id: uuid.UUID
    name: str
    project_id: uuid.UUID
    sequence_id: Optional[int] = None
    state: Optional[StateOut] = None
    state_revision: int = 0
    description: Optional[str] = None
    parent_id: Optional[uuid.UUID] = None
    sub_issues_count: int = 0
    key: str
    is_archived: bool = False
    # Audit timestamps (G07). Columns are ``auto_now_add`` / ``auto_now`` so no
    # migration is needed; ninja serializes datetime as ISO automatically.
    created_at: datetime
    updated_at: datetime
    # Fractional-index sort key for within-column reorder (#626). One global key
    # per issue; the client sorts each column's members by it and resolves a
    # drop's neighbors from it. Reorder (not patch) is the only write path.
    rank: str = ""
    issue_type: IssueTypeOut
    # Directed blocker edges (#624), additive bare id arrays. ``blocked_by_ids``
    # = the issues blocking this one (editable); ``blocks_ids`` = the reverse
    # edges this one blocks (read-only). The FE resolves each id → key/state
    # from its already-loaded project tree.
    blocked_by_ids: List[uuid.UUID] = []
    blocks_ids: List[uuid.UUID] = []

    @staticmethod
    def resolve_blocked_by_ids(obj):
        """The ids of the issues blocking this one (forward edge)."""
        return [i.id for i in obj.blocked_by.all()]

    @staticmethod
    def resolve_blocks_ids(obj):
        """The ids of the issues this one blocks (reverse edge, read-only)."""
        return [i.id for i in obj.blocks.all()]

    @staticmethod
    def resolve_sub_issues_count(obj):
        """Prefer the annotated child count; fall back to a direct count."""
        annotated = getattr(obj, "child_count", None)

        return annotated if annotated is not None else obj.children.count()


class AttachmentOut(Schema):
    """One stored attachment, with a resolvable media URL (C6)."""

    id: uuid.UUID
    filename: str
    mime_type: str = ""
    size: Optional[int] = None
    url: str

    @staticmethod
    def resolve_url(obj):
        """Return the stored file's media URL."""
        return obj.file.url


class WorkItemDetailOut(Schema):
    """The retrieve envelope — mirrors core.TaskDetails plus attachments."""

    task: WorkItemOut
    attachments: List[AttachmentOut] = []


class ScopeRef(Schema):
    """A compact, agent-readable reference to one issue in a scope-context (#667).

    ``state_group`` is the issue's frozen group (``None`` when it has no state);
    ``resolved`` is ``True`` iff that group is completed/cancelled.
    """

    id: uuid.UUID
    key: str
    name: str
    state_group: Optional[str] = None
    resolved: bool = False


class ScopeContextOut(Schema):
    """The read-only dependency slice a subagent consumes for a task (#667, B).

    Derived entirely from the existing ``blocked_by``/``blocks`` edges (#624).
    ``depends_on`` are the direct blockers (must land first), ``depended_by`` the
    direct dependents (wait on this task), and ``advisory`` a short
    natural-language summary.
    """

    task: ScopeRef
    depends_on: List[ScopeRef] = []
    depended_by: List[ScopeRef] = []
    advisory: str


# --- Input shapes -----------------------------------------------------------


class WorkItemInput(Schema):
    """Shared guard for the intentionally removed work-item priority field."""

    @model_validator(mode="before")
    @classmethod
    def reject_retired_priority(cls, value):
        raw = getattr(value, "_obj", value)
        if isinstance(raw, dict) and "priority" in raw:
            raise PydanticCustomError(
                "removed_field",
                "Work-item priority has been removed.",
                {"field": "priority", "location": "body"},
            )
        return value


class ProjectIn(Schema):
    """Body for project create — name + slug, optional workspace.

    ``workspace_slug`` is omitted on single-workspace installs; the route then
    resolves the sole workspace.
    """

    name: str
    slug: str
    description: Optional[str] = None
    workspace_slug: Optional[str] = None

    @field_validator("slug")
    @classmethod
    def normalize_project_key(cls, value):
        normalized = value.upper()
        if len(normalized) != 3 or not all(
            "A" <= character <= "Z" for character in normalized
        ):
            raise PydanticCustomError(
                "project_key",
                "Project key must be exactly three letters, using only A-Z.",
            )
        return normalized


class ProjectPatch(Schema):
    """Body for a project edit — name and/or markdown description; only present
    fields are applied. ``slug``/``key`` are immutable, so slug is never a field
    here.
    """

    name: Optional[str] = None
    description: Optional[str] = None


class ModuleIn(Schema):
    """Body for module create — name and explicit module-level issue type."""

    name: str
    issue_type_id: uuid.UUID


class WorkItemIn(WorkItemInput):
    """Body for a project-scoped task create.

    ``parent_id`` is the module (a module id) or the parent task (a task id), or
    null for an unparented task.
    """

    name: str
    description: Optional[str] = None
    parent_id: Optional[uuid.UUID] = None
    state_id: Optional[uuid.UUID] = None
    issue_type_id: uuid.UUID


class ModuleWorkItemIn(WorkItemInput):
    """Body for a module-scoped task create (parent is the module)."""

    name: str
    description: Optional[str] = None
    issue_type_id: uuid.UUID


class ReviewFindingIn(Schema):
    """Body for the dedicated review-finding create (#905).

    ``parent_id`` is the Story-in-``Review`` the finding attaches to; the child
    is always born in the Implementation workflow's start stage and typed
    ``Implementation`` server-side. ``description`` carries the caller-rendered
    ``Path`` / ``Lines`` / ``Note`` evidence block verbatim.
    """

    parent_id: uuid.UUID
    name: str
    description: str


class WorkItemPatch(WorkItemInput):
    """PATCH body — every field optional; only present fields are applied.

    ``parent_id`` reparents the issue (covers the absent reparent_tasks tool
    via data); ``state_id`` reassigns its state.
    """

    state_id: Optional[uuid.UUID] = None
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[uuid.UUID] = None
    # Replace-set of blocker ids (#624). Present ``[]`` clears all blockers;
    # absent (exclude_unset) leaves them untouched. No ``blocks_ids`` field —
    # the reverse side is read-only and edited from the other issue.
    blocked_by_ids: Optional[List[uuid.UUID]] = None
    # State-change caller. Omitted writes remain human for REST compatibility.
    origin: Literal["human", "agent"] = "human"


# --- Config write-bodies (S6 · G1/G2) ---------------------------------------


class IssueTypeIn(Schema):
    """Body for issue-type create — name + level required, the rest optional."""

    name: str
    level: str
    color: Optional[str] = None


class IssueTypePatch(Schema):
    """PATCH body for an issue type — every field optional, level immutable."""

    name: Optional[str] = None
    color: Optional[str] = None
    sort_order: Optional[int] = None


class StateIn(Schema):
    """Body for state create — name + group required, color optional."""

    name: str
    group: str
    color: Optional[str] = None


class StatePatch(Schema):
    """PATCH body for a state — every field optional; group stays within the 5."""

    name: Optional[str] = None
    color: Optional[str] = None
    group: Optional[str] = None
    sort_order: Optional[int] = None


class ReorderIn(Schema):
    """Body for a bulk reorder — the full set of ids in their new order."""

    ordered_ids: List[uuid.UUID]


class ScopedWorkflowTransitionOut(Schema):
    from_state_id: uuid.UUID
    to_state_id: uuid.UUID
    agent_allowed: bool


class ScopedWorkflowLaunchBindingOut(Schema):
    state_id: uuid.UUID
    prompt: str
    required_skills: List[str]
    agent: Optional[str] = None
    model: Optional[str] = None
    reasoning: Optional[str] = None
    auto_start: bool
    subtree_run_enabled: bool


class WorkflowStandingWarningOut(Schema):
    code: str
    state_id: Optional[uuid.UUID] = None
    message: str


class ScopedWorkflowOut(Schema):
    issue_type_id: uuid.UUID
    start_state_id: Optional[uuid.UUID] = None
    workflow_revision: int
    transitions: List[ScopedWorkflowTransitionOut] = []
    launch_bindings: List[ScopedWorkflowLaunchBindingOut] = []
    warnings: List[WorkflowStandingWarningOut] = []


class ScopedWorkflowImpactIn(Schema):
    operation: Literal["remove_state", "remove_transition", "set_start_state"]
    workflow_revision: int
    state_id: Optional[uuid.UUID] = None
    from_state_id: Optional[uuid.UUID] = None
    to_state_id: Optional[uuid.UUID] = None


class ScopedWorkflowImpactOut(Schema):
    workflow_revision: int
    deleted_transitions: List[ScopedWorkflowTransitionOut] = []
    deleted_launch_bindings: List[ScopedWorkflowLaunchBindingOut] = []
    disabled_auto_start_state_ids: List[uuid.UUID] = []


class WorkflowRevisionIn(Schema):
    workflow_revision: int


class AddWorkflowTransitionIn(WorkflowRevisionIn):
    from_state_id: uuid.UUID
    to_state_id: uuid.UUID
    agent_allowed: bool = True


class SetWorkflowTransitionPermissionIn(WorkflowRevisionIn):
    agent_allowed: bool


class SetWorkflowStartStateIn(WorkflowRevisionIn):
    state_id: uuid.UUID


class ScopedLaunchBindingIn(WorkflowRevisionIn):
    prompt: Optional[str] = None
    required_skills: Optional[List[str]] = None
    agent: Optional[str] = None
    model: Optional[str] = None
    reasoning: Optional[str] = None


class SetWorkflowAutoStartIn(WorkflowRevisionIn):
    auto_start: bool


class SetWorkflowSubtreeRunIn(WorkflowRevisionIn):
    enabled: bool


class LaunchBindingOut(Schema):
    issue_type_id: uuid.UUID
    state_id: uuid.UUID
    prompt: str
    required_skills: List[str]
    agent: Optional[str] = None
    model: Optional[str] = None
    reasoning: Optional[str] = None


class ProviderCapabilitiesOut(Schema):
    agent: str
    accepts_model: bool
    accepts_any_model: bool
    model_prefixes: List[str] = []
    model_aliases: List[str] = []
    reasoning_levels: List[str] = []


class WorkItemReorderIn(Schema):
    """Body for a within-column work-item reorder (#626).

    The moved item's destination neighbors in its column: ``before_id`` is the
    row it lands *below* (smaller rank), ``after_id`` the row it lands *above*
    (larger rank). Either is null for the top / bottom / an empty column. The
    server computes a fractional key strictly between their ranks and writes
    only the moved row — never a computed key sent by the client.
    """

    before_id: Optional[uuid.UUID] = None
    after_id: Optional[uuid.UUID] = None
