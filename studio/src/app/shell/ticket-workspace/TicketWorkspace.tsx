import type { RefObject } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { ModuleTabStrip } from "./ModuleTabStrip";
import { TasksPane } from "./tasks/TasksPane";
import { SelectedTicket } from "./selected-ticket/SelectedTicket";
import { PaneResizeHandle } from "../layout/PaneResizeHandle";

interface TicketWorkspaceProps {
  tasksSize: number;
  workspaceSize: number;
  groupRef: RefObject<ImperativePanelGroupHandle>;
  onLayout: (sizes: number[]) => void;
}

export function TicketWorkspace({
  tasksSize,
  workspaceSize,
  groupRef,
  onLayout,
}: TicketWorkspaceProps) {
  return (
    <div
      data-testid="module-workspace-region"
      className="flex h-full min-w-0 flex-col"
    >
      <ModuleTabStrip />
      <div className="min-h-0 flex-1">
        <PanelGroup
          ref={groupRef}
          direction="horizontal"
          className="h-full w-full"
          onLayout={onLayout}
        >
          <Panel defaultSize={tasksSize} minSize={15} order={1}>
            <TasksPane />
          </Panel>
          <PaneResizeHandle />
          <Panel defaultSize={workspaceSize} minSize={15} order={2}>
            {/* Kept mounted so terminal and document state survives ticket switches. */}
            <SelectedTicket />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
