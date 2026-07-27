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
} from "../../shared/api/types";
import * as api from "../studio/workflowApi";
import { fetchLaunchProviderCatalog } from "./launchProviderCatalog";
import {
  synchronizeActiveStateCatalogOrder,
  synchronizeActiveStateCatalogs,
} from "./stateCatalogSync";
import {
  overlayAuthoritativeState,
  stateCatalogChangedSince,
  stateCatalogRevision,
} from "../../shared/stateCatalogRevision";
import {
  prepareActiveStateRemoval,
  reconcileActiveStateRemoval,
} from "./stateRemovalSync";
import { useSettingsStore } from "../settings/store";

interface RemoveStateCommand {
  stateId: string;
  stateName: string;
  replacementId?: string;
  replacementName?: string;
  replacement?: State;
  impactToken: string;
}

type ScopedOperation = (
  workflowRevision: number,
) => Promise<ScopedWorkflowSettings>;

interface WorkflowEditorState {
  projectId: string | null;
  issueTypes: IssueType[];
  states: State[];
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

const bySortOrder = <T extends { sort_order?: number }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

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
      issueTypes: [],
      states: [],
      providerCapabilities: [],
      selectedTypeId: null,
      workflows: {},
      stagedStateIds: {},
      loading: true,
      action: null,
      notice: null,
      error: null,
      controlErrors: {},
    });
    try {
      const [issueTypes, states, providerCapabilities] = await Promise.all([
        api.getIssueTypes(projectId),
        api.getStates(projectId),
        fetchLaunchProviderCatalog(),
      ]);
      const workflowIssueTypes = issueTypes.filter((type) => type.level !== "module");
      const selectedTypeId = workflowIssueTypes[0]?.id ?? null;
      const selectedWorkflow = selectedTypeId
        ? await api.getIssueTypeWorkflowSettings(selectedTypeId)
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
      // editor — sees the activation change without a reload.
      const providerCapabilities = await fetchLaunchProviderCatalog();
      set({ providerCapabilities });
    } catch {
      // A stale capability list is better than clearing the editor's options;
      // the next load() refetches anyway.
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
    set({ action: `load:${typeId}` });
    try {
      const workflow = await api.getIssueTypeWorkflowSettings(typeId);
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
    if (!workflow) return null;
    set((state) => ({
      action: control,
      notice: null,
      error: null,
      controlErrors: { ...state.controlErrors, [control]: "" },
    }));
    try {
      const next = await operation(workflow.workflow_revision);
      const projectId = get().projectId;
      if (projectId === null) return null;
      const settings = useSettingsStore.getState();
      settings.synchronizeSubtreeRunCapabilities(
        projectId,
        next.issue_type_id,
        next.launch_bindings
          .filter((binding) => binding.subtree_run_enabled)
          .map((binding) => binding.state_id),
      );
      await settings.refreshSubtreeRunCapabilities(projectId);
      set((state) => ({
        workflows: { ...state.workflows, [typeId]: next },
        action: null,
        controlErrors: { ...state.controlErrors, [control]: "" },
      }));
      return next;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await api.getIssueTypeWorkflowSettings(typeId);
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
      const impact = await api.previewIssueTypeWorkflowImpact(
        typeId,
        operation,
        workflow.workflow_revision,
      );
      set({ action: null });
      return impact;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        try {
          const latest = await api.getIssueTypeWorkflowSettings(typeId);
          set((state) => ({
            workflows: { ...state.workflows, [typeId]: latest },
            action: null,
            notice: "Workflow changed elsewhere. Latest settings loaded.",
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
    return get().applyScoped(control, typeId, (revision) =>
      api.upsertIssueTypeWorkflowLaunchBinding(
        typeId,
        stateId,
        binding,
        revision,
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
      set({
        states: synchronizeActiveStateCatalogs(
          projectId,
          created,
          get().states,
        ),
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
      set({
        states: synchronizeActiveStateCatalogs(
          projectId,
          updated,
          get().states,
        ),
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
      await api.deleteState(
        command.stateId,
        command.replacementId,
        command.impactToken,
      );
      if (get().projectId !== projectId) return;
      const replacement =
        command.replacement ??
        (command.replacementId
          ? get().states.find((state) => state.id === command.replacementId) ?? null
          : null);
      const prepared = prepareActiveStateRemoval(
        projectId,
        command.stateId,
        replacement,
        get().states,
      );
      set({ states: prepared.workflowStates });
      const [states, workflowRows, workItems] = await Promise.all([
        api.getStates(projectId),
        Promise.all(issueTypes.map((type) =>
          api.getIssueTypeWorkflowSettings(type.id))),
        api.getProjectWorkItems(projectId),
      ]);
      if (get().projectId !== projectId) return;
      set({
        states: reconcileActiveStateRemoval(
          projectId,
          command.stateId,
          prepared.affectedIds,
          states,
          workItems,
        ),
        workflows: Object.fromEntries(workflowRows.map((row) => [
          row.issue_type_id,
          row,
        ])),
        action: null,
        notice: command.replacementName
          ? `State ${command.stateName} replaced with ${command.replacementName}.`
          : `State ${command.stateName} deleted.`,
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
      const reordered = await api.reorderWorkflowStates(projectId, orderedIds);
      if (get().projectId !== projectId) return;
      set({
        states: synchronizeActiveStateCatalogOrder(projectId, reordered),
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
      const reordered = await api.reorderWorkflowStates(projectId, orderedIds);
      if (get().projectId !== projectId) return;
      set({
        states: synchronizeActiveStateCatalogOrder(projectId, reordered),
        action: null,
      });
    } catch (error) {
      if (get().projectId !== projectId) return;
      set({ states, action: null, error: errorMessage(error) });
    }
  },
}));
