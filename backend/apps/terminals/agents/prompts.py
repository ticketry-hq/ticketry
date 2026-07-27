"""Launch-prompt builders for the four spawn modes.

Pure prompt construction: a :class:`~studio_server.contracts.TaskSummary` (or
module summary) in, a prompt string out. No process launching, no hook
injection — those live in :mod:`terminals.agents.commands` and
:mod:`terminals.agents.injectors`.
"""

import re
from typing import Optional

from apps.documents.design_docs import module_dir_name
from apps.settings_store.config import Profile, config
from studio_server.contracts import ModuleSummary, TaskSummary


_DESIGN_DOC_VISUAL_CONTRACT = (
    "Use a calm light surface, shared token palette, and system font. Keep a sticky "
    "header with an uppercase crumb, title, one-line summary, and status chips; add "
    "scroll-spy navigation and lead each section with a heading and short lede. "
    "Include a clickable SVG diagram whose side panel explains each node's "
    "responsibilities and non-responsibilities, with non-responsibilities in red "
    "and dashed strokes reserved for deferred seams; use the same convention for "
    "numbered sequence steps. Keep a requirement-trace table that highlights its "
    "matching diagram nodes, a color-coded file change-map tree, and a closing green "
    "acceptance-signal callout."
)


def _strip_html(text: str) -> str:
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</p>', '\n\n', text, flags=re.IGNORECASE)
    text = re.sub(r'</li>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<[^>]+>', '', text)
    return text.strip()


def _design_dir_block(design_dir: str) -> str:
    """Return factual design-directory context without workflow guidance."""

    return f"Design directory: {design_dir}\n"


def build_context_prompt(
    task: TaskSummary,
    module_id: Optional[str] = None,
    additional_prompt: Optional[str] = None,
    design_dir: Optional[str] = None,
    profile: Optional[Profile] = None,
    workflow_prompt: Optional[str] = None,
) -> str:
    """Build a context prompt string from a TaskSummary."""
    name = task.name or "Untitled"

    state_name = task.state.name if task.state else "Unknown"
    issue_type_name = task.issue_type or "Unknown"

    assignees_list = []
    for a in task.assignees:
        if a.display_name:
            assignees_list.append(a.display_name)
        elif a.email:
            assignees_list.append(a.email)

    assignees = ", ".join(assignees_list) or "Unassigned"

    raw_desc = (
        task.description_html
        or task.description_stripped
        or task.description
        or ""
    )
    desc = _strip_html(raw_desc) if raw_desc else "No description provided."

    project_id = task.project_id
    work_item_id = task.id
    seq = task.sequence_id
    ticket_ref = f" (ticket #{seq})" if seq else ""
    # A launch resolves its profile immediately before building the prompt.
    # Prefer that fresh profile over the process-start configuration snapshot,
    # whose prompt overrides may be stale after a Settings save.
    active_profile = profile if profile is not None else config.current_profile
    workspace_slug = getattr(active_profile, "workspace_slug", "")
    module_folder = ""
    if active_profile and module_id:
        module_folder = active_profile.module_folders.get(module_id, "")

    # A selected workflow prompt is opaque project-owned guidance. Profile
    # prompt maps are retained only as upgrade input and never participate in
    # launch-time resolution.
    prompt_prefix = ""
    state_prompt = workflow_prompt

    if state_prompt:
        prompt_prefix = f"Selected workflow prompt:\n{state_prompt}\n\n"

    final_prompt = (
        f"{prompt_prefix}Work item context (factual):\n"
        f"Source: WorkTracker{ticket_ref}\n"
        f"Task: {name}\n"
        f"Work Item ID: {work_item_id}\n"
        f"Project ID: {project_id}\n"
        f"Workspace Slug: {workspace_slug}\n"
        f"Module ID: {module_id or ''}\n"
        f"Local Module Folder: {module_folder or ''}\n"
        f"State: {state_name}\n"
        f"Type: {issue_type_name}\n"
        f"Assignees: {assignees}\n\n"
        f"Description:\n{desc}\n\n"
    )

    if additional_prompt:
        final_prompt += f"Additional user instructions:\n{additional_prompt}\n\n"

    # Idea-stage launches produce no design documents, so withhold this block (#943).
    if design_dir and state_name.lower() != "idea":
        final_prompt += _design_dir_block(design_dir)

    final_prompt += "Available tools: WorkTracker MCP server; coding agent status tool."
    return final_prompt


