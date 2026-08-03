import { useModalStore } from "../../../../app/modal/modalStore";
import { useStudioProjects, useTasksStore } from "../../stores/tasksStore";
import { useUIStore } from "../../stores/uiStore";
import { PaneShell } from "../../components/PaneShell";

export function ProjectsPane() {
  const projects = useStudioProjects();
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const selectProject = useTasksStore((s) => s.selectProject);
  const loading = useTasksStore((s) => s.loading.projects);
  const projectIdx = useUIStore((s) => s.projectsCursor);
  const pushModal = useModalStore((s) => s.pushModal);

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
          {projects.map((p, i) => {
            const isSelected = p.id === selectedProjectId;
            const isFocused = i === projectIdx;
            return (
              <li
                key={p.id}
                onClick={() => {
                  useUIStore.setState({ projectsCursor: i });
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
