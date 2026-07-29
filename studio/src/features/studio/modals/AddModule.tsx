import { useRef, useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { useTasksStore } from "../stores/tasksStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";
import { useConfigStore } from "../../agents/stores/configStore";
import {
  ModuleFolderSelection,
  useModuleFolderSelection,
} from "../../agents/terminal/ModuleFolderSelection";

/**
 * Collects a module name and optional local folder, then creates the module.
 *
 * Folder persistence happens only after the new module ID exists. If that
 * persistence fails, retrying reuses the created ID instead of creating a
 * duplicate module.
 */
export function AddModule() {
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const createModule = useTasksStore((s) => s.createModule);
  const popModal = useModalStore((s) => s.popModal);
  const profiles = useConfigStore((s) => s.profiles);
  const recentProfileIndex = useConfigStore((s) => s.recentProfileIndex);
  const setModuleFolder = useConfigStore((s) => s.setModuleFolder);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdModuleId, setCreatedModuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const createdModuleIdRef = useRef<string | null>(null);
  const folderSelection = useModuleFolderSelection({
    profiles,
    recentProfileIndex,
  });

  // Block submit on blank names or while a create is pending.
  const canSubmit = name.trim().length > 0 && !busy && !!selectedProjectId;

  async function submit(): Promise<void> {
    if (!canSubmit || !selectedProjectId || submittingRef.current) return;

    submittingRef.current = true;
    setBusy(true);
    setError(null);
    try {
      let moduleId = createdModuleIdRef.current;
      if (!moduleId) {
        await createModule(selectedProjectId, name.trim());
        moduleId = useTasksStore.getState().selectedModuleId;
        if (!moduleId) {
          throw new Error("Created module was not selected.");
        }
        createdModuleIdRef.current = moduleId;
        setCreatedModuleId(moduleId);
      }

      const folder = folderSelection.value.trim();
      if (folder) {
        try {
          await setModuleFolder(moduleId, folder);
        } catch {
          setError(
            "Module created, but its folder could not be saved. Retry to save the folder.",
          );
          return;
        }
      }
      popModal();
    } catch {
      // Surface the failure without tearing down the pane.
      setError("Failed to create module.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <ModalShell
      title="Add Module"
      bindings={[
        {
          actionId: [MODAL_ACTIONS.previous, MODAL_ACTIONS.next],
          label: "Move",
        },
        { actionId: MODAL_ACTIONS.confirm, label: "Create" },
        { actionId: MODAL_ACTIONS.close, label: "Cancel" },
      ]}
      onAction={(actionId) => {
        if (actionId === MODAL_ACTIONS.previous) {
          folderSelection.movePrevious();
        } else if (actionId === MODAL_ACTIONS.next) {
          folderSelection.moveNext();
        } else if (
          actionId === MODAL_ACTIONS.confirm &&
          !folderSelection.commitHighlighted()
        ) {
          void submit();
        }
      }}
      width="w-[80ch]"
    >
      <input
        autoFocus
        disabled={createdModuleId !== null}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Module name"
        spellCheck={false}
        className="w-full bg-pane-bg px-2 py-1 font-mono text-sm outline-none ring-1 ring-pane-border focus:ring-focus-accent"
      />
      <div className="mt-3">
        <ModuleFolderSelection selection={folderSelection} />
      </div>
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
          {createdModuleId ? "Save Folder" : "Create"}
        </button>
      </div>
    </ModalShell>
  );
}
