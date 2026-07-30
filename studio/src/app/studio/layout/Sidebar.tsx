import { Panel } from "react-resizable-panels";
import { ModulesPane } from "../../../features/studio/pages/modules/ModulesPane";
import { ProjectsPane } from "../../../features/studio/pages/projects/ProjectsPane";
import type { SidebarPaneComposition } from "../../../features/studio/stores/configStore";
import { PaneResizeHandle } from "./PaneResizeHandle";

interface SidebarProps {
  layout: number[];
  paneComposition: SidebarPaneComposition;
}

export function Sidebar({ layout, paneComposition }: SidebarProps) {
  if (paneComposition === "absent") return null;

  const projectsVisible = paneComposition === "projects-and-modules";
  const visibleTotal = layout[1] + layout[2] + layout[3];
  const moduleSize =
    projectsVisible || visibleTotal <= 0
      ? layout[1]
      : (layout[1] / visibleTotal) * 100;

  return (
    <>
      {projectsVisible ? (
        <>
          <Panel
            defaultSize={layout[0]}
            minSize={10}
            order={1}
            data-testid="pane-projects"
          >
            <ProjectsPane />
          </Panel>
          <PaneResizeHandle />
        </>
      ) : null}
      <Panel
        defaultSize={moduleSize}
        minSize={10}
        order={2}
        data-testid="pane-modules"
      >
        <ModulesPane />
      </Panel>
      <PaneResizeHandle />
    </>
  );
}
