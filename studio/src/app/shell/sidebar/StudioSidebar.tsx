import { Panel } from "react-resizable-panels";
import { ModulesPane } from "./modules/ModulesPane";
import { PaneResizeHandle } from "../layout/PaneResizeHandle";

interface StudioSidebarProps {
  layout: number[];
}

/** The sidebar of the installation project: its modules, and nothing else. */
export function StudioSidebar({ layout }: StudioSidebarProps) {
  return (
    <>
      <Panel
        id="modules"
        defaultSize={layout[0]}
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
