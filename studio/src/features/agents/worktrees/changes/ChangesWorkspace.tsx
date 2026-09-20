import { ModuleVersionControl } from "./ModuleVersionControl";
import { TaskWorktreeChanges } from "./TaskWorktreeChanges";
import {
  openModuleChangesWorkspace,
  openTaskChangesWorkspace,
  useChangesWorkspace,
} from "./changesWorkspaceState";

export function ChangesWorkspace() {
  const active = useChangesWorkspace((state) => state.active);
  const moduleId = useChangesWorkspace((state) => state.moduleId);
  const taskId = useChangesWorkspace((state) => state.taskId);

  if (!active || !moduleId) return null;

  const openModule = () => openModuleChangesWorkspace(moduleId);
  const openTask = (nextTaskId: string) =>
    openTaskChangesWorkspace(moduleId, nextTaskId);

  return (
    <section
      aria-label="Changes workspace"
      className="h-full min-h-0"
      data-testid="independent-changes-workspace"
    >
      {taskId === null ? (
        <ModuleVersionControl
          moduleId={moduleId}
          active
          onOpenModule={openModule}
          onOpenTask={openTask}
        />
      ) : (
        <TaskWorktreeChanges
          taskId={taskId}
          moduleId={moduleId}
          active
          onOpenModule={openModule}
          onOpenTask={openTask}
        />
      )}
    </section>
  );
}
