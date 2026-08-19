"""Canonical design-directory contract (ticket #521).

Pure path calculation for the per-task / per-planning-run directories that
agents write user-reviewable HTML and Markdown design documents into, plus the
two small filesystem helpers (create, scan) the launch and restore paths share.

Layout, relative to a module's local folder (the agent's cwd):

- task run:     ``spec/<module-slug>--<module_id8>/<KEY>--<task-slug>/``
- planning run: ``spec/<module-slug>--<module_id8>/planning/<run_id8>/``

Key characteristics:

- Trailing id/key components are authoritative for lookup; slugs are
  cosmetic, so renames never orphan an existing directory.
- Everything except :func:`ensure_dir` and :func:`scan_documents` is computable
  without touching the filesystem.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

from apps.documents.git_exclude import exclude_directory
from studio_server.contracts import ModuleSummary, TaskSummary

# Slug length budgets keep directory names readable, per LLD.
MODULE_SLUG_MAX = 24
TASK_SLUG_MAX = 40

SPEC_ROOT = "spec"
PLANNING_SUBDIR = "planning"
DOCUMENT_EXTENSIONS = {".html", ".md"}


def doc_label(rel_path: str) -> str:
    """Human tab label for a document: the filename stem."""

    return Path(rel_path).stem


def slugify(text: str, max_len: int) -> str:
    """Reduce free text to a filesystem-safe lowercase slug.

    Every run of non-alphanumeric characters collapses to a single dash;
    the result is trimmed and truncated without a trailing dash.

    :param text: arbitrary human-readable name.
    :param max_len: maximum slug length.
    :return: slug, or ``untitled`` when nothing survives.
    """

    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    slug = slug[:max_len].rstrip("-")
    return slug or "untitled"


def module_dir_name(module: ModuleSummary) -> str:
    """Directory name for a module: readable slug + authoritative id suffix.

    :param module: the WorkTracker module.
    :return: e.g. ``platform--35f9e33a``.
    """

    return f"{slugify(module.name, MODULE_SLUG_MAX)}--{module.id[:8]}"


def _task_key(task: TaskSummary) -> str:
    """Stable, rename-proof key prefix for a task directory.

    TaskSummary carries no WorkTracker project identifier, so the key is the
    ticket sequence (``T521``) with the raw id as a last resort.
    """

    if task.sequence_id:
        return f"T{task.sequence_id}"
    return task.id[:8]


def task_dir_name(task: TaskSummary) -> str:
    """Directory name for a task: stable key + readable slug.

    :param task: the WorkTracker work item.
    :return: e.g. ``T521--display-generated-html``.
    """

    return f"{_task_key(task)}--{slugify(task.name, TASK_SLUG_MAX)}"


def task_design_dir(module: ModuleSummary, task: TaskSummary) -> str:
    """Repo-relative canonical design directory for a task-bound run.

    :param module: module the task belongs to.
    :param task: the WorkTracker work item.
    :return: relative POSIX path ending in the task directory.
    """

    return f"{SPEC_ROOT}/{module_dir_name(module)}/{task_dir_name(task)}"


def planning_design_dir(module: ModuleSummary, agent_run_id: str) -> str:
    """Repo-relative design directory for a planning/instant scratch run.

    :param module: module the run targets.
    :param agent_run_id: the run's stable id; first 8 chars scope the dir.
    :return: relative POSIX path under the module's planning area.
    """

    return (
        f"{SPEC_ROOT}/{module_dir_name(module)}/{PLANNING_SUBDIR}/"
        f"{agent_run_id[:8]}"
    )


def resolve_task_design_dir(
    root: Path,
    module: ModuleSummary,
    task: TaskSummary,
) -> str:
    """Resolve a task's design dir under ``root``, reusing renamed matches.

    Lookup is by the authoritative components only: any existing
    ``spec/*--<module_id8>/`` directory matches the module, and inside it any
    child starting with ``<KEY>--`` matches the task — so a module or task
    rename keeps pointing at the directory created earlier. With no match
    the freshly computed canonical name is returned.

    :param root: the module's local folder (agent cwd).
    :param module: module the task belongs to.
    :param task: the WorkTracker work item.
    :return: repo-relative POSIX path of the resolved directory.
    """

    # Match an existing module dir by id suffix.

    module_dir: Optional[Path] = None
    spec_root = root / SPEC_ROOT
    suffix = f"--{module.id[:8]}"
    if spec_root.is_dir():
        for child in sorted(spec_root.iterdir()):
            if child.is_dir() and child.name.endswith(suffix):
                module_dir = child
                break
    if module_dir is None:
        return task_design_dir(module, task)

    # Match an existing task dir by key prefix.

    prefix = f"{_task_key(task)}--"
    for child in sorted(module_dir.iterdir()):
        if child.is_dir() and child.name.startswith(prefix):
            return f"{SPEC_ROOT}/{module_dir.name}/{child.name}"
    return f"{SPEC_ROOT}/{module_dir.name}/{task_dir_name(task)}"


def ensure_dir(root: Path, rel: str) -> Path:
    """Create (or reuse) a design directory below ``root``.

    :param root: the module's local folder.
    :param rel: repo-relative directory from the calculation above.
    :return: the absolute directory path.
    """

    abs_dir = (root / rel).resolve()
    abs_dir.mkdir(parents=True, exist_ok=True)
    exclude_directory(root, root / SPEC_ROOT)
    return abs_dir


def scan_documents(abs_dir: Path) -> list[str]:
    """List the HTML and Markdown documents inside a design directory.

    :param abs_dir: absolute design-directory path.
    :return: sorted canonical relative POSIX paths of every supported document
        whose real location stays inside the directory (symlink escapes
        are skipped).
    """

    if not abs_dir.is_dir():
        return []
    boundary = abs_dir.resolve()
    found: list[str] = []
    for path in abs_dir.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in DOCUMENT_EXTENSIONS:
            continue

        # A symlinked file resolving outside the boundary is not servable.

        try:
            path.resolve().relative_to(boundary)
        except ValueError:
            continue
        found.append(path.relative_to(abs_dir).as_posix())
    return sorted(found)
