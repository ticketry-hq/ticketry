import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import type {
  ProviderCapabilitiesOut,
  StateImpactOut,
} from "@worktracker/typescript-sdk/models";
import { OriginEnum } from "@worktracker/typescript-sdk/models";
import { ApiError } from "../../../shared/api/client";
export { documentUrl as docUrl } from "../../../shared/api/documentUrl";
import type {
  IssueType,
  Module,
  Project,
  ProjectCreate,
  ScopedWorkflowSettings,
  ScopedWorkflowImpact,
  ScopedWorkflowImpactOperation,
  ProviderCatalog,
  State,
  StatePatch,
  LaunchBindingInput,
  WorkItem,
} from "../../../shared/api/types";
import { agentApiUrl, runtimeConfiguration } from "../../../runtime";
import type {
  ConfigPayload,
  ModuleSummary,
  Profile,
  ProjectSummary,
  TaskState,
  TaskSummary,
} from "./types";

export { ApiError } from "../../../shared/api/client";

async function request<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const key = studioApiKey();
  const resp = await fetch(agentApiUrl(path), {
    ...init,
    headers: {
      Accept: "application/json",
      ...(key ? { "x-api-key": key } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  let body: unknown = null;
  const text = await resp.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!resp.ok) {
    const msg =
      (body && typeof body === "object" && "message" in (body as object)
        ? String((body as { message?: string }).message)
        : `HTTP ${resp.status}`);
    throw new ApiError(resp.status, msg, body);
  }
  return body as T;
}

function studioApiKey(): string | undefined {
  return runtimeConfiguration().values.workTrackerApiKey || undefined;
}

// ---------- WorkTracker SDK client (the /api/work-tracker/* surface) ----------
// The studio surface owns its own SDK client (it does not reuse Studio's
// module-level sdk(), which authenticates from a static env key). A custom
// fetch wrapper injects the runtime key through the SDK's documented `fetch`
// extension point, preserving header injection without profile-owned secrets.
const worktrackerFetch: typeof fetch = async (input, init) => {
  const key = studioApiKey();
  const headers = new Headers(init?.headers);
  if (key) headers.set("x-api-key", key);
  return fetch(input, { ...init, headers });
};

function worktrackerClient() {
  return createWorkTrackerClient({
    baseUrl: runtimeConfiguration().endpoints.workTrackerApi,
    fetch: worktrackerFetch,
  });
}

// Map the SDK's WorkTrackerApiError back onto the studio-local ApiError so call
// sites that read .status / .body are unchanged. AbortError passes through (the
// SDK's onError re-throws it), so abortable call sites keep cancelling.
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

// ---------- Boundary adapters (SDK contract shapes → studio summaries) ----------
// The single translation layer between the SDK's contract types and the
// studio surface's narrower shapes.
function normalizeProject(project: Project): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    identifier: project.slug,
  };
}

function normalizeModule(module: Module): ModuleSummary {
  return {
    id: module.id,
    name: module.name,
    project_id: module.project_id,
  };
}

export function normalizeTask(task: WorkItem): TaskSummary {
  return {
    id: task.id,
    name: task.name,
    project_id: task.project_id,
    sequence_id: task.sequence_id,
    key: task.key,
    rank: task.rank,
    state:
      task.state ?? {
        id: null,
        name: "No state",
        group: "",
        color: null,
      },
    issue_type: task.issue_type,
    description: task.description,
    parent_id: task.parent_id,
    sub_issues_count: task.sub_issues_count,
    state_revision: task.state_revision,
    updated_at: task.updated_at,
  };
}

export const reorderTask = (
  taskId: string,
  beforeId: string | null,
  afterId: string | null,
) =>
  call<TaskSummary>(async () =>
    normalizeTask(
      (await worktrackerClient().workItems.reorderWorkItem({
        issueId: taskId,
        workItemReorder: {
          before_id: beforeId,
          after_id: afterId,
        },
      })) as WorkItem,
    ),
  );

