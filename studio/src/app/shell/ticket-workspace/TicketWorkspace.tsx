import { useEffect, type RefObject } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { SprintsWorkspace, usePlanWorkspace } from "../../../features/sprints";
import IssueDetail from "./selected-ticket/details/IssueDetail";
import { ModuleTabStrip } from "./ModuleTabStrip";
import { TasksPane } from "./tasks/TasksPane";
import { SelectedTicket } from "./selected-ticket/SelectedTicket";
import { PaneResizeHandle } from "../../../shared/ui/PaneResizeHandle";
import { TerminalPanel } from "../../../features/terminal-panel";
import { useStudioStore, useModulesQuery } from "../../../features/projects";
import {
  useModulePresentations,
  visibleModules,
} from "../../../features/module-tabs";
import { useClientStore } from "../../../state/clientStore";
import { useModalStore } from "../../modal/modalStore";
import { EmptyModuleWorkspace } from "./EmptyModuleWorkspace";
import {
  ChangesWorkspace,
  dismissChangesWorkspace,
  useChangesWorkspace,
} from "../../../features/agents/worktrees";

interface TicketWorkspaceProps {
  tasksSize: number;
  workspaceSize: number;
  groupRef: RefObject<ImperativePanelGroupHandle>;
  onLayout: (sizes: number[]) => void;
  changesActive?: boolean;
}

export function TicketWorkspace({
  tasksSize,
  workspaceSize,
  groupRef,
  onLayout,
  changesActive: _legacyChangesActive = false,
}: TicketWorkspaceProps) {
  void _legacyChangesActive;
  const planActive = usePlanWorkspace((state) => state.active);
  const changesActive = useChangesWorkspace((state) => state.active);
  const surfaceActive = planActive || changesActive;
  const changesModuleId = useChangesWorkspace((state) => state.moduleId);
  const selectedProjectId = useStudioStore((state) => state.selectedProjectId);
  const modulesQuery = useModulesQuery(selectedProjectId);
  const modules = modulesQuery.data ?? [];
  const presentations = useModulePresentations(selectedProjectId);
  const selectedModuleId = useClientStore((state) => state.selectedModuleId);
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);
  const pushModal = useModalStore((state) => state.pushModal);
  const visibleModuleCount = visibleModules(modules, presentations).length;
  const noModules = !modulesQuery.isPending && modules.length === 0;
  const allHidden =
    !modulesQuery.isPending && modules.length > 0 && visibleModuleCount === 0;

  useEffect(() => {
    if (changesActive && selectedModuleId !== changesModuleId) {
      dismissChangesWorkspace();
    }
  }, [changesActive, changesModuleId, selectedModuleId]);

  return (
    <div
      data-testid="module-workspace-region"
      className="flex h-full min-w-0 flex-col"
    >
      <ModuleTabStrip />
      <div className="min-h-0 flex-1">
        {planActive && selectedProjectId ? (
          <SprintsWorkspace
            renderWorkItemDetail={(id) => <IssueDetail issueId={id} detailsVisible />}
          />
        ) : null}
        {noModules || allHidden ? (
          <div hidden={planActive}>
            <EmptyModuleWorkspace
              kind={noModules ? "no-modules" : "all-hidden"}
              sidebarVisible={sidebarVisible}
              onCreate={() => pushModal({ type: "add-module" })}
            />
          </div>
        ) : (
          <>
            <div
              aria-hidden={surfaceActive || undefined}
              className="h-full"
              hidden={surfaceActive}
            >
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
                  {/* Kept mounted so terminal and document state survives review. */}
                  <SelectedTicket active={!surfaceActive} />
                </Panel>
              </PanelGroup>
            </div>
            {changesActive ? (
              <ChangesWorkspace
                onResolveConflicts={(request) => pushModal({
                  type: "agent-picker",
                  payload: { mode: "instant", ...request },
                })}
              />
            ) : null}
          </>
        )}
      </div>
      {/* Spans the Stories and work-item panes and stops here, so the panel's
          extent matches its module scope; the sidebar stays full height. */}
      {!noModules && !allHidden ? (
        <div
          aria-hidden={surfaceActive || undefined}
          className={surfaceActive ? "hidden" : "contents"}
          hidden={surfaceActive}
        >
          <TerminalPanel />
        </div>
      ) : null}
    </div>
  );
}
