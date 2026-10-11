import { createApolloStore } from "../../shared/apollo/localState";
import { useStudioStore } from "../projects";

interface ModuleManagerState {
  active: boolean;
  projectId: string | null;
  generation: number;
  search: string;
  collapsedGroups: Record<string, boolean>;
  expandedRows: Record<string, boolean>;
  selectedModuleId: string | null;
  detailOpen: boolean;
  creationActive: boolean;
  pendingActions: Record<string, boolean>;
  actionErrors: Record<string, string>;
  renameEdit: { moduleId: string; originalName: string; draft: string; error: string; surface: "row" | "detail" } | null;
}

const initialView = () => ({ search: "", collapsedGroups: { archived: true },
  expandedRows: {}, selectedModuleId: null, detailOpen: false, creationActive: false, pendingActions: {}, actionErrors: {}, renameEdit: null });

export const useModuleManagerStore = createApolloStore<ModuleManagerState>(
  "module-manager", () => ({ active: false, projectId: null, generation: 0, ...initialView() }),
);

// DOM focus is transient; application state lives in the Apollo row above.
let invokingFocus: HTMLElement | null = null;
let invokingNativeFocus: (() => void) | null = null;

export function openModuleManager({ restoreFocus }: { restoreFocus?: () => void } = {}): void {
  const projectId = useStudioStore.getState().selectedProjectId;
  const previous = useModuleManagerStore.getState();
  if (!previous.active) invokingFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement : null;
  if (!previous.active) invokingNativeFocus = restoreFocus ?? null;
  useModuleManagerStore.setState({ active: true, projectId,
    generation: previous.generation + 1,
    creationActive: false, pendingActions: {}, actionErrors: {}, renameEdit: null,
    ...(previous.projectId !== projectId ? initialView() : {}) });
}

export function closeModuleManager({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
  useModuleManagerStore.setState((state) => ({ active: false, generation: state.generation + 1,
    creationActive: false, pendingActions: {}, actionErrors: {}, renameEdit: null }));
  const closedGeneration = useModuleManagerStore.getState().generation;
  const target = invokingFocus;
  const nativeFocus = invokingNativeFocus;
  invokingFocus = null;
  invokingNativeFocus = null;
  if (restoreFocus) requestAnimationFrame(() => {
    const current = useModuleManagerStore.getState();
    if (current.active || current.generation !== closedGeneration) return;
    if (nativeFocus) { nativeFocus(); return; }
    (target?.isConnected ? target : document.querySelector<HTMLElement>("[data-module-manager-toggle]"))?.focus();
  });
}

export function toggleModuleManager(): void {
  if (useModuleManagerStore.getState().active) closeModuleManager();
  else openModuleManager();
}

export function synchronizeModuleManagerProject(projectId: string | null): void {
  if (useModuleManagerStore.getState().projectId === projectId) return;
  invokingFocus = null;
  invokingNativeFocus = null;
  useModuleManagerStore.setState((state) => ({ projectId, generation: state.generation + 1, ...initialView() }));
}

export const setModuleManagerSearch = (search: string): void => useModuleManagerStore.setState({ search });
export const beginModuleManagerCreation = (): void => useModuleManagerStore.setState((state) => ({
  creationActive: true, detailOpen: false, search: "", collapsedGroups: { ...state.collapsedGroups, open: false },
}));
export function cancelModuleManagerCreation(): void {
  const generation = useModuleManagerStore.getState().generation;
  useModuleManagerStore.setState({ creationActive: false });
  requestAnimationFrame(() => {
    const current = useModuleManagerStore.getState();
    if (!current.active || current.creationActive || current.generation !== generation) return;
    document.querySelector<HTMLElement>("[data-module-manager-new]")?.focus();
  });
}
export const selectModuleManagerModule = (selectedModuleId: string | null): void =>
  useModuleManagerStore.setState({ selectedModuleId });
export const inspectModuleManagerModule = (selectedModuleId: string): void =>
  useModuleManagerStore.setState({ selectedModuleId, detailOpen: true });
export const leaveModuleManagerDetail = (): void => useModuleManagerStore.setState({ detailOpen: false });
export function toggleModuleManagerGroup(group: string): void {
  const state = useModuleManagerStore.getState();
  if (group === "open" && state.creationActive) return;
  useModuleManagerStore.setState({
    collapsedGroups: { ...state.collapsedGroups, [group]: !state.collapsedGroups[group] },
  });
}
export const setModuleManagerExpanded = (moduleId: string, expanded: boolean): void =>
  useModuleManagerStore.setState((state) => ({ expandedRows: { ...state.expandedRows, [moduleId]: expanded } }));
