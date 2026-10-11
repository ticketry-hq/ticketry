import { useEffect, type RefObject } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { ImperativePanelGroupHandle } from "react-resizable-panels";
import { SprintsWorkspace, selectPlanWorkspaceActive, usePlanWorkspace } from "../../../features/sprints";
import { StorySprintFilterController, SprintModuleRecovery } from "../../../features/work-items";
import IssueDetail from "./selected-ticket/details/IssueDetail";
import { ModuleTabStrip } from "./ModuleTabStrip";
import { TasksPane } from "./tasks/TasksPane";
import { SelectedTicket } from "./selected-ticket/SelectedTicket";
import { PaneResizeHandle } from "../../../shared/ui/PaneResizeHandle";
import { TerminalPanel } from "../../../features/terminal-panel";
import { useStudioStore, useModulesQuery } from "../../../features/projects";
import {
  useEffectiveModuleTabs,
  useSprintModuleSelection,
} from "../../../features/module-tabs";
import { useClientStore } from "../../../state/clientStore";
import { useModalStore } from "../../modal/modalStore";
import { EmptyModuleWorkspace } from "./EmptyModuleWorkspace";
import { beginModuleManagerCreation, openModuleManager, useModuleManagerStore } from "../../../features/module-manager/state";
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

export function TicketWorkspace(props: TicketWorkspaceProps) {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  return <StorySprintFilterController projectId={projectId}>
    <TicketWorkspaceContent {...props} />
  </StorySprintFilterController>;
}

function TicketWorkspaceContent({
  tasksSize,
  workspaceSize,
  groupRef,
  onLayout,
  changesActive: _legacyChangesActive = false,
}: TicketWorkspaceProps) {
  void _legacyChangesActive;
  const planActive = usePlanWorkspace(selectPlanWorkspaceActive);
  const managerActive = useModuleManagerStore((state) => state.active);
  const changesActive = useChangesWorkspace((state) => state.active);
  const surfaceActive = planActive || changesActive;
  const changesModuleId = useChangesWorkspace((state) => state.moduleId);
  const selectedProjectId = useStudioStore((state) => state.selectedProjectId);
  const modulesQuery = useModulesQuery(selectedProjectId);
  const modules = modulesQuery.data ?? [];
  const effective = useEffectiveModuleTabs(selectedProjectId);
  useSprintModuleSelection(selectedProjectId, effective, surfaceActive);
  const selectedModuleId = useClientStore((state) => state.selectedModuleId);
  const pushModal = useModalStore((state) => state.pushModal);
  const visibleModuleCount = effective.modules.length;
  const noModules = !modulesQuery.isPending && !modulesQuery.error && modules.length === 0;
  const allHidden =
    !modulesQuery.isPending && (!effective.restricted || !effective.complete) && modules.length > 0 && visibleModuleCount === 0;
  const filterRecovery = effective.noMatches || (!selectedModuleId && modules.length > 0 && !allHidden);
  const workspaceInactive = surfaceActive || filterRecovery || !selectedModuleId;

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
      <div {...(managerActive ? { inert: "" } : {})} aria-hidden={managerActive || undefined}
        className="isolate flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1">
        {planActive && selectedProjectId ? (
          <SprintsWorkspace
            renderWorkItemDetail={(id) => <IssueDetail issueId={id} detailsVisible />}
          />
        ) : null}
        {filterRecovery && !surfaceActive ? <SprintModuleRecovery noMatches={effective.noMatches}
          hiddenMatches={effective.entries.some((entry) => entry.status === "hidden" && entry.sprintEligible === true)} /> : null}
        {noModules || allHidden ? (
          <div hidden={planActive}>
            <EmptyModuleWorkspace
              kind={noModules ? "no-modules" : "all-hidden"}
              onManage={() => openModuleManager()}
              onCreate={() => { openModuleManager(); beginModuleManagerCreation(); }}
            />
          </div>
        ) : (
          <>
            <div
              aria-hidden={workspaceInactive || undefined}
              className="h-full"
              hidden={workspaceInactive}
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
                  <SelectedTicket active={!workspaceInactive && !managerActive} />
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
          extent matches its module scope. */}
      {!noModules && !allHidden ? (
        <div
          aria-hidden={workspaceInactive || undefined}
          className={workspaceInactive ? "hidden" : "contents"}
          hidden={workspaceInactive}
        >
          <TerminalPanel active={!workspaceInactive && !managerActive} preserveInactiveContext={!selectedModuleId || managerActive} />
        </div>
      ) : null}
      </div>
    </div>
  );
}
