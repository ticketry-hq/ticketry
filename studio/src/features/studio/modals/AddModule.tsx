import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";
import { ModuleCreationFields, useModuleCreation } from "../../module-creation";
import type { StudioRuntime } from "../../../runtime";

/** Existing modal caller of the same operational creation flow as the manager. */
export function AddModule({ runtime }: { runtime?: StudioRuntime } = {}) {
  const popModal = useModalStore((state) => state.popModal);
  const creation = useModuleCreation({ runtime, onComplete: popModal });
  const cancel = () => { creation.cancel(); popModal(); };
  return (
    <ModalShell
      title="Add Module"
      bindings={[
        { actionId: [MODAL_ACTIONS.previous, MODAL_ACTIONS.next], label: "Move" },
        { actionId: MODAL_ACTIONS.confirm, label: "Create module" },
        { actionId: MODAL_ACTIONS.close, label: "Cancel" },
      ]}
      onClose={cancel}
      onAction={creation.handleAction}
      width="w-[80ch]"
    >
      <p className="mb-4 text-sm leading-5 text-text-secondary">
        A module groups related stories and sets where their work runs.
      </p>
      <ModuleCreationFields creation={creation} />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={cancel} className="border border-pane-border bg-pane-bg px-3 py-1">
          Cancel
        </button>
        <button type="button" disabled={!creation.canSubmit} onClick={() => void creation.submit()}
          className="border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent disabled:opacity-50">
          {creation.createdModuleId ? "Save folder" : "Create module"}
        </button>
      </div>
    </ModalShell>
  );
}
