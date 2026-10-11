import { splitWorkArea } from "./layout/layoutMath";
import { useStudioPanelLayout } from "./layout/useStudioPanelLayout";
import { TicketWorkspace } from "./ticket-workspace/TicketWorkspace";
import { ModuleManager } from "../../features/module-manager/ModuleManager";
import { useModuleManagerStore } from "../../features/module-manager/state";

export function StudioLayout() {
  const managerActive = useModuleManagerStore((state) => state.active);
  const { layout, workAreaGroupRef, handleWorkAreaLayout } = useStudioPanelLayout();
  const [tasksSize, workspaceSize] = splitWorkArea(layout);

  return (
    <div className="relative h-full w-full">
      <TicketWorkspace
        tasksSize={tasksSize}
        workspaceSize={workspaceSize}
        groupRef={workAreaGroupRef}
        onLayout={handleWorkAreaLayout}
      />
      {managerActive ? (
        <div className="absolute inset-x-0 bottom-0 top-7 z-20 bg-pane-bg">
          <ModuleManager />
        </div>
      ) : null}
    </div>
  );
}
