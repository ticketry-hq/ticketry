import { useEffect, useRef, useState } from "react";
import { captureCreationFilterScope } from "./creationFilterScope";
import { useClientStore } from "../../state/clientStore";
import { getModulesSnapshot, getProjectSelectionGeneration, loadModules, useStudioStore } from "../projects";
import { clearStorySprintFilter, getStorySprintFilterGeneration } from "../work-items";
import { MODAL_ACTIONS } from "../../shared/navigation/modalActions";
import { moduleFolderSaveError, prepareDirectoryTrust, writeModuleLink,
  validateModuleFolder, type ModuleFolderRefusal } from "../module-links";
import { useModuleFolderSelection } from "../agents/terminal/ModuleFolderSelection";
import { dismissChangesWorkspace } from "../agents/worktrees";
import { leavePlanWorkspace, selectPlanWorkspaceActive, usePlanWorkspace } from "../sprints";
import { useOnboardingTourStore } from "../onboarding";
import type { StudioRuntime } from "../../runtime";

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
export function useModuleCreation({ runtime, onComplete, isCurrent: callerIsCurrent }: {
  runtime?: StudioRuntime;
  onComplete: () => void;
  isCurrent?: () => boolean;
}) {
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);

  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdModuleId, setCreatedModuleId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const createdModuleIdRef = useRef<string | null>(null);
  const scopeGenerationRef = useRef(0);
  const folderSelection = useModuleFolderSelection({ runtime });

  useEffect(() => {
    createdModuleIdRef.current = null;
    setCreatedModuleId(null);
    return () => { scopeGenerationRef.current += 1; };
  }, [selectedProjectId]);

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
    const scopeGeneration = scopeGenerationRef.current;
    const projectGeneration = getProjectSelectionGeneration();
    const filterScopeCurrent = captureCreationFilterScope(selectedProjectId);
    const scopeCurrent = () => scopeGenerationRef.current === scopeGeneration
      && useStudioStore.getState().selectedProjectId === selectedProjectId
      && getProjectSelectionGeneration() === projectGeneration
      && (callerIsCurrent?.() ?? true);
    const isCurrent = () => scopeCurrent()
      && filterScopeCurrent();
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
      if (!isCurrent()) return;
      if (!validation.valid) {
        setFolderError(
          validation.reason
            ? FOLDER_REFUSAL_MESSAGE[validation.reason]
            : "The project working directory is not usable.",
        );
        return;
      }

      // Refusing trust must leave creation untouched, including onboarding.
      try {
        if (!(await prepareDirectoryTrust(folder, runtime))) return;
      } catch (cause) {
        setError(moduleFolderSaveError(cause, "Could not prepare folder trust. Retry to continue."));
        return;
      }
      if (!isCurrent()) return;

      let moduleId = createdModuleIdRef.current;
      if (!moduleId) {
        const created = await useStudioStore
          .getState()
          .createModuleForProjectWithError(selectedProjectId, name.trim());
        moduleId = created.id;
        if (!moduleId) throw new Error("The created module has no id.");
        if (!scopeCurrent()) return;
        createdModuleIdRef.current = moduleId;
        setCreatedModuleId(moduleId);
      }
      if (!isCurrent()) return;

      const resolvedModuleId = moduleId;
      try {
        await writeModuleLink(resolvedModuleId, folder);
      } catch (cause) {
        setError(moduleFolderSaveError(cause, "Module created, but its folder could not be saved. Retry to save the folder."));
        return;
      }
      if (!isCurrent()) return;
      // A successful create may outlive a failed project-membership refresh.
      // Keep its identity and editor until every module surface can include it.
      if (!getModulesSnapshot(selectedProjectId).some(({ id }) => id === resolvedModuleId)) {
        try {
          const modules = await loadModules(selectedProjectId, { queryDeduplication: false });
          if (!isCurrent()) return;
          if (!modules.some(({ id }) => id === resolvedModuleId)) {
            throw new Error("The created module is missing from the project module list.");
          }
        } catch {
          if (isCurrent()) setError("Module created, but its module list could not be refreshed. Retry to finish setup.");
          return;
        }
      }
      clearStorySprintFilter(selectedProjectId);
      const navigationGeneration = getStorySprintFilterGeneration(selectedProjectId);
      const navigationCurrent = () => scopeCurrent()
        && getStorySprintFilterGeneration(selectedProjectId) === navigationGeneration;
      // Plan restores its origin when leaving, so exit it before selecting the
      // newly usable module. Setup failures and cancellation keep that origin.
      if (selectPlanWorkspaceActive(usePlanWorkspace.getState())) leavePlanWorkspace();
      dismissChangesWorkspace();
      if (useClientStore.getState().selectedModuleId !== resolvedModuleId) {
        await useClientStore.getState().selectModule(resolvedModuleId, { isCurrent: navigationCurrent });
      }
      if (!navigationCurrent()) return;
      const onboarding = useOnboardingTourStore.getState();
      if (
        onboarding.step === "module-create" &&
        onboarding.projectId === selectedProjectId
      ) {
        onboarding.moduleCreated(resolvedModuleId);
      }
      onComplete();
    } catch (cause) {
      console.error("Failed to create module", cause);
      // Surface the failure without tearing down the pane.
      setError("Failed to create module.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  function handleAction(actionId: string): void {
    if (submittingRef.current) return;
    if (actionId === MODAL_ACTIONS.previous) folderSelection.movePrevious();
    else if (actionId === MODAL_ACTIONS.next) folderSelection.moveNext();
    else if (actionId === MODAL_ACTIONS.confirm && !folderSelection.commitHighlighted()) void submit();
  }

  function cancel(): void {
    scopeGenerationRef.current += 1;
  }

  return { name, setName, busy, createdModuleId, error, folderError,
    folderSelection, canSubmit, submit, handleAction, cancel };
}

export type ModuleCreation = ReturnType<typeof useModuleCreation>;
