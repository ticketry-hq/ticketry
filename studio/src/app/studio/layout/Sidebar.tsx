import { Panel } from "react-resizable-panels";
import { ModulesPane } from "../../../features/studio/pages/modules/ModulesPane";
import { ProjectsPane } from "../../../features/studio/pages/projects/ProjectsPane";
import { PaneResizeHandle } from "./PaneResizeHandle";

interface SidebarProps {
  layout: number[];
}

export function Sidebar({ layout }: SidebarProps) {
  return (
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
      <Panel
        defaultSize={layout[1]}
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
