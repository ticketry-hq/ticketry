import { useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore, type ModalDescriptor } from "../../../app/modal/modalStore";
import { useConfigStore as useAgentConfigStore } from "../stores/configStore";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";
import { studioRuntime, type StudioRuntime } from "../../../runtime";

type FolderConfigState = Pick<
  ReturnType<typeof useAgentConfigStore.getState>,
  "profiles" | "recentProfileIndex" | "setModuleFolder"
>;

export type FolderConfigHook = <T>(selector: (state: FolderConfigState) => T) => T;

export interface ModuleFolderPayload {
  /** Optional follow-up modal kind to push after saving. */
  next?: ModalDescriptor["type"];
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

  // Derive newest unique paths from the active profile.

  const recentFolders = Array.from(
    new Set(
      Object.values(profile?.module_folders ?? {})
        .reverse()
        .filter((path) => path.trim().length > 0),
    ),
  );

  const [value, setValue] = useState(initial);
  const [savedValue, setSavedValue] = useState(initial);
  const [highlight, setHighlight] = useState<number>(-1);
  const [busy, setBusy] = useState(false);

  async function pickFolder(): Promise<void> {
    const picked = await runtime.pickFolder();
    if (picked !== null) {
      setValue(picked);
      setHighlight(-1);
    }
  }

  async function save(): Promise<void> {
    if (!moduleId) {
      popModal();
      return;
    }
    setBusy(true);
    try {
      await setModuleFolder(moduleId, value);
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
      if (recentFolders.length === 0) return;
      setHighlight((h) => (h + 1) % recentFolders.length);
      return;
    }
    if (actionId === MODAL_ACTIONS.previous) {
      if (recentFolders.length === 0) return;
      setHighlight((h) => (h <= 0 ? recentFolders.length - 1 : h - 1));
      return;
    }
    if (actionId === MODAL_ACTIONS.confirm) {
      if (highlight >= 0 && highlight < recentFolders.length) {
        // First Enter on highlight: commit highlight to input, no save.
        setValue(recentFolders[highlight]);
        setHighlight(-1);
        return;
      }
      // Enter on unchanged value (or no highlight) → save.
      if (value === savedValue && value === initial) {
        // unchanged from initial; still allow saving (commits same value).
      }
      setSavedValue(value);
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
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        className="w-full bg-pane-bg px-2 py-1 font-mono text-sm outline-none ring-1 ring-pane-border focus:ring-focus-accent"
      />
      {recentFolders.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">
            Recent folders
          </div>
          <ul
            aria-label="Recent folders"
            className="border border-pane-border bg-pane-bg"
          >
            {recentFolders.map((folder, i) => (
              <li
                key={folder}
                onClick={() => {
                  setValue(folder);
                  setHighlight(-1);
                }}
                className={`cursor-pointer truncate px-2 py-1 font-mono text-sm ${
                  i === highlight
                    ? "bg-selection-bg text-text-primary"
                    : "hover:bg-pane-title"
                }`}
              >
                {folder}
              </li>
            ))}
          </ul>
        </div>
      )}
      {runtime.capabilities.nativeFolderPicker && (
        <button
          type="button"
          onClick={() => void pickFolder()}
          className="mt-3 rounded border border-pane-border bg-pane-bg px-3 py-1"
        >
          Pick Folder
        </button>
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
