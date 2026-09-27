import { type Project, type Module, type WorkItem } from "../../../../../shared/api/types";
import { formatWorkItemDisplayIdentifier } from "../../../../../features/work-items";
import ParentPicker from "./fields/ParentPicker";

interface BreadcrumbProps {
  project: Project | null;
  epic: Module | null;
  task: WorkItem;
  items: WorkItem[];
  savingParent: boolean;
  setParent: (parentId: string | null) => void;
  onProjectClick: () => void;
  onEpicClick: () => void;
}

/**
 * Project › [module ›] parent › identifier. The parent segment is the parent
 * picker; the module segment only appears (as a backlog link) when the parent
 * is a task beneath it, because the module follows from ancestry.
 */
export default function Breadcrumb({
  project,
  epic,
  task,
  items,
  savingParent,
  setParent,
  onProjectClick,
  onEpicClick,
}: BreadcrumbProps) {
  const identifier = formatWorkItemDisplayIdentifier(task.sequence_id);
  const showEpic = epic !== null && epic.id !== task.parent_id;

  return (
    <nav
      className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted"
      data-testid="breadcrumb"
      aria-label="Breadcrumb"
    >
      <button
        type="button"
        onClick={onProjectClick}
        data-testid="crumb-project"
        className="truncate hover:text-text-primary hover:underline"
      >
        {project?.name ?? "Project"}
      </button>
      {showEpic && (
        <>
          <span aria-hidden>›</span>
          <button
            type="button"
            onClick={onEpicClick}
            data-testid="crumb-epic"
            className="truncate hover:text-text-primary hover:underline"
          >
            {epic.name}
          </button>
        </>
      )}
      <span aria-hidden>›</span>
      <ParentPicker
        value={task.parent_id}
        currentId={task.id}
        items={items}
        saving={savingParent}
        onChange={setParent}
        variant="crumb"
      />
      {identifier && (
        <>
          <span aria-hidden>›</span>
          <span
            className="flex-none font-mono text-text-primary"
            data-testid="issue-identifier"
          >
            {identifier}
          </span>
        </>
      )}
    </nav>
  );
}
