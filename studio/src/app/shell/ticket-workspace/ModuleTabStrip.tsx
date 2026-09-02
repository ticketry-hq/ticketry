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
import { useClientStore } from "../../../state/clientStore";
import { ModuleTab } from "./ModuleTab";
import { ModulesPaneToggle } from "./ModulesPaneToggle";

export function ModuleTabStrip() {
  const selectedProjectId = useStudioStore((state) => state.selectedProjectId);
  const modulesQuery = useModulesQuery(selectedProjectId);
  const modules = modulesQuery.data ?? [];
  const presentations = useModulePresentations(selectedProjectId);
  const shownModules = visibleModules(modules, presentations);
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
          modules.slice(hiddenIndex + 1).find((module) => shownIds.has(module.id))
          ?? [...modules.slice(0, hiddenIndex)]
            .reverse()
            .find((module) => shownIds.has(module.id));
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
      {!loading ? (
        <ModulePicker
          modules={modules}
          presentations={presentations}
          onCreate={() => pushModal({ type: "add-module" })}
        />
      ) : null}
      <div
        role="tablist"
        aria-label="Project module tabs"
        className="flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {!loading
          ? shownModules.map((module, index) => (
              <ModuleTab
                key={module.id}
                module={module}
                isSelected={module.id === selectedModuleId}
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
    </div>
  );
}
