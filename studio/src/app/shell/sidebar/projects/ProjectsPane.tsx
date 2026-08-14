import { useModalStore } from "../../../modal/modalStore";
import { useProjectsQuery } from "../../../../features/projects";
import { useStudioStore } from "../../../../features/projects/store";
import {
  resolveCursorId,
  useClientStore,
} from "../../../../state/clientStore";
import { PaneShell } from "../../PaneShell";

export function ProjectsPane() {
  const projectsQuery = useProjectsQuery();
  const projects = projectsQuery.data ?? [];
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectProject = useStudioStore((s) => s.selectProject);
  const loading = projectsQuery.isPending;
  const cursorId = useClientStore((s) => s.projectsCursorId);
  const setCursor = useClientStore((s) => s.setProjectsCursor);
  const pushModal = useModalStore((s) => s.pushModal);
  const visibleCursorId = resolveCursorId(
    cursorId,
    projects.map((project) => project.id),
  );

  const addButton = (
    <button
      type="button"
      data-coach-anchor="project-add"
      onClick={() => pushModal({ type: "add-project" })}
      className="mt-1 w-full px-1 py-0.5 text-center text-text-muted hover:bg-pane-title hover:text-text-primary"
    >
      + Add Project
    </button>
  );

  // Projects-only: the profile picker was removed in #581. The app
  // auto-connects to the single implicit owned profile on launch.
  return (
    <PaneShell title="Projects" pane="projects">
      {loading && projects.length === 0 ? (
        <div className="text-text-muted">…</div>
      ) : projects.length === 0 ? (
        <>
          <div className="text-text-muted">No projects</div>
          {addButton}
        </>
      ) : (
        <ul>
          {projects.map((p) => {
            const isSelected = p.id === selectedProjectId;
            const isFocused = p.id === visibleCursorId;
            return (
              <li
                key={p.id}
                onClick={() => {
                  setCursor(p.id);
                  void selectProject(p.id);
                }}
                className={`cursor-pointer truncate px-1 py-0.5 ${
                  isSelected
                    ? "bg-selection-bg text-text-primary"
                    : isFocused
                      ? "bg-pane-title text-text-primary"
                      : "text-text-primary hover:bg-pane-title"
                }`}
              >
                {"📁 "}
                {p.name}
              </li>
            );
          })}
          <li>{addButton}</li>
        </ul>
      )}
    </PaneShell>
  );
}
