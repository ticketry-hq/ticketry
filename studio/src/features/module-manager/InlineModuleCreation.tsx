import { useRef } from "react";
import { ModuleCreationFields, useModuleCreation } from "../module-creation";
import { cancelModuleManagerCreation, closeModuleManager, useModuleManagerStore } from "./state";

/** The manager's inline caller shares every operational creation step with Add Module. */
export function InlineModuleCreation() {
  const generation = useRef(useModuleManagerStore.getState().generation).current;
  const isCurrent = () => {
    const state = useModuleManagerStore.getState();
    return state.active && state.creationActive && state.generation === generation;
  };
  const creation = useModuleCreation({
    isCurrent,
    onComplete: () => {
      if (!isCurrent()) return;
      closeModuleManager({ restoreFocus: false });
      const closedGeneration = useModuleManagerStore.getState().generation;
      requestAnimationFrame(() => {
        const state = useModuleManagerStore.getState();
        if (state.active || state.generation !== closedGeneration) return;
        document.querySelector<HTMLElement>('[data-pane="tasks"] [role="tree"], [data-pane="tasks"] input[aria-label="Search stories"], [data-workspace-tablist] [role="tab"][aria-selected="true"]')?.focus();
      });
    },
  });

  function cancel(): void {
    creation.cancel();
    cancelModuleManagerCreation();
  }

  return <form aria-label="Create module" aria-busy={creation.busy}
    onSubmit={(event) => { event.preventDefault(); void creation.submit(); }}
    className="mb-3 border border-pane-border bg-pane-title/30 p-3">
    <ModuleCreationFields creation={creation} autoFocus />
    {creation.busy ? <p role="status" className="mt-2 text-xs text-text-muted">
      {creation.createdModuleId ? "Saving module folder…" : "Creating module…"}
    </p> : null}
    <div className="mt-3 flex justify-end gap-2">
      <button type="button" onClick={cancel}
        className="border border-pane-border px-3 py-1 text-xs focus-visible:outline focus-visible:outline-focus-accent">Cancel</button>
      <button type="submit" disabled={!creation.canSubmit}
        className="border border-focus-accent bg-pane-title px-3 py-1 text-xs text-focus-accent focus-visible:outline focus-visible:outline-focus-accent disabled:opacity-50">
        {creation.createdModuleId ? "Save folder" : "Create module"}
      </button>
    </div>
  </form>;
}
