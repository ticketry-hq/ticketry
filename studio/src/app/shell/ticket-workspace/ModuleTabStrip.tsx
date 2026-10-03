import { useCallback, useEffect, useRef } from "react";

import { useModalStore } from "../../modal/modalStore";
import {
  ModulePicker,
  useModuleJumpBadges,
  useModulePresentations,
  useSetModuleTabHidden,
  visibleModules,
} from "../../../features/module-tabs";
import {
  useModuleReorderDrag,
  useModulesQuery,
  useStudioStore,
} from "../../../features/projects";
import { getModuleFolder } from "../../../features/module-links";
import { useClientStore } from "../../../state/clientStore";
import { ModuleTab } from "./ModuleTab";
import { useWorkspaceTabNavigation } from "./useWorkspaceTabNavigation";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { leavePlanWorkspace, usePlanWorkspace } from "../../../features/sprints";
import { leaveChangesWorkspace, useChangesWorkspace } from "../../../features/agents/worktrees";
import { ModulesPaneToggle } from "./ModulesPaneToggle";

export function ModuleTabStrip() {
  const tabNavigation = useWorkspaceTabNavigation();
  const selectedProjectId = useStudioStore((state) => state.selectedProjectId);
  const modulesQuery = useModulesQuery(selectedProjectId);
  const modules = modulesQuery.data ?? [];
  const presentations = useModulePresentations(selectedProjectId);
  const shownModules = visibleModules(modules, presentations);
  const planActive = usePlanWorkspace((state) => state.active);
  const planModuleId = usePlanWorkspace((state) => state.origin?.selectedModuleId ?? null);
  const changesActive = useChangesWorkspace((state) => state.active);
  const surfaceActive = planActive || changesActive;
  const selectedModuleId = useClientStore((state) => state.selectedModuleId);
  const selectModule = useClientStore((state) => state.selectModule);
  const deselectModule = useClientStore((state) => state.deselectModule);
  const setTabHidden = useSetModuleTabHidden();
  const loading = modulesQuery.isPending;
  const pushModal = useModalStore((state) => state.pushModal);
  const modalOpen = useModalStore((state) => state.modalStack.length > 0);
  const moduleJumpBadges = useModuleJumpBadges(!modalOpen);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const dragDrop = useModuleReorderDrag(selectedProjectId, "horizontal");

  const registerRef = useCallback(
    (moduleId: string, node: HTMLButtonElement | null) => {
      tabRefs.current[moduleId] = node;
    },
    [],
  );

  const handleSelect = useCallback(
    (moduleId: string) => {
      if (dragDrop.consumePostDropClick()) return;
      if (usePlanWorkspace.getState().active) leavePlanWorkspace();
      if (useChangesWorkspace.getState().active) leaveChangesWorkspace();
      void selectModule(moduleId);
    },
    [dragDrop, selectModule],
  );

  const handleHide = useCallback(
    (moduleId: string) => {
      if (moduleId === selectedModuleId) {
        const hiddenIndex = modules.findIndex((module) => module.id === moduleId);
        const shownIds = new Set(shownModules.map((module) => module.id));
        const fallback =
          modules.slice(hiddenIndex + 1).find((module) =>
            shownIds.has(module.id) && getModuleFolder(module.id)
          )
          ?? [...modules.slice(0, hiddenIndex)]
            .reverse()
            .find((module) =>
              shownIds.has(module.id) && getModuleFolder(module.id)
            );
        if (fallback) void selectModule(fallback.id);
        else deselectModule();
      }
      void setTabHidden(moduleId, true);
    },
    [
      deselectModule,
      modules,
      selectModule,
      selectedModuleId,
      setTabHidden,
      shownModules,
    ],
  );

  const moduleOrderKey = JSON.stringify(
    shownModules.map((module) => module.id),
  );

  useEffect(() => {
    if (!selectedModuleId || loading) return;
    tabRefs.current[selectedModuleId]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [loading, selectedModuleId, moduleOrderKey]);

  return (
    <div
      aria-label="Project modules"
      className="flex h-7 min-w-0 shrink-0 border-b border-pane-border bg-pane-title"
    >
      <ModulesPaneToggle />
      <div
        aria-label="Scrollable project module tabs"
        className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          {...tabNavigation}
          data-workspace-tablist
          role="tablist"
          aria-label="Project module tabs"
          className="flex shrink-0"
        >
          <WorkspaceTabs moduleName={modules.find((module) => module.id === (planActive ? planModuleId : selectedModuleId))?.name} />
          {!loading
            ? shownModules.map((module, index) => (
                <ModuleTab
                  key={module.id}
                  module={module}
                  isSelected={module.id === selectedModuleId && !surfaceActive}
                  dropIntent={dragDrop.dropIntentFor(module.id)}
                  onSelect={handleSelect}
                  onHide={handleHide}
                  jumpBadge={moduleJumpBadges.get(index + 1)}
                  registerRef={registerRef}
                  dragSourceProps={dragDrop.dragSourcePropsFor(module.id)}
                  dropTargetProps={dragDrop.dropTargetPropsFor(module.id)}
                />
              ))
            : null}
        </div>
        {!loading ? (
          <ModulePicker
            modules={modules}
            presentations={presentations}
            onCreate={() => pushModal({ type: "add-module" })}
          />
        ) : null}
      </div>
    </div>
  );
}
