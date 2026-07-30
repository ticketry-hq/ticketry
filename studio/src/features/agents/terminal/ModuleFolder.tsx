import { useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore, type StandardModalType } from "../../../app/modal/modalStore";
import { useConfigStore as useAgentConfigStore } from "../stores/configStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";
import { studioRuntime, type StudioRuntime } from "../../../runtime";
import {
  ModuleFolderSelection,
  useModuleFolderSelection,
} from "./ModuleFolderSelection";

type FolderConfigState = Pick<
  ReturnType<typeof useAgentConfigStore.getState>,
  "profiles" | "recentProfileIndex" | "setModuleFolder"
>;

export type FolderConfigHook = <T>(selector: (state: FolderConfigState) => T) => T;

export interface ModuleFolderPayload {
  /** Optional follow-up modal kind to push after saving. */
  next?: StandardModalType;
  nextPayload?: Record<string, unknown>;
  /** Studio terminal-create callers pass explicit module context. */
  moduleId?: string;
}

export function ModuleFolder({
  payload,
  useConfigStore = useAgentConfigStore,
  runtime = studioRuntime(),
}: {
  payload?: ModuleFolderPayload;
  useConfigStore?: FolderConfigHook;
  runtime?: StudioRuntime;
}) {
  const recentProfileIndex = useConfigStore((s) => s.recentProfileIndex);
  const profiles = useConfigStore((s) => s.profiles);
  const setModuleFolder = useConfigStore((s) => s.setModuleFolder);
  const popModal = useModalStore((s) => s.popModal);
  const pushModal = useModalStore((s) => s.pushModal);

  const profile =
    recentProfileIndex !== null ? profiles[recentProfileIndex] : null;
  const moduleId = payload?.moduleId;
  const initial =
    moduleId && profile?.module_folders?.[moduleId]
      ? profile.module_folders[moduleId]
      : "";

  const [savedValue, setSavedValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const selection = useModuleFolderSelection({
    profiles,
    recentProfileIndex,
    initialValue: initial,
    runtime,
  });

  async function save(): Promise<void> {
    if (!moduleId) {
      popModal();
      return;
    }
    setBusy(true);
    try {
      await setModuleFolder(moduleId, selection.value);
      popModal();
      if (payload?.next) {
        pushModal({ type: payload.next, payload: payload.nextPayload });
      }
    } finally {
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
          disabled={busy}
          onClick={() => void save()}
          className="rounded border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}
