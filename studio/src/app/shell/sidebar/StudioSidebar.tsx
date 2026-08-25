import { Panel } from "react-resizable-panels";
import { ModulesPane } from "./modules/ModulesPane";
import { PaneResizeHandle } from "../layout/PaneResizeHandle";

interface StudioSidebarProps {
  layout: number[];
}

export function StudioSidebar({ layout }: StudioSidebarProps) {
  const visibleTotal = layout[1] + layout[2] + layout[3];
  const moduleSize =
    visibleTotal <= 0
      ? layout[1]
      : (layout[1] / visibleTotal) * 100;

  return (
    <>
      <Panel
        id="modules-sidebar"
        defaultSize={moduleSize}
        minSize={10}
        order={2}
        data-testid="pane-modules"
      >
        <ModulesPane />
      </Panel>
      <PaneResizeHandle id="modules-workspace-resize-handle" />
    </>
  );
}