def build_planning_context_prompt(
    module: ModuleSummary,
    tasks: list[TaskSummary],
    workspace_slug: str,
    project_id: str,
    folder: Optional[str],
    design_dir: Optional[str] = None,
) -> str:
    """Build a planning context prompt that instructs the agent to lead a feature planning session."""
    task_lines = []
    for t in tasks:
        state_name = t.state.name if t.state else "Unknown"
        seq = f"#{t.sequence_id} " if t.sequence_id else ""
        task_lines.append(f"  - {seq}{t.name} [{state_name}]")
    tasks_summary = "\n".join(task_lines) if task_lines else "  (no tasks yet)"

    # Planning runs additionally carry the migrate-on-promotion contract:
    # only the agent knows the key of the task it creates.

    design_block = ""
    if design_dir:
        design_block = (
            f"\n\n{_design_dir_block(design_dir).rstrip()}\n"
            f"After you create a WorkTracker task for the planned feature, move "
            f"this directory's contents to the task's canonical design "
            f"directory spec/{module_dir_name(module)}/T<sequence>--<short-"
            f"task-slug>/ (sequence = the new task's ticket number, slug = "
            f"lowercase dashed words from its name) so the documents follow "
            f"the task."
        )

    return (
        f"You are a planning assistant helping design new features for the '{module.name}' module.\n\n"
        f"Context:\n"
        f"  Workspace: {workspace_slug}\n"
        f"  Project ID: {project_id}\n"
        f"  Module ID: {module.id}\n"
        f"  Local Codebase: {folder or '(not set)'}\n\n"
        f"Existing tasks in this module:\n{tasks_summary}\n\n"
        f"Your job:\n"
        f"  1. Start by asking the user what they want to build.\n"
        f"  2. Use the WorkTracker MCP server to look up related tasks in the module or project "
        f"to understand what already exists and avoid duplication.\n"
        f"  3. If a local codebase folder is set, explore it to understand how the relevant "
        f"parts of the system currently work.\n"
        f"  4. Through conversation, help the user refine the idea — clarify scope, surface "
        f"edge cases, and break it into concrete pieces.\n"
        f"  5. Once the feature is fully fleshed out, create one or more well-described tasks "
        f"in WorkTracker via the WorkTracker MCP server. Each task should have a clear description and "
        f"acceptance criteria and be assigned to module {module.id}."
        f"{design_block}\n\n"
        f"Do not start implementing. This is a planning session only."
    )


