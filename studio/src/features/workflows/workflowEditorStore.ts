import { create } from "zustand";
import { ApiError } from "../../shared/api/client";
import type {
  IssueType,
  LaunchBindingInput,
  ProviderCapabilities,
  ScopedWorkflowImpact,
  ScopedWorkflowImpactOperation,
  ScopedWorkflowSettings,
  State,
  StatePatch,
  WorkItem,
} from "../../shared/api/types";
import * as api from "./mutationTransport";
import { loadProviderCapabilities } from "./providerQueries";
import {
  advanceStateCatalogRevision,
  overlayAuthoritativeState,
  stateCatalogChangedSince,
  stateCatalogRevision,
} from "../../shared/stateCatalogRevision";
import {
  removeState as removeStateFromCatalog,
  setStatesSorted,
  upsertState,
} from "../../shared/query/stateCatalog";
import { queryClient } from "../../shared/query/queryClient";
import { queryKeys } from "../../shared/query/keys";
import { synchronizeSubtreeRunCapabilities } from "../settings";
import {
  loadAllWorkflowSettings,
  loadWorkflowEditorResources,
  getWorkflowIssueTypesSnapshot,
  getWorkflowProviderCapabilitiesSnapshot,
  getWorkflowStateCountsSnapshot,
  getWorkflowStatesSnapshot,
  getProjectWorkflowSettingsSnapshot,
  loadWorkflowProjectItems,
  loadWorkflowSettings,
  loadWorkflowStates,
  setWorkflowSettings,
  setProjectWorkflowSettings,
  setWorkflowIssueTypes,
  setWorkflowProviderCapabilities,
  setWorkflowStateCounts,
  setWorkflowStates,
} from "./queries";
import { deriveWorkflowImpact } from "./selectors";

interface RemoveStateCommand {
  stateId: string;
  stateName: string;
}

type ScopedOperation = (
  workflowRevision: number,
) => Promise<unknown>;

interface WorkflowEditorState {
  projectId: string | null;
  issueTypes: IssueType[];
  states: State[];
  stateWorkItemCounts: Record<string, number>;
  providerCapabilities: ProviderCapabilities[];
  selectedTypeId: string | null;
  workflows: Record<string, ScopedWorkflowSettings>;
  stagedStateIds: Record<string, string>;
  loading: boolean;
  action: string | null;
  notice: string | null;
  error: string | null;
  controlErrors: Record<string, string>;
  load: (projectId: string) => Promise<void>;
  loadWorkflows: (typeIds: string[]) => Promise<void>;
  refreshProviderCapabilities: () => Promise<void>;
  selectType: (typeId: string) => Promise<void>;
  stageState: (typeId: string, stateId: string | null) => void;
  applyScoped: (
    control: string,
    typeId: string,
    operation: ScopedOperation,
  ) => Promise<ScopedWorkflowSettings | null>;
  previewImpact: (
    typeId: string,
    operation: ScopedWorkflowImpactOperation,
    control: string,
  ) => Promise<ScopedWorkflowImpact | null>;
  setStartState: (typeId: string, stateId: string, control: string) => Promise<void>;
  addTransition: (
    typeId: string,
    fromStateId: string,
    toStateId: string,
    control: string,
  ) => Promise<void>;
  removeTransition: (
    typeId: string,
    fromStateId: string,
    toStateId: string,
    control: string,
  ) => Promise<void>;
  removeWorkflowState: (
    typeId: string,
    stateId: string,
    control: string,
  ) => Promise<void>;
  setTransitionPermission: (
    typeId: string,
    fromStateId: string,
    toStateId: string,
    agentAllowed: boolean,
    control: string,
  ) => Promise<void>;
  upsertLaunchBinding: (
    typeId: string,
    stateId: string,
    binding: LaunchBindingInput,
    control: string,
  ) => Promise<ScopedWorkflowSettings | null>;
  setAutoStart: (
    typeId: string,
    stateId: string,
    autoStart: boolean,
    control: string,
  ) => Promise<void>;
  setSubtreeRun: (
    typeId: string,
    stateId: string,
    enabled: boolean,
    control: string,
  ) => Promise<void>;
  createState: (name: string, group: string) => Promise<void>;
  updateState: (stateId: string, patch: StatePatch) => Promise<void>;
  removeState: (command: RemoveStateCommand) => Promise<void>;
  moveState: (stateId: string, offset: -1 | 1) => Promise<void>;
  reorderState: (stateId: string, targetStateId: string) => Promise<void>;
}

