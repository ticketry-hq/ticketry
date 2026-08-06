import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import type {
  ProviderCapabilitiesOut,
  StateImpactOut,
} from "@worktracker/typescript-sdk/models";
import { OriginEnum } from "@worktracker/typescript-sdk/models";
import type {
  IssueType,
  IssueTypeCreate,
  IssueTypePatch,
  Module,
  ModuleWorkItemCreate,
  Project,
  ProjectCreate,
  ProjectPatch,
  State,
  StateCreate,
  StatePatch,
  LaunchBindingInput,
  ProviderCatalog,
  ScopedWorkflowImpact,
  ScopedWorkflowImpactOperation,
  ScopedWorkflowSettings,
  SubtreeRunCapabilityMap,
  WorkItem,
  WorkItemCreate,
  WorkItemDetail,
  WorkItemFilters,
  WorkItemPatch,
  Workspace,
} from "./types";
import { agentApiUrl, runtimeConfiguration } from "../../runtime";

export { documentUrl as docUrl } from "./documentUrl";

interface StudioProfile {
  name: string;
  workspace_slug: string;
  agent_prompt: string | null;
  agent_prompts: Record<string, string>;
  module_links: Array<{ module_id: string; path: string }>;
  recent_project_id?: string | null;
  recent_module_ids?: Record<string, string>;
}

interface StudioConfigPayload {
  recent_profile_index: number | null;
  profiles: StudioProfile[];
  features: {
    sidebar: boolean;
    projects: boolean;
  };
}

interface StudioTaskState {
  id: string | null;
  name: string;
  group: string;
  color: string | null;
  sort_order?: number;
}

interface StudioTaskSummary {
  id: string;
  name: string;
  project_id: string;
  sequence_id: number | null;
  key?: string;
  rank?: string;
  state: StudioTaskState;
  issue_type: {
    id: string;
    name: string;
    level: "module" | "task";
  };
  description: string | null;
  parent_id: string | null;
  sub_issues_count: number;
  state_revision?: number;
  updated_at?: string;
}

export function apiBase(): string {
  return runtimeConfiguration().endpoints.workTrackerApi;
}

export function agentApiBase(): string {
  return runtimeConfiguration().endpoints.statusApi;
}

