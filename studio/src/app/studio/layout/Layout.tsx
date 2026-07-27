import { Panel, PanelGroup } from "react-resizable-panels";
import { outerPanelLayout, splitWorkArea } from "./layoutMath";
import { Sidebar } from "./Sidebar";
import { useStudioPanelLayout } from "./useStudioPanelLayout";
import { WorkArea } from "./WorkArea";

export function Layout() {
  const {
    layout,
    sidebarVisible,
    outerGroupRef,
    workAreaGroupRef,
    handleOuterLayout,
    handleWorkAreaLayout,
  } = useStudioPanelLayout();
  const outerLayout = outerPanelLayout(layout, sidebarVisible);
  const [tasksSize, workspaceSize] = splitWorkArea(layout);

  return (
    <PanelGroup
      ref={outerGroupRef}
      direction="horizontal"
      className="h-full w-full"
      onLayout={handleOuterLayout}
    >
      {sidebarVisible ? <Sidebar layout={layout} /> : null}
      <Panel defaultSize={outerLayout.at(-1)} minSize={30} order={3}>
        <WorkArea
          tasksSize={tasksSize}
          workspaceSize={workspaceSize}
          groupRef={workAreaGroupRef}
          onLayout={handleWorkAreaLayout}
        />
      </Panel>
    </PanelGroup>
  );
}
