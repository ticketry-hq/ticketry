import { useMemo } from "react";
import { isCancelledError, useQueries } from "@tanstack/react-query";
import { create } from "zustand";
import * as api from "../../../shared/api/client";
import { normalizeTask } from "../../../shared/api/client";
import {
  getModulesSnapshot,
  getProjectsSnapshot,
  loadModules as loadModulesData,
  loadProjects as loadProjectsData,
  seedModules,
  seedProjects,
  registerModuleRecencyProvider,
  sortModulesByRecency,
  useCachedModules,
  useCachedProjects,
  useStudioStore,
} from "../../projects";
import { TEMP_TASK_ID } from "../../agents/types";
import {
  getConfigSnapshot,
  getModuleFolder,
  updateProfile,
} from "./configStore";
import { useModalStore } from "../../../app/modal/modalStore";
import { toast } from "../../../state/clientStore";
import { apiErrorMessage } from "../../../shared/api/client";
import {
  loadChildWorkItems,
  rankBetween,
} from "../../work-items";
import { useIssueStore } from "../../work-items/issueStore";
import type {
  ModuleTree,
  Module,
  Project,
  ProjectCreate,
  State,
  WorkItem,
} from "../../../shared/api/types";
import {
  overlayAuthoritativeState,
  stateCatalogChangedSince,
  stateCatalogRevision,
} from "../../../shared/stateCatalogRevision";
import {
  getStatesSnapshot,
  setStatesSorted,
  useCachedStates,
} from "../../../shared/query/stateCatalog";
import {
  getTaskDetails,
  getTaskTree,
  loadTaskDetails as loadTaskDetailsData,
  loadTaskTree as loadTaskTreeData,
  setTaskDetails,
  setTaskTree,
  useCachedTaskDetails,
  useCachedTaskTree,
} from "./taskTreeCache";
import { queryClient } from "../../../shared/query/queryClient";
import { queryKeys } from "../../../shared/query/keys";
import { workItemQuery } from "../../work-items/queries";
import { loadIssueTypes } from "../../settings";
import {
  type ModuleSummary,
  type ProjectSummary,
  type TaskDetails,
  type TaskId,
  type TaskState,
  type TaskSummary,
} from "../lib/types";

// The recency sort is the shared, generic helper (#831) so the Studio modules
// pane and the Studio workitems surfaces cannot drift. Re-exported here for the
// existing call sites and tests that import it from this store.
export { sortModulesByRecency };

// Supply the concrete recency signal to the shared module loader. The activity
// map comes from the runs endpoint, which is host-specific and therefore lives
// in this module's API client rather than features/projects — the provider seam
// exists so that loader can stay independent of it. Without this the seam's
// no-op default would leave every module list in plain API order.
registerModuleRecencyProvider(api.getModuleActivity);

interface LoadingFlags {
  projects: boolean;
  modules: boolean;
  tasks: boolean;
  details: boolean;
  subtasks: boolean;
}

interface PendingStateDelta {
  state: TaskState;
  revision: number;
}

export type WorkspaceSelection =
  | { kind: "task" }
  | {
      kind: "state-configuration";
      projectId: string;
      stateId: string;
    };

interface TasksStoreState {
  /**
   * Derived projections of the shared project/module caches — this store keeps
   * no copy, so a switch between Studio surfaces cannot see two disagreeing
   * lists. React surfaces read useStudioProjects()/useStudioModules().
   */
  readonly projects: ProjectSummary[];
  selectedProjectId: string | null;
  readonly modules: ModuleSummary[];
  selectedModuleId: string | null;
  /** Derived from the module tree cache; see ./taskTreeCache. */
  readonly tasks: TaskSummary[];
  /** Derived from the one shared workflow-state catalog. */
  readonly states: TaskState[];
  selectedTaskId: string | null;
  workspaceSelection: WorkspaceSelection;
  readonly subtasks: Record<TaskId, TaskSummary[]>;
  readonly details: TaskDetails | null;
  /**
   * Which task's details are currently loaded. Client state: the details record
   * itself is cached per task id, and this says which entry the pane is showing
   * — they can differ from the selection while a load or a move is in flight.
   */
  detailsTaskId: string | null;
  loading: LoadingFlags;
  // Status-feed ordering guards (CODIN-1102): project-monotonic revisions,
  // never arrival order, decide whether a workflow-state write may land. The
  // latest accepted delta is retained even for rows not loaded yet so an
  // in-flight loadTasks response cannot overwrite a newer feed frame.
  seenStateRevisions: Record<string, number>;
  pendingStateDeltas: Record<string, PendingStateDelta>;
  pendingReorderTaskIds: Set<string>;

  loadProjects: () => Promise<void>;
  createProject: (body: ProjectCreate) => Promise<ProjectSummary>;
  selectProject: (id: string) => Promise<void>;
  loadModules: (projectId: string) => Promise<void>;
  createModule: (projectId: string, name: string) => Promise<string>;
  createStory: (
    projectId: string,
    moduleId: string,
    name: string,
  ) => Promise<TaskSummary>;
  selectModule: (id: string) => Promise<void>;
  loadTasks: (projectId: string, moduleId: string) => Promise<void>;
  selectTask: (id: string) => Promise<void>;
  toggleStateConfiguration: (projectId: string, stateId: string) => void;
  dismissStateConfiguration: () => void;
  loadDetails: (projectId: string, taskId: string) => Promise<void>;
  loadSubtasks: (projectId: string, taskId: string) => Promise<void>;
  updateTaskStatus: (projectId: string, taskId: string, stateId: string) => Promise<void>;
  updateTaskParent: (projectId: string, taskId: string, parentId: string | null) => Promise<void>;
  moveTaskWithinState: (
    taskId: string,
    beforeId: string | null,
    afterId: string | null,
  ) => Promise<boolean>;
  moveTaskToState: (
    taskId: string,
    destinationState: TaskState,
    beforeId: string | null,
    afterId: string | null,
  ) => Promise<boolean>;
  refreshTasks: () => Promise<void>;
  applyWorkItemStateDelta: (
    workItemId: string,
    state: State | null,
    revision: number,
  ) => boolean;
  reconcileTargetedTask: (
    item: WorkItem,
    requestedRevision: number,
  ) => "applied" | "ignored" | "stale";
  removeReconciledTask: (itemId: string, requestedRevision: number) => boolean;
}

