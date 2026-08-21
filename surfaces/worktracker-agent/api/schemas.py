from typing import Any, List, Optional
from uuid import UUID
from pydantic import BaseModel, Field

class WorktrackerConfig(BaseModel):
    base_url: str
    api_key: Optional[str] = None

class WorktrackerProject(BaseModel):
    id: UUID
    name: str
    identifier: str
    description: Optional[str] = None

class WorktrackerIssueType(BaseModel):
    """A configurable, first-class issue type (CODIN-890).

    Mirrors the backend ``IssueTypeOut``. ``level`` is the frozen binary bucket
    (``module`` or ``task``) each named type pins to — the discriminator the
    unified ``Issue`` table branches on. This is the coherent home CODIN-883
    resolves an explicitly selected name against.
    """

    id: UUID
    name: str
    level: str
    color: Optional[str] = None
    sort_order: int = 0

class WorktrackerModule(BaseModel):
    """A module — an ``Issue`` of level ``module`` (CODIN-890).

    Modules are not a distinct kind: they are issues discriminated by
    ``issue_type.level == "module"``, addressed by the same
    ``key``/``sequence_id`` scheme as any task. Mirrors the backend ``ModuleOut``.
    """

    id: UUID
    name: str
    project_id: UUID
    sequence_id: int
    key: str
    is_archived: bool = False
    issue_type: WorktrackerIssueType

class WorktrackerState(BaseModel):
    id: UUID
    name: str
    group: str

class WorktrackerTask(BaseModel):
    id: UUID
    name: str
    project_id: UUID
    state_id: Optional[UUID] = None
    description: Optional[str] = None
    sequence_id: int
    key: Optional[str] = None  # e.g. PROJ-123
    # A task is an ``Issue`` of level ``task`` (CODIN-890). ``parent_id`` is the
    # single tree link (epic membership or subtask parent, resolved by type on
    # the backend); ``issue_type`` carries the named type + its ``level`` — the
    # real discriminator now that modules and tasks share one table.
    parent_id: Optional[UUID] = None
    issue_type: WorktrackerIssueType
    is_archived: bool = False
    # Directed blocker edges (#624). ``blocked_by_ids`` = tasks blocking this
    # one; ``blocks_ids`` = the reverse. Bare id arrays so an agent can see
    # existing dependencies without a separate call.
    blocked_by_ids: List[UUID] = Field(default_factory=list)
    blocks_ids: List[UUID] = Field(default_factory=list)
class WorktrackerAttachmentInfo(BaseModel):
    id: UUID
    name: str
    mime_type: str
    size: int
    asset_url: str

class WorktrackerTaskDetail(WorktrackerTask):
    sub_tasks: List["WorktrackerTask"] = Field(default_factory=list)
    attachments: List[WorktrackerAttachmentInfo] = Field(default_factory=list)

class WorktrackerOperationResult(BaseModel):
    success: bool
    message: str
    data: Optional[Any] = None


class WorktrackerScopeRef(BaseModel):
    """A compact reference to one neighbor in a scope-context (#667)."""

    id: UUID
    key: str
    name: str
    state_group: Optional[str] = None
    resolved: bool = False


class WorktrackerScopeContext(BaseModel):
    """Read-only dependency slice for a task (#670). Mirrors the backend payload."""

    task: WorktrackerScopeRef
    depends_on: List[WorktrackerScopeRef] = Field(default_factory=list)
    depended_by: List[WorktrackerScopeRef] = Field(default_factory=list)
    advisory: str
