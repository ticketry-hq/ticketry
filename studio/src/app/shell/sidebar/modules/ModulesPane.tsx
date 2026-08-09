import { useCallback, useEffect, useRef } from "react";
import { useModalStore } from "../../../modal/modalStore";
import {
  moduleDragCodec,
  useModulesQuery,
  useReorderModule,
  type ModuleDragPayload,
} from "../../../../features/projects";
import { useStudioStore } from "../../../../features/projects/store";
import {
  resolveCursorId,
  useClientStore,
} from "../../../../state/clientStore";
import { useAxisDragAndDrop } from "../../../../shared/dragDrop/useAxisDragAndDrop";
import { PaneShell } from "../../PaneShell";
import { ModuleRow } from "./ModuleRow";

/**
 * A browser may emit a click on the row a drag finished over. Selecting a
 * Module because it was dropped on would be a surprise, so a click arriving
 * this soon after a drop is ignored — long enough to cover the synthetic
 * click, far short of a deliberate second gesture.
 */
const POST_DROP_CLICK_WINDOW_MS = 300;

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

  const { reorder, isPending } = useReorderModule(selectedProjectId);
  const droppedAt = useRef(0);

  const handleDrop = useCallback(
    (
      payload: ModuleDragPayload,
      resolved: { targetId: string; intent: "near" | "far" },
    ) => {
      droppedAt.current = Date.now();
      reorder(payload.moduleId, resolved.targetId, resolved.intent);
    },
    [reorder],
  );

  const dragDrop = useAxisDragAndDrop<ModuleDragPayload, string>({
    axis: "vertical",
    codec: moduleDragCodec,
    // One gesture at a time: a second drag cannot start against an order the
    // server has not yet agreed to.
    disabled: isPending || selectedProjectId === null,
    onDrop: handleDrop,
  });

  const handleSelect = useCallback(
    (moduleId: string) => {
      if (Date.now() - droppedAt.current < POST_DROP_CLICK_WINDOW_MS) {
        droppedAt.current = 0;
        return;
      }
      setCursor(moduleId);
      void selectModule(moduleId);
    },
    [selectModule, setCursor],
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
              dropIntent={
                dragDrop.targetId === m.id &&
                dragDrop.payload !== null &&
                dragDrop.payload.moduleId !== m.id
                  ? dragDrop.intent
                  : null
              }
              onSelect={handleSelect}
              dragSourceProps={dragDrop.getDragSourceProps({ moduleId: m.id })}
              dropTargetProps={dragDrop.getDropTargetProps(m.id)}
            />
          ))}
          <li>{addButton}</li>
        </ul>
      )}
    </PaneShell>
  );
}
