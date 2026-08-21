import type { RefObject } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { ModuleTabStrip } from "./ModuleTabStrip";
import { TasksPane } from "./tasks/TasksPane";
import { SelectedTicket } from "./selected-ticket/SelectedTicket";
import { PaneResizeHandle } from "../layout/PaneResizeHandle";
import { TerminalPanel } from "../../../features/terminal-panel";
import { useStudioStore } from "../../../features/projects/store";
import { useModulesQuery } from "../../../features/projects";
import {
  useModulePresentationsQuery,
  visibleModules,
} from "../../../features/module-tabs";
import { useClientStore } from "../../../state/clientStore";

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
  const selectedProjectId = useStudioStore((state) => state.selectedProjectId);
  const modulesQuery = useModulesQuery(selectedProjectId);
  const presentationsQuery = useModulePresentationsQuery();
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);
  const loading = modulesQuery.isPending || presentationsQuery.isPending;
  const modules = modulesQuery.data ?? [];
  const hasModules = modules.length > 0;
  const hasVisibleModules =
    visibleModules(modules, presentationsQuery.data).length > 0;
  const hasEmptyModuleStrip = !loading && hasModules && !hasVisibleModules;

  return (
    <div
      data-testid="module-workspace-region"
      className="flex h-full min-w-0 flex-col"
    >
      <ModuleTabStrip />
      <div className="min-h-0 flex-1">
        {hasEmptyModuleStrip ? (
          <div
            data-testid="empty-module-workspace"
            className="flex h-full items-center justify-center px-6 text-center text-sm text-text-muted"
          >
            {sidebarVisible
              ? "Select a module in the Modules pane to restore its tab."
              : "Open the Modules sidebar to restore a module tab."}
          </div>
        ) : (
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
        )}
      </div>
      {/* Spans the Stories and work-item panes and stops here, so the panel's
          extent matches its module scope; the sidebar stays full height. */}
      {hasVisibleModules ? <TerminalPanel /> : null}
    </div>
  );
}
