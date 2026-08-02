from __future__ import annotations

from apps.execution.state import Phase
from worktracker.models import Issue


def initial_prompt_for(phase: Phase, issue: Issue) -> str | None:
    if phase == "implement":
        return None
    if phase == "refine":
        return _refine_prompt(issue)
    if phase == "split":
        return _split_prompt(issue)
    if phase == "register":
        return _register_prompt(issue)
    if phase == "lld":
        return _lld_prompt(issue)
    raise ValueError(f"unknown_phase:{phase}")


def _refine_prompt(issue: Issue) -> str:
    description = issue.description or ""
    return (
        "Run a relentless refinement interview for this Backlog task. "
        "Use the existing WorkTracker/task context and ask the human questions in this "
        "terminal until the requirements are clear. Produce a distilled visual "
        "HLD in the task spec directory when the run context provides one, update "
        "the task description with the clarified requirements, then move the "
        "task through its configured workflow transition when the human approves. "
        "Do not implement code.\n\n"
        f"Task id: {issue.id}\n"
        f"Task key: {issue.key}\n"
        f"Task title: {issue.name}\n"
        f"Project id: {issue.project_id}\n"
        f"Project slug: {issue.project.slug}\n"
        f"Description:\n{description}"
    )


def _register_prompt(issue: Issue) -> str:
    description = issue.description or ""
    return (
        "This task's HLD split proposal was just approved. Act as a "
        "split-registration agent: turn the approved "
        "proposal into real tracker work items. Read the approved visual HLD in "
        "this task's spec directory and extract the proposed leaf tasks and the "
        "intended blocked_by dependency edges.\n\n"
        "Then register the split against this task using the WorkTracker tools:\n"
        "- Each proposed leaf carries a stable slug. Before creating a leaf, "
        "look up this task's existing children for that slug (embed the slug "
        "deterministically in the child title/description marker) and SKIP "
        "creation if the slug already exists.\n"
        "- Create each missing leaf as a type=task child of THIS task, landing "
        "in the Todo state (not Backlog), tagged with its stable slug.\n"
        "- Wire each intended directed blocked_by edge; SKIP any edge the "
        "target's blocked_by already contains, and respect the server-side "
        "cycle guard.\n"
        "- On the FIRST create or edge-wire failure: stop immediately, report "
        "the partial state clearly (what was created, what failed, why), and "
        "do NOT claim registration complete.\n\n"
        "Do NOT generate leaf-level LLDs, do NOT implement code, and do NOT "
        "ask for a second approval — the proposal was already approved.\n\n"
        f"Task id: {issue.id}\n"
        f"Task key: {issue.key}\n"
        f"Task title: {issue.name}\n"
        f"Project id: {issue.project_id}\n"
        f"Project slug: {issue.project.slug}\n"
        f"HLD/PRD context:\n{description}"
    )


def _lld_prompt(issue: Issue) -> str:
    description = issue.description or ""
    parent = issue.parent
    parent_id = getattr(parent, "id", None) or issue.parent_id
    parent_key = getattr(parent, "key", None)
    parent_title = getattr(parent, "name", None)
    return (
        "This Todo task is one leaf of an approved implementation split tree. "
        "The parent task carries the locked PRD/HLD that this split was derived "
        "from. Act as a leaf-LLD agent for THIS leaf only.\n\n"
        "First read the parent task's approved visual HLD in the PARENT task's "
        "spec directory for the overall design, the split-tree shape, and how "
        "this leaf fits (its scope boundary and its blocked_by dependencies). "
        "Then explore the code context relevant to THIS leaf's scope.\n\n"
        "Write a split-level LLD for THIS leaf as a visual HTML page in THIS "
        "leaf task's own spec directory, following the repo HLD/LLD document "
        "convention. The LLD must define exactly what this one leaf changes "
        "(exact files and change scope), how it will be tested, and what is "
        "explicitly out of scope — including work owned by sibling leaves and "
        "the parent.\n\n"
        "Do NOT implement code, do NOT create tasks, do NOT wire blocked_by "
        "edges, and do NOT re-open the parent PRD/HLD decisions. If you find a "
        "contradiction that must return to human review, surface it and stop "
        "rather than deciding it. This leaf stays in Todo; a written LLD is the "
        "only deliverable.\n\n"
        f"Leaf task id: {issue.id}\n"
        f"Leaf task key: {issue.key}\n"
        f"Leaf task title: {issue.name}\n"
        f"Parent task id: {parent_id}\n"
        f"Parent task key: {parent_key}\n"
        f"Parent task title: {parent_title}\n"
        f"Project id: {issue.project_id}\n"
        f"Project slug: {issue.project.slug}\n"
        f"Leaf description:\n{description}"
    )


def _split_prompt(issue: Issue) -> str:
    description = issue.description or ""
    return (
        "This Todo task carries a locked PRD. Act as an HLD/splitter agent. "
        "Explore the relevant code context and use to-issues-style tracer-bullet "
        "reasoning to write a code-context-aware visual HLD in the task spec "
        "directory. The HLD must decide the implementation shape needed before "
        "splitting (database touch, backend/frontend/component boundaries, "
        "service/API seams, data flow, migration needs, risk areas) and propose "
        "an implementation split tree: the leaf task breakdown plus the intended "
        "blocked_by dependency edges, with scope boundaries and explicit "
        "non-goals. Present the proposal for human review.\n\n"
        "Do NOT create any tasks, do NOT wire any blocked_by edges, do NOT write "
        "leaf-level LLDs, and do NOT implement code. The split is a proposal only. "
        "When the human approves the HLD, move this same task through its "
        "configured workflow transition. Split registration happens in a later "
        "phase.\n\n"
        f"Task id: {issue.id}\n"
        f"Task key: {issue.key}\n"
        f"Task title: {issue.name}\n"
        f"Project id: {issue.project_id}\n"
        f"Project slug: {issue.project.slug}\n"
        f"PRD:\n{description}"
    )
