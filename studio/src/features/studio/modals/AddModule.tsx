import { useEffect, useId, useRef, useState } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { useClientStore } from "../../../state/clientStore";
import { useStudioStore } from "../../projects";
import { MODAL_ACTIONS } from "../../../app/navigation/keymapRegistry";
import { setModuleFolder } from "../../module-links";
import {
  ModuleFolderSelection,
  useModuleFolderSelection,
} from "../../agents/terminal/ModuleFolderSelection";
import { useOnboardingTourStore } from "../../../app/onboarding/onboardingTourStore";
import type { StudioRuntime } from "../../../runtime";
import {
  validateModuleFolder,
  type ModuleFolderRefusal,
} from "../api/moduleFolderValidationApi";

const FOLDER_REFUSAL_MESSAGE: Record<ModuleFolderRefusal, string> = {
  module_folder_not_absolute:
    "Enter the full folder path, starting from the filesystem root.",
  module_folder_missing: "The project working directory does not exist.",
  module_folder_not_a_directory:
    "The project working directory is not a directory.",
};

/**
 * Collects a module name and local folder, then creates the module.
 *
 * Folder persistence happens only after the new module ID exists. If that
 * persistence fails, retrying reuses the created ID instead of creating a
 * duplicate module.
 */
export function AddModule({ runtime }: { runtime?: StudioRuntime } = {}) {
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const popModal = useModalStore((s) => s.popModal);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdModuleId, setCreatedModuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const moduleNameId = useId();
  const moduleNameHintId = useId();
  const moduleFolderId = useId();
  const moduleFolderHintId = useId();
  const moduleFolderErrorId = useId();
  const submittingRef = useRef(false);
  const createdModuleIdRef = useRef<string | null>(null);
  const folderSelection = useModuleFolderSelection({ runtime });

  useEffect(() => {
    setFolderError(null);
  }, [folderSelection.value]);

  // Both planning and local setup are required before this coherent flow starts.
  const canSubmit =
    name.trim().length > 0 &&
    folderSelection.isValid &&
    !busy &&
    !!selectedProjectId;

  async function submit(): Promise<void> {
    if (!canSubmit || !selectedProjectId || submittingRef.current) return;

    submittingRef.current = true;
    setBusy(true);
    setError(null);
    setFolderError(null);
    try {
      const folder = folderSelection.value.trim();
      let validation;
      try {
        validation = await validateModuleFolder(folder);
      } catch {
        setFolderError(
          "Could not validate the project working directory. Retry to continue.",
        );
        return;
      }
      if (!validation.valid) {
        setFolderError(
          validation.reason
            ? FOLDER_REFUSAL_MESSAGE[validation.reason]
            : "The project working directory is not usable.",
        );
        return;
      }

      let moduleId = createdModuleIdRef.current;
      if (!moduleId) {
        const created = await useStudioStore
          .getState()
          .createModuleForProjectWithError(selectedProjectId, name.trim());
        moduleId = created.id;
        if (!moduleId) throw new Error("The created module has no id.");
        createdModuleIdRef.current = moduleId;
        setCreatedModuleId(moduleId);
      }

      const resolvedModuleId = moduleId;
      try {
        await setModuleFolder(resolvedModuleId, folder);
      } catch {
        setError(
          "Module created, but its folder could not be saved. Retry to save the folder.",
        );
        return;
      }
      if (useClientStore.getState().selectedModuleId !== resolvedModuleId) {
        await useClientStore.getState().selectModule(resolvedModuleId);
      }
      const onboarding = useOnboardingTourStore.getState();
      if (
        onboarding.step === "module-create" &&
        onboarding.projectId === selectedProjectId
      ) {
        onboarding.moduleCreated(resolvedModuleId);
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
        { actionId: MODAL_ACTIONS.confirm, label: "Create module" },
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
      <p className="mb-4 text-sm leading-5 text-text-secondary">
        A module groups related stories and sets where their work runs.
      </p>
      <label
        htmlFor={moduleNameId}
        className="text-xs font-bold uppercase tracking-wider text-text-secondary"
      >
        Module name
      </label>
      <input
        id={moduleNameId}
        data-coach-anchor="module-name"
        aria-describedby={moduleNameHintId}
        autoFocus
        disabled={busy || createdModuleId !== null}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Module name"
        spellCheck={false}
        className="mt-2 w-full bg-pane-bg px-2 py-1 font-mono text-sm outline-none ring-1 ring-pane-border focus:ring-focus-accent"
      />
      <p id={moduleNameHintId} className="mt-2 text-xs text-text-muted">
        Use it to group a related set of stories. It does not need to match the
        folder name.
      </p>
      <div className="mt-3" data-coach-anchor="module-folder">
        <label
          htmlFor={moduleFolderId}
          className="mb-2 block text-xs font-bold uppercase tracking-wider text-text-secondary"
        >
          Project working directory (CWD)
        </label>
        <ModuleFolderSelection
          selection={folderSelection}
          inputId={moduleFolderId}
          ariaLabel="Module folder"
          ariaDescribedBy={`${moduleFolderHintId}${folderError ? ` ${moduleFolderErrorId}` : ""}`}
          ariaInvalid={folderError !== null}
          disabled={busy}
          pickerInline
          placeholder="Path to the project's code"
        />
        <p id={moduleFolderHintId} className="mt-2 text-xs text-text-muted">
          Ticketry starts terminals and coding agents here. Multiple modules can
          use the same folder.
        </p>
      </div>
      {folderError && (
        <div
          id={moduleFolderErrorId}
          className="mt-2 text-sm text-red-400"
          role="alert"
        >
          {folderError}
        </div>
      )}
      {error && (
        <div className="mt-2 text-sm text-red-400" role="alert">
          {error}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={popModal}
          className="border border-pane-border bg-pane-bg px-3 py-1"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => void submit()}
          className="border border-focus-accent bg-pane-title px-3 py-1 text-focus-accent disabled:opacity-50"
        >
          {createdModuleId ? "Save folder" : "Create module"}
        </button>
      </div>
    </ModalShell>
  );
}
