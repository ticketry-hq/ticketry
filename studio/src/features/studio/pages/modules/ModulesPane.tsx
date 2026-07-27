import { useEffect } from "react";
import { useModalStore } from "../../../../app/modal/modalStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useUIStore } from "../../stores/uiStore";
import { PaneShell } from "../../components/PaneShell";

export function ModulesPane() {
  const modules = useTasksStore((s) => s.modules);
  const selectedModuleId = useTasksStore((s) => s.selectedModuleId);
  const selectModule = useTasksStore((s) => s.selectModule);
  const loading = useTasksStore((s) => s.loading.modules);

  const cursor = useUIStore((s) => s.modulesCursor);
  const pushModal = useModalStore((s) => s.pushModal);

  // Centered "+ Add Module" trigger, always rendered after the list.
  const addButton = (
    <button
      type="button"
      data-coach-anchor="module-add"
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
      if (i >= 0) useUIStore.setState({ modulesCursor: i });
    }
  }, [selectedModuleId, modules]);

  // Safeguard cursor bounds when list or cursor changes
  useEffect(() => {
    if (cursor >= modules.length) {
      useUIStore.setState({ modulesCursor: 0 });
    }
  }, [modules, cursor]);

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
          {modules.map((m, i) => {
            const isSelected = m.id === selectedModuleId;
            const isFocused = i === cursor;
            return (
              <li
                key={m.id}
                onClick={() => {
                  useUIStore.setState({ modulesCursor: i });
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
