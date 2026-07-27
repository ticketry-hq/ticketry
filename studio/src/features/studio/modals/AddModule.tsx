import { useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { useTasksStore } from "../stores/tasksStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";

/**
 * Small dialog that collects only a module name and creates a Plane module.
 *
 * On success the store refreshes the modules list and auto-selects the new
 * module; submit is blocked for empty/whitespace names and while in flight.
 */
export interface AddModulePayload {
  promptForFolder?: boolean;
}

export function AddModule({ payload }: { payload?: AddModulePayload }) {
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const createModule = useTasksStore((s) => s.createModule);
  const popModal = useModalStore((s) => s.popModal);
  const pushModal = useModalStore((s) => s.pushModal);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Block submit on blank names or while a create is pending.
  const canSubmit = name.trim().length > 0 && !busy && !!selectedProjectId;

  async function submit(): Promise<void> {
    if (!canSubmit || !selectedProjectId) return;

    setBusy(true);
    setError(null);
    try {
      await createModule(selectedProjectId, name.trim());
      const createdModuleId = useTasksStore.getState().selectedModuleId;
      popModal();
      if (payload?.promptForFolder && createdModuleId) {
        pushModal({
          type: "module-folder",
          payload: { moduleId: createdModuleId },
        });
      }
    } catch {
      // Surface the failure without tearing down the pane.
      setError("Failed to create module.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Add Module"
      bindings={[
        { actionId: MODAL_ACTIONS.confirm, label: "Create" },
        { actionId: MODAL_ACTIONS.close, label: "Cancel" },
      ]}
      onAction={(actionId) => {
        if (actionId === MODAL_ACTIONS.confirm) void submit();
      }}
      width="w-[60ch]"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Module name"
        spellCheck={false}
        className="w-full bg-pane-bg px-2 py-1 font-mono text-sm outline-none ring-1 ring-pane-border focus:ring-focus-accent"
      />
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={popModal}
          className="rounded border border-pane-border bg-pane-bg px-3 py-1"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="rounded border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent disabled:opacity-50"
        >
          Create
        </button>
      </div>
    </ModalShell>
  );
}