function normalizeModuleTaskTree(moduleId: string, tasks: WorkItem[]) {
  const roots: TaskSummary[] = [];
  const subtasks: Record<string, TaskSummary[]> = {};

  for (const task of tasks) {
    const normalized = normalizeTask(task);
    if (task.parent_id === moduleId) {
      roots.push(normalized);
      continue;
    }
    if (task.parent_id) {
      (subtasks[task.parent_id] ??= []).push(normalized);
    }
  }

  return { tasks: roots, subtasks };
}

// ---------- Config (generated host operations) ----------
export const getConfig = () =>
  call(() => worktrackerClient().configuration.configRetrieve()) as Promise<ConfigPayload>;

export const postProfile = (body: Partial<Profile>) =>
  call(() => worktrackerClient().configuration.configProfilesCreate({ profile: body as never })) as Promise<ConfigPayload>;

export const putProfile = (index: number, body: Partial<Profile>) =>
  call(() => worktrackerClient().configuration.configProfilesUpdate({ index, profile: body as never })) as Promise<ConfigPayload>;

export const deleteProfile = (index: number) =>
  call(() => worktrackerClient().configuration.configProfilesDestroy({ index })) as Promise<ConfigPayload>;

export const patchConfig = (body: { recent_profile_index: number }) =>
  call(() => worktrackerClient().configuration.configPartialUpdate({ patchedRecentIndex: body })) as Promise<ConfigPayload>;

// ---------- Work tracker (SDK-covered, contract-checked) ----------
// Project and module LISTS come from the shared caches in features/projects;
// only the writes that Studio's own flows perform live here.
export const createProject = (body: ProjectCreate) =>
  call(async () =>
    normalizeProject(
      (await worktrackerClient().projects.createProject({
        project: body,
      })) as Project,
    ),
  );

// Most-recent agent interaction per module (#598). Hits the server's runs
// endpoint (not the work tracker). Failure resolves to {} so the module list
// still renders, just in its original order — no regression on error.
export const getModuleActivity = (
  projectId: string,
): Promise<Record<string, string>> =>
  call(() => worktrackerClient().runs.runsModuleActivityRetrieve({ projectId }))
    .then((value) => value as Record<string, string>)
    .catch(() => ({}));

export const createModule = (
  projectId: string,
  name: string,
  issueTypeId: string,
) =>
  call(async () =>
    normalizeModule(
      (await worktrackerClient().modules.createModule({
        projectId,
        moduleCreate: { name, issue_type_id: issueTypeId },
      })) as Module,
    ),
  );

export const getTasks = async (projectId: string, moduleId: string) => {
  const [tasks, states] = await Promise.all([
    call(async () =>
      (await worktrackerClient().workItems.listWorkItems({ module: moduleId })) as WorkItem[],
    ),
    getStates(projectId),
  ]);

  // Keep the raw module response alongside the legacy presentation tree. The
  // work-item store hydrates this exact collection during the expand phase.
  return { ...normalizeModuleTaskTree(moduleId, tasks), states, workItems: tasks };
};

