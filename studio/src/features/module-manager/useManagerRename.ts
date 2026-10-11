import { useRenameWorkItem } from "../work-items";
import { useModuleManagerStore } from "./state";

export function cancelModuleManagerRename(): void {
  const state = useModuleManagerStore.getState();
  const edit = state.renameEdit;
  if (!edit) return;
  useModuleManagerStore.setState({ renameEdit: null });
  requestAnimationFrame(() => {
    const current = useModuleManagerStore.getState();
    if (!current.active || current.generation !== state.generation || current.renameEdit) return;
    Array.from(document.querySelectorAll<HTMLElement>("[data-module-manager-rename]"))
      .find((element) => element.dataset.moduleManagerRename === edit.moduleId
        && element.dataset.renameSurface === edit.surface)?.focus();
  });
}

/** Both action surfaces share the Apollo-owned draft and module write guard. */
export function useManagerRename(moduleId: string, name: string, surface: "row" | "detail") {
  const rename = useRenameWorkItem();
  const edit = useModuleManagerStore((state) => state.renameEdit);
  const editing = edit?.moduleId === moduleId && edit.surface === surface;
  const begin = () => {
    const state = useModuleManagerStore.getState();
    if (!state.active || state.pendingActions[moduleId]) return;
    useModuleManagerStore.setState({ renameEdit: { moduleId, originalName: name, draft: name, error: "", surface } });
  };
  const setDraft = (draft: string) => useModuleManagerStore.setState((state) => ({
    renameEdit: state.renameEdit?.moduleId === moduleId ? { ...state.renameEdit, draft, error: "" } : state.renameEdit,
  }));
  const submit = async () => {
    const started = useModuleManagerStore.getState();
    const edit = started.renameEdit;
    if (!started.active || !started.projectId || edit?.moduleId !== moduleId
      || edit.surface !== surface || started.pendingActions[moduleId]) return;
    const draft = edit.draft.trim();
    if (!draft) {
      useModuleManagerStore.setState({ renameEdit: { ...edit, error: "Enter a module name." } });
      return;
    }
    if (draft === name) { cancelModuleManagerRename(); return; }
    useModuleManagerStore.setState({ pendingActions: { ...started.pendingActions, [moduleId]: true },
      renameEdit: { ...edit, error: "" } });
    const current = () => {
      const state = useModuleManagerStore.getState();
      return state.active && state.projectId === started.projectId && state.generation === started.generation;
    };
    try {
      await rename.mutateAsync({ id: moduleId, name: draft });
      if (current() && useModuleManagerStore.getState().renameEdit?.moduleId === moduleId) cancelModuleManagerRename();
    } catch (error) {
      if (current()) useModuleManagerStore.setState((state) => ({ renameEdit: state.renameEdit?.moduleId === moduleId
        ? { ...state.renameEdit, error: error instanceof Error ? error.message : "Module rename failed." } : state.renameEdit }));
    } finally {
      if (current()) useModuleManagerStore.setState((state) => ({ pendingActions: { ...state.pendingActions, [moduleId]: false } }));
    }
  };
  return { editing, edit, begin, setDraft, submit };
}
