import { type Project, type Module } from "../../../../../shared/api/types";

interface BreadcrumbProps {
  project: Project | null;
  epic: Module | null;
  onProjectClick: () => void;
  onEpicClick: () => void;
}

export default function Breadcrumb({
  project,
  epic,
  onProjectClick,
  onEpicClick,
}: BreadcrumbProps) {
  return (
    <nav
      className="mb-2 flex items-center gap-1.5 text-xs text-text-muted"
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
      {epic && (
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
    </nav>
  );
}
