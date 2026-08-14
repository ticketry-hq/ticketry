import { useRef, useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore, type StandardModalType } from "../../../app/modal/modalStore";
import {
  getModuleFolder,
  setModuleFolder,
  useConfig,
} from "../../studio/stores/configStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";
import { studioRuntime, type StudioRuntime } from "../../../runtime";
import {
  ModuleFolderSelection,
  useModuleFolderSelection,
} from "./ModuleFolderSelection";

export interface ModuleFolderPayload {
  /** Optional follow-up modal kind to push after saving. */
  next?: StandardModalType;
  nextPayload?: Record<string, unknown>;
  /** Studio terminal-create callers pass explicit module context. */
  moduleId?: string;
  /** Resume a module switch that was gated on this folder link. */
  resumeModuleSelection?: boolean;
}

export function ModuleFolder({
  payload,
  runtime = studioRuntime(),
}: {
  payload?: ModuleFolderPayload;
  runtime?: StudioRuntime;
}) {
  const { profiles, recentProfileIndex } = useConfig();
  const popModal = useModalStore((s) => s.popModal);
  const pushModal = useModalStore((s) => s.pushModal);

  const profile =
    recentProfileIndex !== null ? profiles[recentProfileIndex] : null;
  const moduleId = payload?.moduleId;
  const initial = moduleId ? (getModuleFolder(profile, moduleId) ?? "") : "";

  const [savedValue, setSavedValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveInFlight = useRef(false);
  const selection = useModuleFolderSelection({
    profiles,
    recentProfileIndex,
    initialValue: initial,
    runtime,
  });
  const trimmedValue = selection.value.trim();

  async function save(): Promise<void> {
    if (saveInFlight.current) return;
    if (!trimmedValue) return;
    if (!moduleId) {
      popModal();
      return;
    }
    saveInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      try {
        await setModuleFolder(moduleId, trimmedValue);
      } catch {
        setError("Could not save the module folder. Retry to continue.");
        return;
      }
      popModal();
      if (payload?.resumeModuleSelection) {
        const { useClientStore } = await import("../../../state/clientStore");
        await useClientStore.getState().selectModule(moduleId);
      }
      if (payload?.next) {
        pushModal({ type: payload.next, payload: payload.nextPayload });
      }
    } finally {
      saveInFlight.current = false;
      setBusy(false);
    }
  }

  function onAction(actionId: string): void {
    if (actionId === MODAL_ACTIONS.next) {
      selection.moveNext();
      return;
    }
    if (actionId === MODAL_ACTIONS.previous) {
      selection.movePrevious();
      return;
    }
    if (actionId === MODAL_ACTIONS.confirm) {
      if (selection.commitHighlighted()) {
        // First Enter on highlight: commit highlight to input, no save.
        return;
      }
      if (!trimmedValue) return;
      // Enter on unchanged value (or no highlight) → save.
      if (selection.value === savedValue && selection.value === initial) {
        // unchanged from initial; still allow saving (commits same value).
      }
      setSavedValue(selection.value);
      void save();
    }
  }

  return (
    <ModalShell
      title="Module Folder"
      bindings={[
        {
          actionId: [MODAL_ACTIONS.previous, MODAL_ACTIONS.next],
          label: "Move",
        },
        { actionId: MODAL_ACTIONS.confirm, label: "Save" },
        { actionId: MODAL_ACTIONS.close, label: "Cancel" },
      ]}
      onAction={onAction}
      width="w-[80ch]"
    >
      <ModuleFolderSelection selection={selection} autoFocus />
      {error && (
        <div className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </div>
      )}
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
          disabled={busy || !trimmedValue}
          onClick={() => void save()}
          className="rounded border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}