let loadGeneration = 0;
const EMPTY_ISSUE_TYPES: IssueType[] = [];
const EMPTY_STATES: State[] = [];
const EMPTY_COUNTS: Record<string, number> = {};
const EMPTY_WORKFLOWS: Record<string, ScopedWorkflowSettings> = {};

const bySortOrder = <T extends { sort_order?: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

const countWorkItemsByState = (items: WorkItem[]): Record<string, number> =>
  items.reduce<Record<string, number>>((counts, item) => {
    // Canonical work-item rows carry relation UUIDs. Older hydrated callers
    // may still supply the full State object, so accept both while the Studio
    // view model remains richer than the generated wire model.
    const state = (item as unknown as { state: string | State | null }).state;
    const stateId = typeof state === "string" ? state : state?.id;
    if (stateId) counts[stateId] = (counts[stateId] ?? 0) + 1;
    return counts;
  }, {});

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === "object") {
    const detail = (error.body as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return error instanceof Error ? error.message : String(error);
}

export const useWorkflowEditorStore = create<WorkflowEditorState>((set, get) => ({
  projectId: null,
  issueTypes: [],
  states: [],
  stateWorkItemCounts: {},
  providerCapabilities: [],
  selectedTypeId: null,
  workflows: {},
  stagedStateIds: {},
  loading: false,
  action: null,
  notice: null,
  error: null,
  controlErrors: {},

  async load(projectId) {
    const generation = ++loadGeneration;
    const catalogRevision = stateCatalogRevision(projectId);
    set({
      projectId,
      selectedTypeId: null,
      stagedStateIds: {},
      loading: true,
      action: null,
      notice: null,
      error: null,
      controlErrors: {},
    });
    try {
      const {
        issueTypes,
        states,
        providerCapabilities,
        workItems,
      } = await loadWorkflowEditorResources(projectId);
      const workflowIssueTypes = issueTypes.filter((type) => type.level !== "module");
      const selectedTypeId = workflowIssueTypes[0]?.id ?? null;
      const selectedWorkflow = selectedTypeId
        ? await loadWorkflowSettings(projectId, selectedTypeId)
        : null;
      if (generation !== loadGeneration) return;
      set({
        issueTypes: workflowIssueTypes,
        states: bySortOrder(
          stateCatalogChangedSince(projectId, catalogRevision)
            ? states.map((state) =>
                overlayAuthoritativeState(projectId, state))
            : states,
        ),
        stateWorkItemCounts: countWorkItemsByState(workItems),
        providerCapabilities,
        selectedTypeId,
        workflows: selectedWorkflow
          ? { [selectedWorkflow.issue_type_id]: selectedWorkflow }
          : {},
        loading: false,
      });
    } catch (error) {
      if (generation !== loadGeneration) return;
      set({ loading: false, error: errorMessage(error) });
    }
  },

  // Provider activation and the global default live in host settings, so a
  // Settings save has to re-read the capabilities payload the editor mirrors.
  async refreshProviderCapabilities() {
    try {
      // Through the shared catalog so every launch surface — not just the
      // editor — sees the activation change without a reload. `force` because
      // this runs after a write: a read-only GET already in flight when the
      // PUT committed would otherwise be handed back as the new truth.
      const providerCapabilities = await loadProviderCapabilities({ force: true });
      set({ providerCapabilities });
    } catch {
      // A stale capability list is better than clearing the editor's options;
      // the next load() refetches anyway.
    }
  },

  async loadWorkflows(typeIds) {
    const missingTypeIds = typeIds.filter((typeId) => !get().workflows[typeId]);
    if (missingTypeIds.length === 0) return;
    const projectId = get().projectId;
    if (!projectId) return;
    set({ action: "load:workflows", notice: null, error: null });
    try {
      const rows = await loadAllWorkflowSettings(projectId, missingTypeIds);
      if (get().projectId !== projectId) return;
      set((state) => ({
        workflows: {
          ...state.workflows,
          ...Object.fromEntries(rows.map((row) => [row.issue_type_id, row])),
        },
        action: null,
      }));
    } catch (error) {
      if (get().projectId === projectId) {
        set({ action: null, error: errorMessage(error) });
      }
    }
  },

  async selectType(typeId) {
    if (typeId === get().selectedTypeId) return;
    set({
      selectedTypeId: typeId,
      notice: null,
      error: null,
      controlErrors: {},
    });
    if (get().workflows[typeId]) return;
    const projectId = get().projectId;
    if (!projectId) return;
    set({ action: `load:${typeId}` });
    try {
      const workflow = await loadWorkflowSettings(projectId, typeId);
      if (get().selectedTypeId !== typeId) return;
      set((state) => ({
        workflows: { ...state.workflows, [typeId]: workflow },
        action: null,
      }));
    } catch (error) {
      if (get().selectedTypeId === typeId) {
        set({ action: null, error: errorMessage(error) });
      }
    }
  },

  stageState(typeId, stateId) {
    set((state) => {
      const stagedStateIds = { ...state.stagedStateIds };
      if (stateId) {
        stagedStateIds[typeId] = stateId;
      } else {
        delete stagedStateIds[typeId];
      }
      return { stagedStateIds };
    });
  },

  async applyScoped(control, typeId, operation) {
    const workflow = get().workflows[typeId];
    const projectId = get().projectId;
    if (!workflow || !projectId) return null;
    set((state) => ({
      action: control,
      notice: null,
      error: null,
      controlErrors: { ...state.controlErrors, [control]: "" },
    }));
    try {
      await operation(workflow.workflow_revision);
      if (get().projectId !== projectId) return null;
      const next = await loadWorkflowSettings(projectId, typeId);
      setWorkflowSettings(next);
      synchronizeSubtreeRunCapabilities(
        projectId,
        next.issue_type_id,
        next.launch_bindings
          .filter((binding) => binding.subtree_run_enabled)
          .map((binding) => binding.state_id),
      );
      set((state) => ({
        workflows: { ...state.workflows, [typeId]: next },
        action: null,
        controlErrors: { ...state.controlErrors, [control]: "" },
      }));
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await loadWorkflowSettings(projectId, typeId);
          setWorkflowSettings(latest);
          synchronizeSubtreeRunCapabilities(
            projectId,
            latest.issue_type_id,
            latest.launch_bindings
              .filter((binding) => binding.subtree_run_enabled)
              .map((binding) => binding.state_id),
          );
          set((state) => ({
            workflows: { ...state.workflows, [typeId]: latest },
            action: null,
            notice: "Workflow changed elsewhere. Latest settings loaded.",
            controlErrors: { ...state.controlErrors, [control]: "" },
          }));
        } catch (refreshError) {
          set({ action: null, error: errorMessage(refreshError) });
        }
        return null;
      }
      set((state) => ({
        action: null,
        controlErrors: {
          ...state.controlErrors,
          [control]: errorMessage(error),
        },
      }));
      return null;
    }
  },

  async previewImpact(typeId, operation, control) {
    const workflow = get().workflows[typeId];
    if (!workflow) return null;
    set((state) => ({
      action: control,
      notice: null,
      error: null,
      controlErrors: { ...state.controlErrors, [control]: "" },
    }));
    try {
      const impact = deriveWorkflowImpact(workflow, operation);
      set({ action: null });
      return impact;
    } catch (error) {
      set((state) => ({
        action: null,
        controlErrors: {
          ...state.controlErrors,
          [control]: errorMessage(error),
        },
      }));
      return null;
    }
  },

  async setStartState(typeId, stateId, control) {
    await get().applyScoped(control, typeId, (revision) =>
      api.setIssueTypeWorkflowStartState(typeId, stateId, revision));
  },

  async addTransition(typeId, fromStateId, toStateId, control) {
    const next = await get().applyScoped(control, typeId, (revision) =>
      api.addIssueTypeWorkflowTransition(typeId, {
        from_state_id: fromStateId,
        to_state_id: toStateId,
        agent_allowed: true,
        workflow_revision: revision,
      }));
    if (next && get().stagedStateIds[typeId] === toStateId) {
      set((state) => {
        const stagedStateIds = { ...state.stagedStateIds };
        delete stagedStateIds[typeId];
        return { stagedStateIds };
      });
    }
  },

  async removeTransition(typeId, fromStateId, toStateId, control) {
    await get().applyScoped(control, typeId, (revision) =>
      api.removeIssueTypeWorkflowTransition(
        typeId,
        fromStateId,
        toStateId,
        revision,
      ));
  },

  async removeWorkflowState(typeId, stateId, control) {
    await get().applyScoped(control, typeId, (revision) =>
      api.removeIssueTypeWorkflowState(typeId, stateId, revision));
  },

  async setTransitionPermission(
    typeId,
    fromStateId,
    toStateId,
    agentAllowed,
    control,
  ) {
    await get().applyScoped(control, typeId, (revision) =>
      api.setIssueTypeWorkflowTransitionPermission(
        typeId,
        fromStateId,
        toStateId,
        agentAllowed,
        revision,
      ));
  },

  async upsertLaunchBinding(typeId, stateId, binding, control) {
    const projectId = get().projectId;
    const current = get().workflows[typeId]?.launch_bindings.find(
      (candidate) => candidate.state_id === stateId,
    );
    if (!projectId) return null;
    return get().applyScoped(control, typeId, (revision) =>
      api.upsertIssueTypeWorkflowLaunchBinding(
        projectId,
        typeId,
        stateId,
        {
          ...binding,
          required_skills:
            binding.required_skills ?? current?.required_skills ?? [],
        },
        revision,
        current?.auto_start ?? false,
        current?.subtree_run_enabled ?? false,
      ));
  },

  async setAutoStart(typeId, stateId, autoStart, control) {
    await get().applyScoped(control, typeId, (revision) =>
      api.setIssueTypeWorkflowAutoStart(
        typeId,
        stateId,
        autoStart,
        revision,
      ));
  },

  async setSubtreeRun(typeId, stateId, enabled, control) {
    await get().applyScoped(control, typeId, (revision) =>
      api.setIssueTypeWorkflowSubtreeRun(
        typeId,
        stateId,
        enabled,
        revision,
      ));
  },

  async createState(name, group) {
    const { projectId } = get();
    if (!projectId) return;
    set({ action: "create-state", notice: null, error: null });
    try {
      const created = await api.createState(projectId, { name, group });
      if (get().projectId !== projectId) return;
      advanceStateCatalogRevision(projectId, created);
      set({
        states: upsertState(projectId, created),
        action: null,
        notice: `State ${created.name} created.`,
      });
    } catch (error) {
      if (get().projectId === projectId) {
        set({ action: null, error: errorMessage(error) });
      }
    }
  },

  async updateState(stateId, patch) {
    const { projectId } = get();
    if (!projectId) return;
    set({ action: `state:${stateId}`, notice: null, error: null });
    try {
      const updated = await api.updateState(stateId, patch);
      if (get().projectId !== projectId) return;
      advanceStateCatalogRevision(projectId, updated);
      set({
        states: upsertState(projectId, updated),
        action: null,
        notice: `State ${updated.name} updated.`,
      });
    } catch (error) {
      if (get().projectId === projectId) {
        set({ action: null, error: errorMessage(error) });
      }
    }
  },

  async removeState(command) {
    const { projectId, issueTypes } = get();
    if (!projectId) return;
    set({ action: "remove-state", notice: null, error: null });
    try {
      await api.deleteState(command.stateId);
      if (get().projectId !== projectId) return;
      removeStateFromCatalog(projectId, command.stateId);
      set({ states: getWorkflowStatesSnapshot(projectId) });
      const [states, workflowRows, workItems] = await Promise.all([
        loadWorkflowStates(projectId),
        loadAllWorkflowSettings(projectId, issueTypes.map((type) => type.id)),
        loadWorkflowProjectItems(projectId),
      ]);
      if (get().projectId !== projectId) return;
      advanceStateCatalogRevision(projectId, states);
      setStatesSorted(projectId, states);
      for (const item of workItems) {
        queryClient.setQueryData(queryKeys.workItems.byId(item.id), item);
      }
      set({
        states: getWorkflowStatesSnapshot(projectId),
        stateWorkItemCounts: countWorkItemsByState(workItems),
        workflows: Object.fromEntries(workflowRows.map((row) => [
          row.issue_type_id,
          row,
        ])),
        action: null,
        notice: `State ${command.stateName} deleted.`,
      });
    } catch (error) {
      if (get().projectId === projectId) set({ action: null });
      throw error;
    }
  },

  async moveState(stateId, offset) {
    const { projectId, states } = get();
    if (!projectId) return;
    const index = states.findIndex((state) => state.id === stateId);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= states.length) return;
    const next = [...states];
    [next[index], next[target]] = [next[target], next[index]];
    const orderedIds = next.flatMap((state) => state.id ? [state.id] : []);
    set({ states: next, action: "reorder", notice: null, error: null });
    try {
      const reordered = await api.reorderStates(projectId, orderedIds);
      if (get().projectId !== projectId) return;
      advanceStateCatalogRevision(projectId, reordered);
      setStatesSorted(projectId, reordered);
      set({
        states: getWorkflowStatesSnapshot(projectId),
        action: null,
      });
    } catch (error) {
      if (get().projectId !== projectId) return;
      set({ states, action: null, error: errorMessage(error) });
    }
  },

  async reorderState(stateId, targetStateId) {
    const { projectId, states } = get();
    if (!projectId || stateId === targetStateId) return;
    const sourceIndex = states.findIndex((state) => state.id === stateId);
    const targetIndex = states.findIndex((state) => state.id === targetStateId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...states];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    const orderedIds = next.flatMap((state) => state.id ? [state.id] : []);
    set({ states: next, action: "reorder", notice: null, error: null });
    try {
      const reordered = await api.reorderStates(projectId, orderedIds);
      if (get().projectId !== projectId) return;
      advanceStateCatalogRevision(projectId, reordered);
      setStatesSorted(projectId, reordered);
      set({
        states: getWorkflowStatesSnapshot(projectId),
        action: null,
      });
    } catch (error) {
      if (get().projectId !== projectId) return;
      set({ states, action: null, error: errorMessage(error) });
    }
  },
}));

