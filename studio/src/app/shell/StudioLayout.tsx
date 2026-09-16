import { Panel, PanelGroup } from "react-resizable-panels";
import { outerPanelLayout, splitWorkArea } from "./layout/layoutMath";
import { StudioSidebar } from "./sidebar/StudioSidebar";
import { useStudioPanelLayout } from "./layout/useStudioPanelLayout";
import { TicketWorkspace } from "./ticket-workspace/TicketWorkspace";
import { TEMP_TASK_ID } from "../../features/agents/types";
import { scratchBucketId } from "../../features/agents/terminal";
import { useClientStore } from "../../state/clientStore";

export function StudioLayout() {
  const changesActive = useClientStore((state) => {
    const bucket = state.selectedTaskId === TEMP_TASK_ID
      ? scratchBucketId(state.selectedModuleId ?? "")
      : state.selectedTaskId;
    return bucket ? state.workspaces[bucket]?.active === "changes" : false;
  });
  const {
    layout,
    sidebarVisible,
    outerGroupRef,
    workAreaGroupRef,
    handleOuterLayout,
    handleWorkAreaLayout,
  } = useStudioPanelLayout(changesActive);
  const [tasksSize, workspaceSize] = splitWorkArea(layout);

  if (changesActive) {
    return (
      <div className="h-full w-full">
        <TicketWorkspace
          tasksSize={tasksSize}
          workspaceSize={workspaceSize}
          groupRef={workAreaGroupRef}
          onLayout={handleWorkAreaLayout}
          changesActive
        />
      </div>
    );
  }

  const outerLayout = outerPanelLayout(layout, sidebarVisible);

  return (
    <PanelGroup
      ref={outerGroupRef}
      direction="horizontal"
      className="h-full w-full"
      onLayout={handleOuterLayout}
    >
      {sidebarVisible ? <StudioSidebar layout={layout} /> : null}
      <Panel id="workspace" defaultSize={outerLayout.at(-1)} minSize={30} order={3}>
        <TicketWorkspace
          tasksSize={tasksSize}
          workspaceSize={workspaceSize}
          groupRef={workAreaGroupRef}
          onLayout={handleWorkAreaLayout}
          changesActive={changesActive}
        />
      </Panel>
    </PanelGroup>
  );
}