export function apiKey(): string {
  return runtimeConfiguration().values.workTrackerApiKey;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const key = apiKey();
  const response = await fetch(agentApiUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(key ? { "x-api-key": key } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && "message" in body
        ? String((body as { message?: string }).message)
        : `HTTP ${response.status}`;
    throw new ApiError(response.status, message, body);
  }
  return body as T;
}

// Human-readable message for a failed mutation (#872). The workflow gate (#860)
// answers a rejected state move with a structured body — a human `detail` plus a
// machine `code` and the offending `from`/`to`. Prefer that `detail` so a
// refused board drag / status change / bulk action tells the user *why*
// ("A Story cannot move 'Idea' → 'Done'."), not a bare "422". Falls back to the
// status line for other API errors, and to the raw message otherwise.
export function apiErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body;
    if (body && typeof body === "object") {
      const detail = (body as { detail?: unknown }).detail;
      if (typeof detail === "string" && detail) return detail;
    }
    return `${e.status}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}

// A same-state move: the workflow gate (#860) refuses `from → from` as an
// `illegal_transition` (it keeps a redundant re-select from triggering an
// unexpected flip). The move stays disallowed server-side, but the rejection
// carries no new information for the user, so callers suppress its toast.
export function isNoOpTransition(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false;
  const body = e.body;
  if (!body || typeof body !== "object") return false;
  const { from, to } = body as { from?: unknown; to?: unknown };
  return typeof from === "string" && from === to;
}

function sdk() {
  return createWorkTrackerClient({
    baseUrl: apiBase(),
    apiKey: apiKey(),
  });
}

async function call<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkTrackerApiError) {
      throw new ApiError(error.status, error.message, error.body);
    }
    throw error;
  }
}

export function normalizeTask(task: WorkItem): StudioTaskSummary {
  const source = task as unknown as Omit<StudioTaskSummary, "state"> & {
    state: StudioTaskState | null;
  };
  return {
    id: source.id,
    name: source.name,
    project_id: source.project_id,
    sequence_id: source.sequence_id,
    key: source.key,
    rank: source.rank,
    state:
      source.state ?? {
        id: null,
        name: "No state",
        group: "",
        color: null,
      },
    issue_type: source.issue_type,
    description: source.description,
    parent_id: source.parent_id,
    sub_issues_count: source.sub_issues_count,
    state_revision: source.state_revision,
    updated_at: source.updated_at,
  };
}

export function moduleTreeFromWorkItems(
  moduleId: string,
  tasks: readonly WorkItem[],
) {
  const rootIds: string[] = [];
  const children: Record<string, string[]> = {};
  const order: string[] = [];

  for (const task of tasks) {
    order.push(task.id);
    children[task.id] = [];
  }
  for (const task of tasks) {
    if (task.parent_id === moduleId) rootIds.push(task.id);
    else if (task.parent_id && children[task.parent_id]) {
      children[task.parent_id].push(task.id);
    }
  }

  return { rootIds, children, order };
}

// Host configuration operations live in this same request layer even though
// their routes are mounted outside /api/work-tracker.
export const getConfig = () =>
  call(() => sdk().configuration.configRetrieve()) as Promise<StudioConfigPayload>;

export const postProfile = (body: Partial<StudioProfile>) =>
  call(() => sdk().configuration.configProfilesCreate({ profile: body as never })) as Promise<StudioConfigPayload>;

export const putProfile = (index: number, body: Partial<StudioProfile>) =>
  call(() => sdk().configuration.configProfilesUpdate({ index, profile: body as never })) as Promise<StudioConfigPayload>;

export const deleteProfile = (index: number) =>
  call(() => sdk().configuration.configProfilesDestroy({ index })) as Promise<StudioConfigPayload>;

export const patchConfig = (body: { recent_profile_index: number }) =>
  call(() => sdk().configuration.configPartialUpdate({ patchedRecentIndex: body })) as Promise<StudioConfigPayload>;

export const listProjects = () =>
  call<Project[]>(async () => (await sdk().projects.listProjects()) as Project[]);

export const getWorkspace = () =>
  call<Workspace>(async () => (await sdk().workspace.getWorkspace()) as Workspace);

export const acknowledgeOnboarding = () =>
  call<Workspace>(async () =>
    (await sdk().workspace.acknowledgeWorkspaceOnboarding()) as Workspace
  );

export const createProject = (body: ProjectCreate) =>
  call<Project>(async () =>
    (await sdk().projects.createProject({ projectIn: body })) as Project
  );

export const createProjectSummary = (body: ProjectCreate) =>
  call(async () => {
    const project = (await sdk().projects.createProject({ project: body })) as Project;
    return {
      id: project.id,
      name: project.name,
      identifier: project.slug,
    };
  });

export const updateProject = (id: string, patch: ProjectPatch) =>
  call<Project>(async () =>
    (await sdk().projects.updateProject({
      projectId: id,
      projectPatch: patch,
    })) as Project
  );

export const deleteProject = (id: string) =>
  call<void>(() => sdk().projects.deleteProject({ projectId: id }));

export const listModules = (projectId: string) =>
  call<Module[]>(async () =>
    (await sdk().modules.listModules({ projectId })) as Module[]
  );

export const createModule = (projectId: string, name: string, issueTypeId: string) =>
  call<Module>(async () =>
    (await sdk().modules.createModule({
      projectId,
      moduleIn: { name, issue_type_id: issueTypeId },
    })) as Module
  );

export const createModuleSummary = (
  projectId: string,
  name: string,
  issueTypeId: string,
) =>
  call(async () => {
    const module = (await sdk().modules.createModule({
      projectId,
      moduleCreate: { name, issue_type_id: issueTypeId },
    })) as Module;
    return {
      id: module.id,
      name: module.name,
      project_id: module.project_id,
    };
  });

export const getModuleActivity = (
  projectId: string,
): Promise<Record<string, string>> =>
  call(() => sdk().runs.runsModuleActivityRetrieve({ projectId }))
    .then((value) => value as Record<string, string>)
    .catch(() => ({}));

export const listStates = (projectId: string) =>
  call<State[]>(async () =>
    (await sdk().states.listStates({ projectId })) as State[]
  );

export const getStates = (projectId: string): Promise<State[]> =>
  call(async () =>
    (await sdk().states.listStates({ projectId })) as State[]);

export const listProjectWorkItems = (
  projectId: string,
  filters?: WorkItemFilters,
) =>
  call<WorkItem[]>(async () =>
    (await sdk().workItems.listProjectWorkItems({
      projectId,
      parent: filters?.parent,
      state: filters?.state,
      includePathfind: filters?.includePathfind,
    })) as WorkItem[]
  );

/** Read the canonical work-item collection narrowed to the requested ids. */
export const listWorkItemsByIds = (ids: readonly string[]) =>
  call<WorkItem[]>(async () =>
    (await sdk().workItems.batchWorkItems({
      workItemBatch: { ids: [...ids] },
    })) as WorkItem[],
  );

export const getWorkItem = (keyOrId: string, signal?: AbortSignal) =>
  call<WorkItemDetail>(async () => {
    const task = (await sdk().workItems.getWorkItem(
      { issueId: keyOrId },
      signal ? { signal } : undefined,
    )) as WorkItem;
    return { task, attachments: [] };
  });

export const createWorkItem = (projectId: string, body: WorkItemCreate) =>
  call<WorkItem>(async () =>
    (await sdk().workItems.createProjectWorkItem({
      projectId,
      workItemIn: body,
    })) as WorkItem
  );

export const createModuleWorkItem = (
  moduleId: string,
  body: ModuleWorkItemCreate,
) =>
  call<WorkItem>(async () =>
    (await sdk().workItems.createModuleWorkItem({
      moduleId,
      moduleWorkItemIn: body,
    })) as WorkItem
  );

export const patchWorkItem = (id: string, patch: WorkItemPatch) => {
  const studioPatch = "state_id" in patch
    ? { ...patch, origin: OriginEnum.human }
    : patch;
  return call<WorkItem>(async () =>
    (await sdk().workItems.updateWorkItem({
      issueId: id,
      workItemPatch: studioPatch,
    })) as WorkItem
  );
};

export const deleteWorkItem = (id: string) =>
  call<void>(() => sdk().workItems.deleteWorkItem({ issueId: id }));

export const reorderWorkItem = (
  id: string,
  neighbors: { before_id: string | null; after_id: string | null },
) =>
  call<WorkItem>(async () =>
    (await sdk().workItems.reorderWorkItem({
      issueId: id,
      workItemReorderIn: neighbors,
    })) as WorkItem
  );

export const reorderTask = (
  taskId: string,
  beforeId: string | null,
  afterId: string | null,
) =>
  call(async () =>
    normalizeTask(
      (await sdk().workItems.reorderWorkItem({
        issueId: taskId,
        workItemReorder: {
          before_id: beforeId,
          after_id: afterId,
        },
      })) as WorkItem,
    ),
  );

export const getTasks = async (projectId: string, moduleId: string) => {
  const [tasks, states] = await Promise.all([
    call(async () =>
      (await sdk().workItems.listWorkItems({ module: moduleId })) as WorkItem[],
    ),
    getStates(projectId),
  ]);
  const needsIssueTypes = tasks.some(
    (task) => typeof (task as unknown as { issue_type?: unknown }).issue_type === "string",
  );
  const issueTypes = needsIssueTypes ? await getIssueTypes(projectId) : [];

  const stateById = new Map(states.map((state) => [state.id, state]));
  const issueTypeById = new Map(issueTypes.map((issueType) => [issueType.id, issueType]));
  const workItems = tasks.map((task) => {
    const raw = task as unknown as WorkItem & {
      state: string | State | null;
      issue_type: string | IssueType;
    };
    return {
      ...task,
      state:
        typeof raw.state === "string"
          ? stateById.get(raw.state) ?? null
          : raw.state,
      issue_type:
        typeof raw.issue_type === "string"
          ? issueTypeById.get(raw.issue_type)
          : raw.issue_type,
    } as WorkItem;
  });

  return { ...moduleTreeFromWorkItems(moduleId, workItems), states, workItems };
};

export const getProjectWorkItems = (projectId: string): Promise<WorkItem[]> =>
  call(async () =>
    (await sdk().workItems.listWorkItems({
      project: projectId,
      includeArchived: true,
      includePathfind: true,
    })) as WorkItem[]);

export const getTaskDetails = (
  _projectId: string,
  taskId: string,
  signal?: AbortSignal,
) =>
  call(async () => {
    const task = (await sdk().workItems.getWorkItem(
      { issueId: taskId },
      signal ? { signal } : undefined,
    )) as WorkItem;
    return { task: normalizeTask(task) };
  });

export const postTaskStatus = (
  _projectId: string,
  taskId: string,
  stateId: string,
) =>
  call(async () =>
    normalizeTask(
      (await sdk().workItems.updateWorkItem({
        issueId: taskId,
        patchedWorkItemPatch: {
          state_id: stateId,
          origin: OriginEnum.human,
        },
      })) as WorkItem,
    ),
  );

export const updateTaskParent = (
  _projectId: string,
  taskId: string,
  parentId: string | null,
) =>
  call(async () =>
    normalizeTask(
      (await sdk().workItems.updateWorkItem({
        issueId: taskId,
        patchedWorkItemPatch: { parent_id: parentId },
      })) as WorkItem,
    ),
  );

export const createTask = (
  projectId: string,
  name: string,
  parentId: string | null,
  issueTypeId: string,
) =>
  call(async () =>
    normalizeTask(
      (await sdk().workItems.createWorkItem({
        projectId,
        workItemCreate: {
          name,
          parent_id: parentId ?? null,
          issue_type_id: issueTypeId,
        },
      })) as WorkItem,
    ),
  );

export const executeTaskSubtree = (taskId: string) =>
  call(() => sdk().execution.workItemsGraphRunCreate({
    issueId: taskId,
    agentOverride: {},
  }));

export const listIssueTypes = (projectId: string) =>
  call<IssueType[]>(async () =>
    (await sdk().issueTypes.listIssueTypes({ projectId })) as IssueType[]
  );

export const listSubtreeRunCapabilities = (projectId: string) =>
  call<SubtreeRunCapabilityMap>(async () =>
    (await sdk().workflows.listSubtreeRunCapabilities({
      projectId,
    })) as SubtreeRunCapabilityMap
  );

export const createIssueType = (projectId: string, body: IssueTypeCreate) =>
  call<IssueType>(async () =>
    (await sdk().issueTypes.createIssueType({
      projectId,
      issueTypeIn: body,
    })) as IssueType
  );

export const patchIssueType = (id: string, patch: IssueTypePatch) =>
  call<IssueType>(async () =>
    (await sdk().issueTypes.updateIssueType({
      typeId: id,
      issueTypePatch: patch,
    })) as IssueType
  );

export const deleteIssueType = (id: string, reassignTo?: string) =>
  call<void>(() =>
    sdk().issueTypes.deleteIssueType({ typeId: id, reassignTo })
  );

export const reorderIssueTypes = (projectId: string, orderedIds: string[]) =>
  call<IssueType[]>(async () =>
    (await sdk().issueTypes.reorderIssueTypes({
      projectId,
      reorderIn: { ordered_ids: orderedIds },
    })) as IssueType[]
  );

export const createState = (projectId: string, body: StateCreate) =>
  call<State>(async () =>
    (await sdk().states.createState({ projectId, stateIn: body })) as State
  );

export const patchState = (id: string, patch: StatePatch) =>
  call<State>(async () =>
    (await sdk().states.updateState({
      stateId: id,
      statePatch: patch,
    })) as State
  );

export const updateState = (
  stateId: string,
  patch: StatePatch,
): Promise<State> =>
  call(async () =>
    (await sdk().states.updateState({ stateId, patchedState: patch })) as State,
  );

export const getStateImpact = (stateId: string): Promise<StateImpactOut> =>
  call(async () => sdk().states.getStateImpact({ stateId }));

export const deleteState = (
  id: string,
  reassignTo?: string,
  impactToken?: string,
) =>
  call<void>(() => sdk().states.deleteState({
    stateId: id,
    reassignTo,
    impactToken,
  }));

export const reorderStates = (projectId: string, orderedIds: string[]) =>
  call<State[]>(async () =>
    (await sdk().states.reorderStates({
      projectId,
      reorderIn: { ordered_ids: orderedIds },
    })) as State[]
  );

export const reorderWorkflowStates = (
  projectId: string,
  orderedIds: string[],
): Promise<State[]> =>
  call(async () =>
    (await sdk().states.reorderStates({
      projectId,
      configurationReorder: { ordered_ids: orderedIds },
    })) as State[],
  );

export const getIssueTypes = (projectId: string): Promise<IssueType[]> =>
  call(async () =>
    (await sdk().issueTypes.listIssueTypes({ projectId })) as IssueType[],
  );

export const getLaunchProviderCapabilities = (): Promise<ProviderCapabilitiesOut[]> =>
  call(async () => sdk().launchBindings.listLaunchProviderCapabilities());

const issueTypeWorkflowPath = (typeId: string) =>
  `${runtimeConfiguration().endpoints.workTrackerApi}/issue-types/${encodeURIComponent(typeId)}/workflow-settings`;

export const getIssueTypeWorkflowSettings = (
  typeId: string,
): Promise<ScopedWorkflowSettings> => request(issueTypeWorkflowPath(typeId));

export const previewIssueTypeWorkflowImpact = (
  typeId: string,
  operation: ScopedWorkflowImpactOperation,
  workflowRevision: number,
): Promise<ScopedWorkflowImpact> => request(
  `${issueTypeWorkflowPath(typeId)}/impact`,
  {
    method: "POST",
    body: JSON.stringify({
      ...operation,
      workflow_revision: workflowRevision,
    }),
  },
);

export const addIssueTypeWorkflowTransition = (
  typeId: string,
  input: {
    from_state_id: string;
    to_state_id: string;
    agent_allowed: boolean;
    workflow_revision: number;
  },
): Promise<ScopedWorkflowSettings> => request(
  `${issueTypeWorkflowPath(typeId)}/transitions`,
  { method: "POST", body: JSON.stringify(input) },
);

export const removeIssueTypeWorkflowTransition = (
  typeId: string,
  fromStateId: string,
  toStateId: string,
  workflowRevision: number,
): Promise<ScopedWorkflowSettings> => request(
  `${issueTypeWorkflowPath(typeId)}/transitions/${encodeURIComponent(fromStateId)}/${encodeURIComponent(toStateId)}`,
  {
    method: "DELETE",
    body: JSON.stringify({ workflow_revision: workflowRevision }),
  },
);

export const removeIssueTypeWorkflowState = (
  typeId: string,
  stateId: string,
  workflowRevision: number,
): Promise<ScopedWorkflowSettings> => request(
  `${issueTypeWorkflowPath(typeId)}/states/${encodeURIComponent(stateId)}`,
  {
    method: "DELETE",
    body: JSON.stringify({ workflow_revision: workflowRevision }),
  },
);

export const setIssueTypeWorkflowTransitionPermission = (
  typeId: string,
  fromStateId: string,
  toStateId: string,
  agentAllowed: boolean,
  workflowRevision: number,
): Promise<ScopedWorkflowSettings> => request(
  `${issueTypeWorkflowPath(typeId)}/transitions/${encodeURIComponent(fromStateId)}/${encodeURIComponent(toStateId)}`,
  {
    method: "PATCH",
    body: JSON.stringify({
      agent_allowed: agentAllowed,
      workflow_revision: workflowRevision,
    }),
  },
);

export const setIssueTypeWorkflowStartState = (
  typeId: string,
  stateId: string,
  workflowRevision: number,
): Promise<ScopedWorkflowSettings> => request(
  `${issueTypeWorkflowPath(typeId)}/start-state`,
  {
    method: "PUT",
    body: JSON.stringify({
      state_id: stateId,
      workflow_revision: workflowRevision,
    }),
  },
);

export const upsertIssueTypeWorkflowLaunchBinding = (
  typeId: string,
  stateId: string,
  binding: LaunchBindingInput,
  workflowRevision: number,
): Promise<ScopedWorkflowSettings> => request(
  `${issueTypeWorkflowPath(typeId)}/launch-bindings/${encodeURIComponent(stateId)}`,
  {
    method: "PUT",
    body: JSON.stringify({
      ...binding,
      workflow_revision: workflowRevision,
    }),
  },
);

export const setIssueTypeWorkflowAutoStart = (
  typeId: string,
  stateId: string,
  autoStart: boolean,
  workflowRevision: number,
): Promise<ScopedWorkflowSettings> => request(
  `${issueTypeWorkflowPath(typeId)}/launch-bindings/${encodeURIComponent(stateId)}/auto-start`,
  {
    method: "PATCH",
    body: JSON.stringify({
      auto_start: autoStart,
      workflow_revision: workflowRevision,
    }),
  },
);

export const setIssueTypeWorkflowSubtreeRun = (
  typeId: string,
  stateId: string,
  enabled: boolean,
  workflowRevision: number,
): Promise<ScopedWorkflowSettings> => request(
  `${issueTypeWorkflowPath(typeId)}/launch-bindings/${encodeURIComponent(stateId)}/subtree-run`,
  {
    method: "PUT",
    body: JSON.stringify({
      enabled,
      workflow_revision: workflowRevision,
    }),
  },
);

export const getKeybindingOverrides = () =>
  call(() => sdk().settings.settingsKeybindingsRetrieve());

export const putKeybindingOverrides = (value: unknown) =>
  call(() => sdk().settings.settingsKeybindingsUpdate({
    settingValue: { value },
  }));

export const getProviderCatalog = () =>
  call(() => sdk().settings.settingsProviderCatalogRetrieve()) as Promise<{
    value: ProviderCatalog;
  }>;

export const putProviderCatalog = (value: ProviderCatalog) =>
  call(() => sdk().settings.settingsProviderCatalogUpdate({
    providerCatalogEnvelope: { value } as never,
  })) as Promise<{
    value: ProviderCatalog;
    blocked_launch_bindings: number;
  }>;

export const saveDocument = (
  docId: string,
  body: { content: string; digest: string },
) =>
  call(() => sdk().documents.docsUpdate({
    docId,
    saveDocument: body,
  })) as Promise<{ digest: string }>;
