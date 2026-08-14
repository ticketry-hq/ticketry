import { useCallback, useEffect } from "react";
import { useModalStore } from "../../../modal/modalStore";
import {
  useModuleReorderDrag,
  useModulesQuery,
} from "../../../../features/projects";
import { useStudioStore } from "../../../../features/projects/store";
import {
  resolveCursorId,
  useClientStore,
} from "../../../../state/clientStore";
import { PaneShell } from "../../PaneShell";
import { ModuleRow } from "./ModuleRow";

export function ModulesPane() {
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const modulesQuery = useModulesQuery(selectedProjectId);
  const modules = modulesQuery.data ?? [];
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const selectModule = useClientStore((s) => s.selectModule);
  const loading = modulesQuery.isPending;

  const cursorId = useClientStore((s) => s.modulesCursorId);
  const setCursor = useClientStore((s) => s.setModulesCursor);
  const pushModal = useModalStore((s) => s.pushModal);

  const dragDrop = useModuleReorderDrag(selectedProjectId, "vertical");

  const handleSelect = useCallback(
    (moduleId: string) => {
      if (dragDrop.consumePostDropClick()) return;
      setCursor(moduleId);
      void selectModule(moduleId);
    },
    [dragDrop, selectModule, setCursor],
  );

  // Centered "+ Add Module" trigger, always rendered after the list. It is
  // neither a drag source nor a drop target.
  const addButton = (
    <button
      type="button"
      onClick={() => pushModal({ type: "add-module" })}
      className="mt-1 w-full px-1 py-0.5 text-center text-text-muted hover:bg-pane-title hover:text-text-primary"
    >
      + Add Module
    </button>
  );

  // Sync cursor when selected module or modules list changes
  useEffect(() => {
    if (selectedModuleId) {
      const i = modules.findIndex((m) => m.id === selectedModuleId);
      if (i >= 0) setCursor(selectedModuleId);
    }
  }, [selectedModuleId, modules, setCursor]);

  const visibleCursorId = resolveCursorId(
    cursorId,
    modules.map((module) => module.id),
  );

  return (
    <PaneShell title="Modules" pane="modules">
      {loading && modules.length === 0 ? (
        <div className="text-text-muted">…</div>
      ) : modules.length === 0 ? (
        <>
          <div className="text-text-muted">No modules</div>
          {addButton}
        </>
      ) : (
        <ul>
          {modules.map((m) => (
            <ModuleRow
              key={m.id}
              module={m}
              isSelected={m.id === selectedModuleId}
              isFocused={m.id === visibleCursorId}
              dropIntent={dragDrop.dropIntentFor(m.id)}
              onSelect={handleSelect}
              dragSourceProps={dragDrop.dragSourcePropsFor(m.id)}
              dropTargetProps={dragDrop.dropTargetPropsFor(m.id)}
            />
          ))}
          <li>{addButton}</li>
        </ul>
      )}
    </PaneShell>
  );
}