function ownValue<T>(state: WorkflowEditorState, key: keyof WorkflowEditorState): T | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(state, key);
  return descriptor && "value" in descriptor ? (descriptor.value as T) : undefined;
}

function routeAndAttachWorkflowServerState(state: WorkflowEditorState): void {
  const projectId = state.projectId;
  if (projectId) {
    const issueTypes = ownValue<IssueType[]>(state, "issueTypes");
    if (issueTypes !== undefined) setWorkflowIssueTypes(projectId, issueTypes);
    const states = ownValue<State[]>(state, "states");
    if (states !== undefined) setWorkflowStates(projectId, states);
    const counts = ownValue<Record<string, number>>(state, "stateWorkItemCounts");
    if (counts !== undefined) setWorkflowStateCounts(projectId, counts);
    const workflows = ownValue<Record<string, ScopedWorkflowSettings>>(
      state,
      "workflows",
    );
    if (workflows !== undefined) {
      setProjectWorkflowSettings(projectId, workflows);
    }
  }
  const providerCapabilities = ownValue<ProviderCapabilities[]>(
    state,
    "providerCapabilities",
  );
  if (providerCapabilities !== undefined) {
    setWorkflowProviderCapabilities(providerCapabilities);
  }

  Object.defineProperties(state, {
    issueTypes: {
      configurable: true,
      enumerable: false,
      get: () =>
        state.projectId
          ? getWorkflowIssueTypesSnapshot(state.projectId)
          : EMPTY_ISSUE_TYPES,
    },
    states: {
      configurable: true,
      enumerable: false,
      get: () =>
        state.projectId
          ? getWorkflowStatesSnapshot(state.projectId)
          : EMPTY_STATES,
    },
    stateWorkItemCounts: {
      configurable: true,
      enumerable: false,
      get: () =>
        state.projectId
          ? getWorkflowStateCountsSnapshot(state.projectId)
          : EMPTY_COUNTS,
    },
    providerCapabilities: {
      configurable: true,
      enumerable: false,
      get: getWorkflowProviderCapabilitiesSnapshot,
    },
    workflows: {
      configurable: true,
      enumerable: false,
      get: () =>
        state.projectId
          ? getProjectWorkflowSettingsSnapshot(state.projectId)
          : EMPTY_WORKFLOWS,
    },
  });
}

routeAndAttachWorkflowServerState(useWorkflowEditorStore.getState());
useWorkflowEditorStore.subscribe(routeAndAttachWorkflowServerState);