def build_instant_change_prompt(
    module: ModuleSummary,
    workspace_slug: str,
    project_id: str,
    folder: Optional[str],
    user_input: str,
    design_dir: Optional[str] = None,
    *,
    allow_self_termination: bool,
) -> str:
    """Build a prompt for a small, instant change inside a module.

    :param module: Module the change targets.
    :param workspace_slug: WorkTracker workspace slug.
    :param project_id: WorkTracker project ID.
    :param folder: Local codebase folder for the module, if set.
    :param user_input: The user's free-form change request.
    :param design_dir: Repo-relative design directory for this run, if any.
    :param allow_self_termination: Whether the provider receives WorkTracker MCP tools.
    :return: Prompt string for the agent.
    """

    design_block = f"{_design_dir_block(design_dir)}" if design_dir else ""
    steps: list[tuple[str, ...]] = []
    if allow_self_termination:
        steps.append(
            (
                "Before beginning any work, ask the user exactly once: 'May I terminate this run",
                "after I successfully complete this requested change?' Wait for their response.",
                "Only an explicit affirmative response authorizes self-termination. Refusal,",
                "an ambiguous response, or no response means the run must stay open. Remember",
                "that decision for this run and this request; do not ask again.",
            )
        )
    steps.extend(
        [
            (
                "Make the change the user described directly. This is intentionally",
                "lightweight — no WorkTracker task is being tracked for it.",
            ),
            (
                "If a local codebase folder is set, explore only what you need to",
                "make the change safely.",
            ),
            (
                "Keep the scope tight to exactly what was asked. Do not refactor,",
                "expand scope, or create WorkTracker tasks.",
            ),
            (
                "If the change turns out to be larger than expected or ambiguous,",
                "stop and tell the user it should be planned properly via the",
                "'n' (Plan Feature) flow instead of done instantly.",
            ),
        ]
    )
    if allow_self_termination:
        steps.extend(
            [
                (
                    "After the work completes successfully and is validated, briefly report what changed.",
                    "Only after that report, and only if the user explicitly authorized it, invoke",
                    "terminate_current_run with no arguments.",
                ),
                (
                    "Never invoke self-termination when the work is blocked, failed, ambiguous, or",
                    "larger than expected. Without explicit authorization, leave the run open.",
                    "Do not update any WorkTracker task state.",
                ),
            ]
        )
    else:
        steps.append(
            (
                "When done, briefly confirm what you changed. Do not update any",
                "WorkTracker task state.",
            )
        )
    job = "".join(
        f"  {number}. {lines[0]}\n"
        + "".join(f"     {line}\n" for line in lines[1:])
        for number, lines in enumerate(steps, start=1)
    ) + "\n"

    return (
        f"You are an agent making a small, instant change in the '{module.name}' module.\n\n"
        f"Context:\n"
        f"  Workspace: {workspace_slug}\n"
        f"  Project ID:  {project_id}\n"
        f"  Module ID:   {module.id}\n"
        f"  Local Codebase: {folder or '(not set)'}\n\n"
        f"User's request:\n"
        f"  {user_input}\n\n"
        f"Your job:\n"
        f"{job}"
        f"{design_block}"
        f"Do not create or update WorkTracker tasks for this work."
    )


def build_doc_chat_prompt(
    doc_rel_path: str,
    module_id: Optional[str] = None,
    user_input: Optional[str] = None,
) -> str:
    """Prompt for a doc-scoped overlay agent editing one generated doc (#625).

    The run launches in the document's own design directory (its ``root_dir``),
    so the target file and its sibling generated docs are right here. The prompt
    names the exact target file, describes the visual design language to retain,
    folds in the user's change request, and forbids creating new docs or
    wandering beyond the target.

    The viewer's #521 watcher live-reloads the tab when the file is saved, so the
    prompt tells the agent it need do nothing extra to refresh it.

    :param doc_rel_path: the target document's path, relative to its design
        directory (which is the run's working directory).
    :param module_id: module whose local folder is named for orientation.
    :param user_input: the user's requested change, if supplied on summon.
    :return: the doc-chat prompt string.
    """

    module_folder = ""
    if config.current_profile and module_id:
        module_folder = config.current_profile.module_folders.get(module_id, "")

    prompt = (
        f"You are editing one generated design document in place.\n\n"
        f"Target document (in your working directory): {doc_rel_path}\n"
        f"Local Module Folder: {module_folder or ''}\n\n"
        f"Your working directory is this document's design directory, so the "
        f"target file and its sibling generated docs are right here.\n\n"
        f"Your job:\n"
        f"  1. Edit the target document above directly, in place. Do not create "
        f"a new file, a copy, or a document under any other location.\n"
        f"  2. Preserve the document's visual design language: its token palette, "
        f"system font, interactive diagrams, low-text / high-structure layout, "
        f"existing structure, and vocabulary. For an HLD or LLD, retain this "
        f"contract: {_DESIGN_DOC_VISUAL_CONTRACT}\n"
        f"  3. You may read the other generated docs in this directory for "
        f"reference. Do not modify anything beyond the target document unless "
        f"the user explicitly asks you to.\n"
        f"  4. When you save the file, the viewer reloads it automatically — you "
        f"need do nothing extra to refresh it.\n\n"
    )

    if user_input and user_input.strip():
        prompt += f"The user's requested change:\n{user_input.strip()}\n"
    else:
        prompt += (
            "Start by asking the user what they want to change about this "
            "document.\n"
        )
    return prompt