let tasksLoadGeneration = 0;
// Versioned key (client-localstorage-schema): bump the suffix on shape
// changes and migrate in readTaskSelectionsValue.
const TASK_SELECTIONS_KEY = "studio.selectedTaskByModule:v1";
const LEGACY_TASK_SELECTIONS_KEYS = [
  "studio.studio.selectedTaskByModule",
  "studio.coding.selectedTaskByModule",
];
// One entry per module ever visited would grow forever; keep the most
// recently touched entries only.
const MAX_TASK_SELECTION_ENTRIES = 100;

function readTaskSelectionsValue(): string {
  const current = localStorage.getItem(TASK_SELECTIONS_KEY);
  if (current !== null) return current;
  for (const legacyKey of LEGACY_TASK_SELECTIONS_KEYS) {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy !== null) {
      localStorage.setItem(TASK_SELECTIONS_KEY, legacy);
      localStorage.removeItem(legacyKey);
      return legacy;
    }
  }
  return "{}";
}

function readTaskSelections(): Record<string, string> {
  try {
    const parsed = JSON.parse(readTaskSelectionsValue());
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function rememberTaskSelection(moduleId: string, taskId: string): void {
  try {
    const current = readTaskSelections();
    // Re-insert the touched module last (insertion order = recency), then
    // drop the oldest entries beyond the cap.
    delete current[moduleId];
    const entries = [...Object.entries(current), [moduleId, taskId] as const];
    localStorage.setItem(
      TASK_SELECTIONS_KEY,
      JSON.stringify(
        Object.fromEntries(entries.slice(-MAX_TASK_SELECTION_ENTRIES)),
      ),
    );
  } catch {}
}

function isCurrentTasksLoad(
  state: TasksStoreState,
  projectId: string,
  moduleId: string,
  generation: number,
) {
  return (
    generation === tasksLoadGeneration &&
    state.selectedProjectId === projectId &&
    state.selectedModuleId === moduleId
  );
}

function reconcileTask(
  tasks: TaskSummary[],
  returned: TaskSummary,
): TaskSummary[] {
  if (!tasks.some((task) => task.id === returned.id)) return tasks;
  return tasks.map((task) => (task.id === returned.id ? returned : task));
}

function toTaskState(state: State | null): TaskState {
  return state
    ? {
        id: state.id,
        name: state.name,
        group: state.group,
        color: state.color ?? null,
        sort_order: state.sort_order,
      }
    : { id: null, name: "No state", group: "", color: null };
}

// Every rendering of one work item in this store: module-root row, any
// subtask bucket rows, and the open details pane.
function findTaskCopies(state: TasksStoreState, itemId: string): TaskSummary[] {
  const copies = state.tasks.filter((task) => task.id === itemId);
  for (const children of Object.values(state.subtasks)) {
    copies.push(...children.filter((task) => task.id === itemId));
  }
  if (state.details?.task.id === itemId) copies.push(state.details.task);
  return copies;
}

function isTaskInTree(state: TasksStoreState, itemId: string): boolean {
  return (
    state.tasks.some((task) => task.id === itemId) ||
    Object.values(state.subtasks).some((children) =>
      children.some((task) => task.id === itemId),
    )
  );
}

function latestTaskRevision(state: TasksStoreState, itemId: string): number {
  return Math.max(
    state.seenStateRevisions[itemId] ?? 0,
    ...findTaskCopies(state, itemId).map((task) => task.state_revision ?? 0),
    0,
  );
}

function latestTaskUpdatedAt(
  state: TasksStoreState,
  itemId: string,
): string | undefined {
  return findTaskCopies(state, itemId)
    .map((task) => task.updated_at)
    .filter((value): value is string => typeof value === "string")
    .sort()
    .at(-1);
}

function patchTaskEverywhere(
  state: TasksStoreState,
  itemId: string,
  patch: (task: TaskSummary) => TaskSummary,
): Partial<TasksStoreState> | null {
  let found = false;
  const patchRow = (task: TaskSummary): TaskSummary => {
    if (task.id !== itemId) return task;
    found = true;
    return patch(task);
  };
  const tasks = state.tasks.map(patchRow);
  let subtasks = state.subtasks;
  for (const [parentId, children] of Object.entries(state.subtasks)) {
    if (!children.some((task) => task.id === itemId)) continue;
    if (subtasks === state.subtasks) subtasks = { ...state.subtasks };
    subtasks[parentId] = children.map(patchRow);
  }
  const details =
    state.details && state.details.task.id === itemId
      ? { ...state.details, task: patchRow(state.details.task) }
      : state.details;
  if (!found) return null;
  return { tasks, subtasks, details };
}

function taskRank(state: TasksStoreState, itemId: string | null): string | null {
  if (itemId === null) return null;
  return findTaskCopies(state, itemId)[0]?.rank ?? null;
}

function currentRankNeighbors(
  state: TasksStoreState,
  task: TaskSummary,
): { beforeId: string | null; afterId: string | null } {
  const canonical = state.tasks
    .filter(
      (candidate) =>
        candidate.id !== TEMP_TASK_ID &&
        candidate.state.id === task.state.id &&
        typeof candidate.rank === "string" &&
        candidate.rank.length > 0,
    )
    .sort((a, b) => (a.rank! < b.rank! ? -1 : a.rank! > b.rank! ? 1 : 0));
  const index = canonical.findIndex((candidate) => candidate.id === task.id);
  return {
    beforeId: index > 0 ? canonical[index - 1].id : null,
    afterId:
      index >= 0 && index < canonical.length - 1
        ? canonical[index + 1].id
        : null,
  };
}

function overlayAuthoritativeCatalog(
  projectId: string,
  rows: TaskSummary[],
): TaskSummary[] {
  return rows.map((row) => ({
    ...row,
    state: overlayAuthoritativeState(projectId, row.state),
  }));
}

/**
 * Strip the derived keys out of a state write and route each to the cache entry
 * that actually owns it. Both the store's internal `set` and the external
 * `setState` go through here, so no write can land on a shadowed own-property
 * that the accessors would then discard.
 */
function routeDerivedWrites(
  next: Partial<TasksStoreState>,
  current: TasksStoreState,
): Partial<TasksStoreState> {
  const { states, projects, modules, tasks, subtasks, details, ...rest } = next;
  const projectId = rest.selectedProjectId ?? current.selectedProjectId;
  const moduleId =
    rest.selectedModuleId !== undefined
      ? rest.selectedModuleId
      : current.selectedModuleId;

  if ((tasks !== undefined || subtasks !== undefined) && projectId && moduleId) {
    const existing = getTaskTree(projectId, moduleId);
    const nextRootIds = tasks?.map((task) => task.id) ?? existing.rootIds;
    const nextChildren: Record<string, string[]> = subtasks
      ? Object.fromEntries(
          Object.entries(subtasks).map(([parentId, children]) => [
            parentId,
            children.map((task) => task.id),
          ]),
        )
      : { ...existing.children };
    const mentionedIds = [
      ...nextRootIds,
      ...Object.values(nextChildren).flat(),
    ];
    if (tasks !== undefined || subtasks !== undefined) {
      for (const id of mentionedIds) nextChildren[id] ??= [];
    }
    setTaskTree(projectId, moduleId, {
      rootIds: nextRootIds,
      children: nextChildren,
      order: [
        ...existing.order.filter((id) => mentionedIds.includes(id)),
        ...mentionedIds.filter((id) => !existing.order.includes(id)),
      ],
    });
  }
  if (details !== undefined) {
    // A null write clears the pane; a record write both caches it and records
    // whose details are now on screen.
    rest.detailsTaskId = details?.task.id ?? null;
    if (projectId && details) setTaskDetails(projectId, details.task.id, details);
  }
  if (projects !== undefined) {
    seedProjects(
      projects.map((summary) => ({
        id: summary.id,
        name: summary.name,
        slug: summary.identifier,
        description: "",
      })),
    );
  }
  if (modules !== undefined && projectId) {
    seedModules(projectId, modules as unknown as Module[]);
  }
  if (states !== undefined && projectId) {
    setStatesSorted(
      projectId,
      states.filter((state) => state.id !== null) as State[],
    );
  }
  return rest;
}

export const useTasksStore = create<TasksStoreState>((rawSet, get, store) => {
  // The actions' `set` must route derived writes too — zustand hands the
  // creator the raw setter, which would otherwise bypass the interception the
  // external setState performs.
  const set: typeof rawSet = ((partial, replace) => {
    const current = store.getState();
    const next = typeof partial === "function" ? (partial as (s: TasksStoreState) => Partial<TasksStoreState>)(current) : partial;
    rawSet(routeDerivedWrites(next as Partial<TasksStoreState>, current) as typeof next, replace as never);
    attachDerivedStates(store.getState());
  }) as typeof rawSet;

  return {
  projects: [] as ProjectSummary[],
  selectedProjectId: null,
  modules: [] as ModuleSummary[],
  selectedModuleId: null,
  tasks: [],
  states: [] as TaskState[],
  selectedTaskId: null,
  workspaceSelection: { kind: "task" },
  subtasks: {},
  details: null,
  detailsTaskId: null,
  loading: {
    projects: false,
    modules: false,
    tasks: false,
    details: false,
    subtasks: false,
  },
  seenStateRevisions: {},
  pendingStateDeltas: {},
  pendingReorderTaskIds: new Set(),

  async loadProjects() {
    set((s) => ({ loading: { ...s.loading, projects: true } }));
    try {
      await loadProjectsData();
    } finally {
      set((s) => ({ loading: { ...s.loading, projects: false } }));
    }
  },

  async createProject(body) {
    // Still the Studio client (its normalization and error surface are what the
    // create flow expects); the result is published to the shared cache so both
    // Studio surfaces see the new project without a refetch.
    const created = await api.createProjectSummary(body);
    seedProjects([
      ...getProjectsSnapshot().filter((project) => project.id !== created.id),
      {
        id: created.id,
        name: created.name,
        slug: created.identifier,
        description: "",
      },
    ]);
    return created;
  },

  async selectProject(id: string) {
    set({
      selectedProjectId: id,
      selectedModuleId: null,
      tasks: [],
      subtasks: {},
      selectedTaskId: null,
      workspaceSelection: { kind: "task" },
      details: null,
      // Revisions are project-monotonic; another project's guards are noise.
      seenStateRevisions: {},
      pendingStateDeltas: {},
    });
    // Persist `recent_project_id` on the active profile (TUI parity: lines
    // 308–311 of tui/ui/app.py). Persistence is non-fatal — if it fails we
    // still proceed with the in-memory selection. Profile data lives in the
    // config store; reach across to read + persist it.
    const { recentProfileIndex, profiles } = getConfigSnapshot();
    let persistRecentProject: Promise<void> = Promise.resolve();
    if (recentProfileIndex !== null && profiles[recentProfileIndex]) {
      const profile = profiles[recentProfileIndex];
      if (profile.recent_project_id !== id) {
        persistRecentProject = updateProfile(recentProfileIndex, {
            name: profile.name,
            workspace_slug: profile.workspace_slug,
            agent_prompt: profile.agent_prompt,
            agent_prompts: profile.agent_prompts,
            module_links: profile.module_links,
            recent_project_id: id,
            recent_module_ids: profile.recent_module_ids ?? {},
          })
          .catch((err) => {
            console.warn("[tasksStore] persist recent_project_id failed", err);
          });
      }
    }
    // The profile write and the module fetch are independent; run them in
    // parallel so persistence latency stays off the critical path.
    await Promise.all([persistRecentProject, get().loadModules(id)]);

    // Auto-select module if we have a recent module ID for this project in the profile
    const updatedProfiles = getConfigSnapshot().profiles;
    if (recentProfileIndex !== null && updatedProfiles[recentProfileIndex]) {
      const profile = updatedProfiles[recentProfileIndex];
      const recentModuleId = profile.recent_module_ids?.[id];
      if (recentModuleId) {
        const hasModule = get().modules.some((m) => m.id === recentModuleId);
        if (hasModule) {
          await get().selectModule(recentModuleId);
        }
      }
    }
  },

  async loadModules(projectId: string) {
    set((s) => ({ loading: { ...s.loading, modules: true } }));
    try {
      // One shared, already recency-sorted module cache per project.
      await loadModulesData(projectId);
    } finally {
      set((s) => ({ loading: { ...s.loading, modules: false } }));
    }
  },

  async createModule(projectId: string, name: string) {
    // Create in the owned work tracker and refresh both module owners.
    const issueTypes = await loadIssueTypes(projectId, api.getIssueTypes);
    const moduleType = issueTypes.find(
      (issueType) => issueType.level === "module" && issueType.name === "Module",
    );
    if (!moduleType) throw new Error("The Module issue type is unavailable.");
    const created = await api.createModuleSummary(projectId, name, moduleType.id);

    // Keep the work-items project context in sync when it already owns this
    // project. Issue details derive a Story's module from that list, including
    // Run subtree eligibility, so leaving it stale hides the action until a
    // full reload.
    const workItemsStore = useStudioStore.getState();
    const refreshWorkItemsModules =
      workItemsStore.selectedProjectId === projectId
        ? workItemsStore.reloadModules()
        : Promise.resolve();

    // Refresh both module owners once creation succeeds. Selection belongs to
    // the creation surface after it has stored the new module's folder link.
    await Promise.all([
      get().loadModules(projectId),
      refreshWorkItemsModules,
    ]);
    return created.id;
  },

  async createStory(projectId: string, moduleId: string, name: string) {
    const issueTypes = await loadIssueTypes(projectId, api.getIssueTypes);
    const storyType = issueTypes.find(
      (issueType) => issueType.level === "task" && issueType.name === "Story",
    );
    if (!storyType) {
      throw new Error("The Story issue type is unavailable.");
    }

    const created = await api.createTask(
      projectId,
      name,
      moduleId,
      storyType.id,
    );
    set((state) => {
      if (
        state.selectedProjectId !== projectId ||
        state.selectedModuleId !== moduleId
      ) {
        return state;
      }
      // useTaskTree reverses each state bucket for newest-first presentation,
      // so append the returned Story to make it the first visible Idea row.
      return { tasks: [...state.tasks, created] };
    });
    return created;
  },

  async selectModule(id: string) {
    const { recentProfileIndex, profiles } = getConfigSnapshot();
    const profile =
      recentProfileIndex !== null ? profiles[recentProfileIndex] : null;
    if (!getModuleFolder(profile, id)) {
      useModalStore.getState().pushModal({
        type: "module-folder",
        payload: { moduleId: id, resumeModuleSelection: true },
      });
      return;
    }

    const projectId = get().selectedProjectId;
    set({
      selectedModuleId: id,
      tasks: [],
      subtasks: {},
      selectedTaskId: null,
      workspaceSelection: { kind: "task" },
      details: null,
    });
    if (projectId) {
      const { recentProfileIndex, profiles } = getConfigSnapshot();
      let persistRecentModule: Promise<void> = Promise.resolve();
      if (recentProfileIndex !== null && profiles[recentProfileIndex]) {
        const profile = profiles[recentProfileIndex];
        const nextRecentModuleIds = {
          ...(profile.recent_module_ids ?? {}),
          [projectId]: id,
        };
        persistRecentModule = updateProfile(recentProfileIndex, {
            name: profile.name,
            workspace_slug: profile.workspace_slug,
            agent_prompt: profile.agent_prompt,
            agent_prompts: profile.agent_prompts,
            module_links: profile.module_links,
            recent_project_id: profile.recent_project_id ?? null,
            recent_module_ids: nextRecentModuleIds,
          })
          .catch((err) => {
            console.warn("[tasksStore] persist recent_module_id failed", err);
          });
      }

      // The preference write is non-fatal and independent of the task fetch;
      // awaiting them together keeps its latency off every module switch. A
      // loadTasks failure propagates and leaves the sidebar visible so the
      // user can re-select (mirrors tui/ui/app.py:352–357).
      await Promise.all([persistRecentModule, get().loadTasks(projectId, id)]);
      if (
        get().selectedProjectId !== projectId ||
        get().selectedModuleId !== id
      ) {
        return;
      }
      // TUI parity (tui/ui/app.py:load_tasks lines 333–351): on success or
      // empty result, collapse the left two panes and focus the Tasks pane.
      // Dynamic import keeps the tasksStore ↔ clientStore cycle from biting at
      // module-eval time.
      const { useClientStore } = await import("../../../state/clientStore");
      useClientStore.getState().setSidebarVisible(false);
      useClientStore.getState().setFocusedPane("tasks");
    }
  },

  async loadTasks(projectId: string, moduleId: string) {
    const generation = ++tasksLoadGeneration;
    const catalogRevision = stateCatalogRevision(projectId);
    set((s) => ({ loading: { ...s.loading, tasks: true } }));
    try {
      const tree = await loadTaskTreeData(projectId, moduleId, async () => {
        const { rootIds, children, order, states, workItems } =
          await api.getTasks(projectId, moduleId);
        for (const item of workItems) {
          queryClient.setQueryData(queryKeys.workItems.byId(item.id), item);
        }
        useIssueStore.getState().hydrateWorkItems(workItems);
        const catalogChanged = stateCatalogChangedSince(
          projectId,
          catalogRevision,
        );
        // The module response carries the project's states. Publish them to
        // the one shared catalog unless a workflow edit landed while this fetch
        // was in flight, in which case the catalog is already newer.
        if (!catalogChanged) setStatesSorted(projectId, states as State[]);
        return { rootIds, children, order };
      });
      set((state) => {
        if (!isCurrentTasksLoad(state, projectId, moduleId, generation)) {
          return state;
        }
        const loadedTaskIds = new Set(tree.order);
        const rememberedTaskId = readTaskSelections()[moduleId];
        const isSelectableTaskId = (taskId: string) =>
          taskId === TEMP_TASK_ID || loadedTaskIds.has(taskId);
        return {
          selectedTaskId:
            state.selectedTaskId && isSelectableTaskId(state.selectedTaskId)
              ? state.selectedTaskId
              : rememberedTaskId && isSelectableTaskId(rememberedTaskId)
                ? rememberedTaskId
                : null,
        };
      });
    } catch (error) {
      if (!isCancelledError(error)) throw error;
    } finally {
      set((state) => {
        if (!isCurrentTasksLoad(state, projectId, moduleId, generation)) {
          return state;
        }
        return { loading: { ...state.loading, tasks: false } };
      });
    }
  },

  async selectTask(id: string) {
    // The scratch task is not a real work item: just select it and skip the
    // details + persisted-session fetches (no real id to query).
    if (id === TEMP_TASK_ID) {
      set({
        selectedTaskId: id,
        details: null,
        workspaceSelection: { kind: "task" },
      });
      return;
    }
    set({
      selectedTaskId: id,
      details: null,
      workspaceSelection: { kind: "task" },
    });
    // Selection is client intent only. The workspace subscribes to the
    // per-item holding directly; a loaded row therefore paints without a
    // request, while a genuinely absent deep-link entry loads in its query.
  },

  toggleStateConfiguration(projectId, stateId) {
    set((state) => ({
      workspaceSelection:
        state.workspaceSelection.kind === "state-configuration" &&
        state.workspaceSelection.projectId === projectId &&
        state.workspaceSelection.stateId === stateId
          ? { kind: "task" }
          : { kind: "state-configuration", projectId, stateId },
    }));
  },

  dismissStateConfiguration() {
    set((state) =>
      state.workspaceSelection.kind === "task"
        ? state
        : { workspaceSelection: { kind: "task" } },
    );
  },

  async loadDetails(projectId: string, taskId: string) {
    const catalogRevision = stateCatalogRevision(projectId);
    set((s) => ({ loading: { ...s.loading, details: true } }));
    try {
      const details = await loadTaskDetailsData(
        projectId,
        taskId,
        () => api.getTaskDetails(projectId, taskId),
      );
      set({
        details: stateCatalogChangedSince(projectId, catalogRevision)
          ? {
              ...details,
              task: {
                ...details.task,
                state: overlayAuthoritativeState(
                  projectId,
                  details.task.state,
                ),
              },
            }
          : details,
      });
    } finally {
      set((s) => ({ loading: { ...s.loading, details: false } }));
    }
  },

  async loadSubtasks(projectId: string, taskId: string) {
    const catalogRevision = stateCatalogRevision(projectId);
    set((s) => ({ loading: { ...s.loading, subtasks: true } }));
    try {
      const subs = (await loadChildWorkItems(projectId, taskId)).map(
        normalizeTask,
      );
      set((s) => ({
        subtasks: {
          ...s.subtasks,
          [taskId]: stateCatalogChangedSince(projectId, catalogRevision)
            ? overlayAuthoritativeCatalog(projectId, subs)
            : subs,
        },
      }));
    } finally {
      set((s) => ({ loading: { ...s.loading, subtasks: false } }));
    }
  },

  async updateTaskStatus(projectId: string, taskId: string, stateId: string) {
    // Work-item state is record data, not planning placement. Prefer the
    // canonical owner; the fallback only serves an unhydrated legacy tree.
    const owner = useIssueStore.getState();
    const owned = owner.getWorkItem(taskId);
    let returned: TaskSummary;
    if (owned) {
      const updated = await owner.setWorkItemState(taskId, stateId);
      if (!updated) return;
      returned = normalizeTask(updated);
    } else {
      returned = await api.postTaskStatus(projectId, taskId, stateId);
    }
    set((state) => {
      let subtasks = state.subtasks;
      for (const [parentId, children] of Object.entries(state.subtasks)) {
        const reconciled = reconcileTask(children, returned);
        if (reconciled === children) continue;
        if (subtasks === state.subtasks) subtasks = { ...state.subtasks };
        subtasks[parentId] = reconciled;
      }

      return {
        tasks: reconcileTask(state.tasks, returned),
        subtasks,
        details:
          state.details?.task.id === returned.id
            ? { ...state.details, task: returned }
            : state.details,
      };
    });
  },

  async updateTaskParent(projectId: string, taskId: string, parentId: string | null) {
    const owner = useIssueStore.getState();
    if (owner.getWorkItem(taskId)) {
      await owner.patchWorkItem(taskId, { parent_id: parentId });
    } else {
      await api.updateTaskParent(projectId, taskId, parentId);
    }
    // Refresh the module tree (membership may have changed) and the open
    // details so the Parent field reflects the new parent immediately. The
    // two refreshes are independent, so run them in parallel.
    await Promise.all([
      get().refreshTasks(),
      get().selectedTaskId === taskId
        ? get().loadDetails(projectId, taskId)
        : Promise.resolve(),
    ]);
  },

  async moveTaskWithinState(taskId, beforeId, afterId) {
    const task = get().tasks.find((candidate) => candidate.id === taskId);
    if (!task) return false;
    return get().moveTaskToState(taskId, task.state, beforeId, afterId);
  },

  async moveTaskToState(taskId, destinationState, beforeId, afterId) {
    const snapshot = get();
    const task = snapshot.tasks.find(
      (candidate) =>
        candidate.id === taskId &&
        candidate.id !== TEMP_TASK_ID &&
        candidate.parent_id === snapshot.selectedModuleId,
    );
    if (
      !task ||
      !destinationState.id ||
      !snapshot.selectedProjectId ||
      !snapshot.selectedModuleId ||
      snapshot.pendingReorderTaskIds.has(taskId)
    ) {
      return false;
    }
    const neighborIds = [beforeId, afterId].filter(
      (id): id is string => id !== null,
    );
    const neighbors = neighborIds.map((id) =>
      snapshot.tasks.find((candidate) => candidate.id === id),
    );
    if (
      neighbors.some(
        (neighbor) =>
          !neighbor ||
          neighbor.id === taskId ||
          neighbor.parent_id !== snapshot.selectedModuleId ||
          neighbor.state.id !== destinationState.id,
      )
    ) {
      return false;
    }
    const changesState = task.state.id !== destinationState.id;
    if (!changesState) {
      const currentNeighbors = currentRankNeighbors(snapshot, task);
      if (
        currentNeighbors.beforeId === beforeId &&
        currentNeighbors.afterId === afterId
      ) {
        return false;
      }
    }

    const beforeRank = taskRank(snapshot, beforeId);
    const afterRank = taskRank(snapshot, afterId);
    if (
      (beforeId !== null && beforeRank === null) ||
      (afterId !== null && afterRank === null)
    ) {
      return false;
    }
    let optimisticRank: string;
    try {
      optimisticRank = rankBetween(beforeRank, afterRank);
    } catch {
      return false;
    }

    const projectId = snapshot.selectedProjectId;
    const moduleId = snapshot.selectedModuleId;
    const loadGeneration = tasksLoadGeneration;
    const baseRevision = latestTaskRevision(snapshot, taskId);
    const baseUpdatedAt = latestTaskUpdatedAt(snapshot, taskId);
    const previousRank = task.rank;
    const previousState = task.state;
    const optimistic = patchTaskEverywhere(snapshot, taskId, (copy) => ({
      ...copy,
      state: destinationState,
      rank: optimisticRank,
    }));
    if (!optimistic) return false;
    set({
      ...optimistic,
      selectedTaskId: taskId,
      pendingReorderTaskIds: new Set([
        ...snapshot.pendingReorderTaskIds,
        taskId,
      ]),
    });

    let transitionAccepted = false;
    try {
      if (changesState) {
        const transitioned = await api.postTaskStatus(
          projectId,
          taskId,
          destinationState.id,
        );
        transitionAccepted = true;
        const current = get();
        const stillCurrent =
          current.selectedProjectId === projectId &&
          current.selectedModuleId === moduleId &&
          tasksLoadGeneration === loadGeneration;
        if (
          stillCurrent &&
          latestTaskRevision(current, taskId) <=
            (transitioned.state_revision ?? baseRevision)
        ) {
          const accepted = patchTaskEverywhere(current, taskId, (copy) => ({
            ...copy,
            state: transitioned.state,
            state_revision: transitioned.state_revision,
            updated_at: transitioned.updated_at,
            // The transition response still carries the old placement. Keep
            // the optimistic seam until the reorder response reconciles it.
            rank: optimisticRank,
          }));
          if (accepted) set(accepted);
        }
      }

      const authoritative = await api.reorderTask(taskId, beforeId, afterId);
      const current = get();
      const stillCurrent =
        current.selectedProjectId === projectId &&
        current.selectedModuleId === moduleId &&
        tasksLoadGeneration === loadGeneration;
      if (
        stillCurrent &&
        latestTaskRevision(current, taskId) <=
          (authoritative.state_revision ?? baseRevision) &&
        (!authoritative.updated_at ||
          !latestTaskUpdatedAt(current, taskId) ||
          latestTaskUpdatedAt(current, taskId)! <= authoritative.updated_at)
      ) {
        const reconciled = patchTaskEverywhere(current, taskId, () => authoritative);
        if (reconciled) set(reconciled);
      }
      return true;
    } catch (error) {
      const current = get();
      const stillCurrent =
        current.selectedProjectId === projectId &&
        current.selectedModuleId === moduleId &&
        tasksLoadGeneration === loadGeneration;
      const currentUpdatedAt = latestTaskUpdatedAt(current, taskId);
      const newerRankCopy =
        currentUpdatedAt !== undefined &&
        (baseUpdatedAt === undefined || currentUpdatedAt > baseUpdatedAt);
      if (
        !transitionAccepted &&
        stillCurrent &&
        latestTaskRevision(current, taskId) <= baseRevision &&
        !newerRankCopy
      ) {
        const restored = patchTaskEverywhere(current, taskId, (copy) => ({
          ...copy,
          state: previousState,
          rank: previousRank,
        }));
        if (restored) set(restored);
      }
      if (transitionAccepted) {
        try {
          await get().refreshTasks();
        } catch {
          // The accepted transition remains authoritative even when the
          // follow-up refresh cannot currently recover the server's rank.
        }
        toast.error(
          `Ticket moved, but placement failed: ${apiErrorMessage(error)}`,
        );
      } else {
        toast.error(apiErrorMessage(error));
      }
      return false;
    } finally {
      set((current) => {
        if (!current.pendingReorderTaskIds.has(taskId)) return current;
        const pendingReorderTaskIds = new Set(current.pendingReorderTaskIds);
        pendingReorderTaskIds.delete(taskId);
        return { pendingReorderTaskIds };
      });
    }
  },

  async refreshTasks() {
    const { selectedProjectId, selectedModuleId } = get();
    if (selectedProjectId && selectedModuleId) {
      await get().loadTasks(selectedProjectId, selectedModuleId);
    }
  },

  applyWorkItemStateDelta(workItemId, state, revision) {
    if (!Number.isSafeInteger(revision) || revision < 0) return false;
    const current = get();
    if (revision <= latestTaskRevision(current, workItemId)) return false;
    const nextState = toTaskState(state);
    const patched = patchTaskEverywhere(current, workItemId, (task) => ({
      ...task,
      state: nextState,
      state_revision: revision,
    }));
    set({
      ...(patched ?? {}),
      seenStateRevisions: {
        ...current.seenStateRevisions,
        [workItemId]: revision,
      },
      pendingStateDeltas: {
        ...current.pendingStateDeltas,
        [workItemId]: { state: nextState, revision },
      },
    });
    return true;
  },

  reconcileTargetedTask(item, requestedRevision) {
    const current = get();
    if (item.project_id !== current.selectedProjectId) return "ignored";
    const existingCopies = findTaskCopies(current, item.id);
    if (item.is_archived) {
      if (existingCopies.length === 0) return "ignored";
      return get().removeReconciledTask(item.id, requestedRevision)
        ? "applied"
        : "ignored";
    }
    const incomingRevision = item.state_revision ?? 0;
    if (incomingRevision < requestedRevision) return "stale";
    if (latestTaskRevision(current, item.id) > incomingRevision) {
      return "ignored";
    }
    const normalized = normalizeTask(item);
    const pendingStateDeltas = { ...current.pendingStateDeltas };
    delete pendingStateDeltas[item.id];
    if (existingCopies.length > 0) {
      const patched = patchTaskEverywhere(current, item.id, () => normalized);
      if (!patched) return "ignored";
      set({ ...patched, pendingStateDeltas });
      return "applied";
    }

    const parentId = item.parent_id;
    if (!parentId || !isTaskInTree(current, parentId)) return "ignored";
    const existingChildren = current.subtasks[parentId] ?? [];
    const patchedParent = patchTaskEverywhere(current, parentId, (parent) => ({
      ...parent,
      sub_issues_count: Math.max(
        parent.sub_issues_count,
        existingChildren.length + 1,
      ),
    }));
    if (!patchedParent) return "ignored";
    set({
      ...patchedParent,
      subtasks: {
        ...(patchedParent.subtasks ?? current.subtasks),
        [parentId]: [...existingChildren, normalized],
      },
      pendingStateDeltas,
    });
    return "applied";
  },

  removeReconciledTask(itemId, requestedRevision) {
    const current = get();
    if (latestTaskRevision(current, itemId) > requestedRevision) return false;
    if (findTaskCopies(current, itemId).length === 0) return false;
    let subtasks = current.subtasks;
    for (const [parentId, children] of Object.entries(current.subtasks)) {
      if (!children.some((task) => task.id === itemId)) continue;
      if (subtasks === current.subtasks) subtasks = { ...current.subtasks };
      subtasks[parentId] = children.filter((task) => task.id !== itemId);
    }
    const pendingStateDeltas = { ...current.pendingStateDeltas };
    delete pendingStateDeltas[itemId];
    set({
      tasks: current.tasks.filter((task) => task.id !== itemId),
      subtasks,
      details: current.details?.task.id === itemId ? null : current.details,
      selectedTaskId:
        current.selectedTaskId === itemId ? null : current.selectedTaskId,
      seenStateRevisions: {
        ...current.seenStateRevisions,
        [itemId]: Math.max(
          latestTaskRevision(current, itemId),
          requestedRevision,
        ),
      },
      pendingStateDeltas,
    });
    return true;
  },
  };
});

// Studio's panes want a slimmer row than the backend record. Project the shared
// cache lazily and memoize on the cached array's identity, so repeated reads
// (and zustand selector comparisons) keep returning the same objects.
function normalizeProjectSummary(project: Project): ProjectSummary {
  return { id: project.id, name: project.name, identifier: project.slug };
}

// sortModulesByRecency merges the activity timestamp onto the cached records,
// so the cache entry carries a field the generated Module type does not declare.
type CachedModule = Module & { last_activity?: string };

function normalizeModuleSummary(module: CachedModule): ModuleSummary {
  return {
    id: module.id,
    name: module.name,
    project_id: module.project_id,
    ...(module.last_activity ? { last_activity: module.last_activity } : {}),
  };
}

function memoizeProjection<S, R>(project: (source: S[]) => R[]) {
  let last: { source: S[]; result: R[] } | null = null;
  return (source: S[]): R[] => {
    if (last?.source !== source) last = { source, result: project(source) };
    return last.result;
  };
}

const projectSummaries = memoizeProjection<Project, ProjectSummary>((rows) =>
  rows.map(normalizeProjectSummary),
);
const moduleSummariesByProject = new Map<
  string,
  (source: CachedModule[]) => ModuleSummary[]
>();

function moduleSummaries(projectId: string | null): ModuleSummary[] {
  if (!projectId) return EMPTY_MODULE_SUMMARIES;
  let projector = moduleSummariesByProject.get(projectId);
  if (!projector) {
    projector = memoizeProjection<CachedModule, ModuleSummary>((rows) =>
      rows.map(normalizeModuleSummary),
    );
    moduleSummariesByProject.set(projectId, projector);
  }
  return projector(getModulesSnapshot(projectId));
}

const EMPTY_MODULE_SUMMARIES: ModuleSummary[] = [];

// `states` is derived, never stored: one shared workflow-state catalog.
function attachDerivedStates(state: TasksStoreState): void {
  Object.defineProperties(state, {
    states: {
      configurable: true,
      enumerable: false,
      get: () => getStatesSnapshot(state.selectedProjectId) as TaskState[],
    },
    projects: {
      configurable: true,
      enumerable: false,
      get: () => projectSummaries(getProjectsSnapshot()),
    },
    modules: {
      configurable: true,
      enumerable: false,
      get: () => moduleSummaries(state.selectedProjectId),
    },
    tasks: {
      configurable: true,
      enumerable: false,
      get: () => {
        const tree = getTaskTree(state.selectedProjectId, state.selectedModuleId);
        return tree.rootIds.flatMap((id) => {
          const item = queryClient.getQueryData<WorkItem>(
            queryKeys.workItems.byId(id),
          );
          return item ? [item as unknown as TaskSummary] : [];
        });
      },
    },
    subtasks: {
      configurable: true,
      enumerable: false,
      get: () => {
        const tree = getTaskTree(state.selectedProjectId, state.selectedModuleId);
        return Object.fromEntries(
          Object.entries(tree.children).map(([parentId, ids]) => [
            parentId,
            ids.flatMap((id) => {
              const item = queryClient.getQueryData<WorkItem>(
                queryKeys.workItems.byId(id),
              );
              return item ? [item as unknown as TaskSummary] : [];
            }),
          ]),
        );
      },
    },
    details: {
      configurable: true,
      enumerable: false,
      get: () => getTaskDetails(state.selectedProjectId, state.detailsTaskId),
    },
  });
}

attachDerivedStates(useTasksStore.getState());
useTasksStore.subscribe((state) => attachDerivedStates(state));

// A `states` write has no local home any more; route it to the shared catalog
// for whichever project the write is about.
const rawSetState = useTasksStore.setState;
useTasksStore.setState = ((partial, replace) => {
  const current = useTasksStore.getState();
  const next = typeof partial === "function" ? partial(current) : partial;
  rawSetState(routeDerivedWrites(next, current) as typeof next, replace);
  attachDerivedStates(useTasksStore.getState());
}) as typeof useTasksStore.setState;

/**
 * Reactive reads of the Stories tree. The store's actions own the fetches; these
 * subscribe to the cache entries those fetches populate, so a feed delta or a
 * reorder re-renders the panes.
 */
export function useStudioTaskMembership(): ModuleTree {
  const projectId = useTasksStore((s) => s.selectedProjectId);
  const moduleId = useTasksStore((s) => s.selectedModuleId);
  return useCachedTaskTree(projectId, moduleId);
}

/**
 * Transitional record resolver for non-Stories callers. The module entry is
 * still id-only; these arrays contain the work-item entry objects themselves
 * and are computed for the caller rather than cached.
 */
export function useStudioTaskTree(): {
  tasks: TaskSummary[];
  subtasks: Record<TaskId, TaskSummary[]>;
} {
  const tree = useStudioTaskMembership();
  const itemQueries = useQueries(
    { queries: tree.order.map((id) => workItemQuery(id)) },
    queryClient,
  );
  const itemsById = new Map(
    itemQueries.flatMap(({ data: item }) =>
      item ? [[item.id, item] as const] : [],
    ),
  );
  return {
    tasks: tree.rootIds.flatMap((id) => {
      const item = itemsById.get(id);
      return item ? [item as unknown as TaskSummary] : [];
    }),
    subtasks: Object.fromEntries(
      Object.entries(tree.children).map(([parentId, ids]) => [
        parentId,
        ids.flatMap((id) => {
          const item = itemsById.get(id);
          return item ? [item as unknown as TaskSummary] : [];
        }),
      ]),
    ),
  };
}

/** Resolve collapsed-subtree structure without storing it on a row. */
export function useStudioTaskDescendantIds(taskId: string): string[] {
  const projectId = useTasksStore((s) => s.selectedProjectId);
  const moduleId = useTasksStore((s) => s.selectedModuleId);
  const tree = useCachedTaskTree(projectId, moduleId);
  return useMemo(() => {
    const ids: string[] = [];
    const visited = new Set([taskId]);
    const pending = [...(tree.children[taskId] ?? [])];
    while (pending.length > 0) {
      const childId = pending.pop();
      if (!childId || visited.has(childId)) continue;
      visited.add(childId);
      ids.push(childId);
      pending.push(...(tree.children[childId] ?? []));
    }
    return ids;
  }, [taskId, tree]);
}

export function useStudioTaskDetails(): TaskDetails | null {
  const projectId = useTasksStore((s) => s.selectedProjectId);
  const taskId = useTasksStore((s) => s.selectedTaskId);
  return useCachedTaskDetails(projectId, taskId);
}

/** Reactive read of Studio's project rows. */
export function useStudioProjects(): ProjectSummary[] {
  return projectSummaries(useCachedProjects());
}

/** Reactive read of the selected project's module rows. */
export function useStudioModules(): ModuleSummary[] {
  const projectId = useTasksStore((s) => s.selectedProjectId);
  const cached = useCachedModules(projectId);
  return useMemo(() => cached.map(normalizeModuleSummary), [cached]);
}

/**
 * Reactive read of the task-pane state list. Subscribes to the shared catalog,
 * so a workflow rename or reorder re-renders the panes.
 */
export function useTaskStates(): TaskState[] {
  const projectId = useTasksStore((s) => s.selectedProjectId);
  return useCachedStates(projectId) as TaskState[];
}

useTasksStore.subscribe((state, previous) => {
  if (
    !state.selectedModuleId ||
    !state.selectedTaskId ||
    (state.selectedModuleId === previous.selectedModuleId &&
      state.selectedTaskId === previous.selectedTaskId)
  ) {
    return;
  }
  rememberTaskSelection(state.selectedModuleId, state.selectedTaskId);
});