export const getProjectWorkItems = (projectId: string): Promise<WorkItem[]> =>
  call(async () =>
    (await worktrackerClient().workItems.listWorkItems({
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
    const detail = (await worktrackerClient().workItems.getWorkItem(
      { issueId: taskId },
      signal ? { signal } : undefined,
    )) as { task: WorkItem };
    return { task: normalizeTask(detail.task) };
  });

export const getStates = (projectId: string): Promise<TaskState[]> =>
  call(async () =>
    (await worktrackerClient().states.listStates({ projectId })) as State[]);

export const createState = (
  projectId: string,
  body: { name: string; group: string },
): Promise<TaskState> =>
  call(async () =>
    (await worktrackerClient().states.createState({ projectId, state: body })) as State,
  );

export const updateState = (
  stateId: string,
  patch: StatePatch,
): Promise<TaskState> =>
  call(async () =>
    (await worktrackerClient().states.updateState({ stateId, patchedState: patch })) as State,
  );

export const getStateImpact = (stateId: string): Promise<StateImpactOut> =>
  call(async () => worktrackerClient().states.getStateImpact({ stateId }));

export const deleteState = (
  stateId: string,
  reassignTo?: string,
  impactToken?: string,
): Promise<void> =>
  call(async () =>
    worktrackerClient().states.deleteState({ stateId, reassignTo, impactToken }));

export const reorderWorkflowStates = (
  projectId: string,
  orderedIds: string[],
): Promise<TaskState[]> =>
  call(async () =>
    (await worktrackerClient().states.reorderStates({
      projectId,
      configurationReorder: { ordered_ids: orderedIds },
    })) as State[],
  );

export const getIssueTypes = (projectId: string): Promise<IssueType[]> =>
  call(async () =>
    (await worktrackerClient().issueTypes.listIssueTypes({ projectId })) as IssueType[],
  );

export const getLaunchProviderCapabilities = (): Promise<ProviderCapabilitiesOut[]> =>
  call(async () =>
    worktrackerClient().launchBindings.listLaunchProviderCapabilities());

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

export const postTaskStatus = (
  _projectId: string,
  taskId: string,
  stateId: string,
) =>
  call(async () =>
    normalizeTask(
      (await worktrackerClient().workItems.updateWorkItem({
        issueId: taskId,
        patchedWorkItemPatch: {
          state_id: stateId,
          origin: OriginEnum.human,
        },
      })) as WorkItem,
    ),
  );

// Reparent a work item (set/clear its parent). Reuses the same PATCH
// /work-items/{id} endpoint the status update uses; `parent_id` may be a task
// id, a module id, or null to detach.
export const updateTaskParent = (
  _projectId: string,
  taskId: string,
  parentId: string | null,
) =>
  call(async () =>
    normalizeTask(
      (await worktrackerClient().workItems.updateWorkItem({
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
      (await worktrackerClient().workItems.createWorkItem({
        projectId,
        workItemCreate: {
          name,
          parent_id: parentId ?? null,
          issue_type_id: issueTypeId,
        },
      })) as WorkItem,
    ),
  );

// An empty override deliberately leaves provider selection to the current
// workflow launch binding.
export const executeTaskSubtree = (taskId: string) =>
  call(() => worktrackerClient().execution.workItemsGraphRunCreate({
    issueId: taskId,
    agentOverride: {},
  }));

// Worktrees (ticket #589) live in features/agents/worktrees.

// ---------- Settings (generated host operations) ----------
export const getKeybindingOverrides = () =>
  call(() => worktrackerClient().settings.settingsKeybindingsRetrieve());

export const putKeybindingOverrides = (value: unknown) =>
  call(() => worktrackerClient().settings.settingsKeybindingsUpdate({ settingValue: { value } }));

// Typed host provider catalog: the schema is validated server-side, so the
// client sends the whole value and lets a rejection surface as an ApiError.
export const getProviderCatalog = () =>
  call(() => worktrackerClient().settings.settingsProviderCatalogRetrieve()) as Promise<{ value: ProviderCatalog }>;

export const putProviderCatalog = (value: ProviderCatalog) =>
  call(() => worktrackerClient().settings.settingsProviderCatalogUpdate({
    providerCatalogEnvelope: { value } as never,
  })) as Promise<{ value: ProviderCatalog; blocked_launch_bindings: number }>;

// ---------- Documents (ticket #521; generated host operations) ----------
// Builds the URL for a registered design document. Path-style so the doc's
// directory levels are mirrored in the URL and its relative assets resolve
// under the same prefix; used as an iframe `src` in a sandboxed opaque origin.
export const saveDocument = (
  docId: string,
  body: { content: string; digest: string },
) =>
  call(() => worktrackerClient().documents.docsUpdate({
    docId,
    saveDocument: body,
  })) as Promise<{ digest: string }>;
