import { Panel, PanelGroup } from "react-resizable-panels";
import { outerPanelLayout, splitWorkArea } from "./layout/layoutMath";
import { StudioSidebar } from "./sidebar/StudioSidebar";
import { useStudioPanelLayout } from "./layout/useStudioPanelLayout";
import { TicketWorkspace } from "./ticket-workspace/TicketWorkspace";

export function StudioLayout() {
  const {
    layout,
    paneComposition,
    sidebarVisible,
    outerGroupRef,
    workAreaGroupRef,
    handleOuterLayout,
    handleWorkAreaLayout,
  } = useStudioPanelLayout();
  const outerLayout = outerPanelLayout(
    layout,
    sidebarVisible,
    paneComposition,
  );
  const [tasksSize, workspaceSize] = splitWorkArea(layout);

  return (
    <PanelGroup
      ref={outerGroupRef}
      direction="horizontal"
      className="h-full w-full"
      onLayout={handleOuterLayout}
    >
      {sidebarVisible && paneComposition !== "absent" ? (
        <StudioSidebar layout={layout} paneComposition={paneComposition} />
      ) : null}
      <Panel defaultSize={outerLayout.at(-1)} minSize={30} order={3}>
        <TicketWorkspace
          tasksSize={tasksSize}
          workspaceSize={workspaceSize}
          groupRef={workAreaGroupRef}
          onLayout={handleWorkAreaLayout}
        />
      </Panel>
    </PanelGroup>
  );
}
