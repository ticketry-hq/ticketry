import { useEffect } from "react";
import { useModalStore } from "../../../modal/modalStore";
import { useStudioModules, useTasksStore } from "../../../../features/studio/stores/tasksStore";
import {
  resolveCursorId,
  useClientStore,
} from "../../../../state/clientStore";
import { PaneShell } from "../../PaneShell";

export function ModulesPane() {
  const modules = useStudioModules();
  const selectedModuleId = useTasksStore((s) => s.selectedModuleId);
  const selectModule = useTasksStore((s) => s.selectModule);
  const loading = useTasksStore((s) => s.loading.modules);

  const cursorId = useClientStore((s) => s.modulesCursorId);
  const setCursor = useClientStore((s) => s.setModulesCursor);
  const pushModal = useModalStore((s) => s.pushModal);

  // Centered "+ Add Module" trigger, always rendered after the list.
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
          {modules.map((m) => {
            const isSelected = m.id === selectedModuleId;
            const isFocused = m.id === visibleCursorId;
            return (
              <li
                key={m.id}
                onClick={() => {
                  setCursor(m.id);
                  void selectModule(m.id);
                }}
                className={`cursor-pointer truncate px-1 py-0.5 ${
                  isSelected
                    ? "bg-selection-bg text-text-primary"
                    : isFocused
                      ? "bg-pane-title text-text-primary"
                      : "text-text-primary hover:bg-pane-title"
                }`}
              >
                {"📦 "}
                {m.name}
              </li>
            );
          })}
          <li>{addButton}</li>
        </ul>
      )}
    </PaneShell>
  );
}
