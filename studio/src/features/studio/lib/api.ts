import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import type {
  ProviderCapabilitiesOut,
  StateImpactOut,
} from "@worktracker/typescript-sdk/models";
import { WorkItemPatchOriginEnum } from "@worktracker/typescript-sdk/models";
import { ApiError } from "../../../shared/api/client";
import { cachedFetch, dedupeInFlight } from "../../../shared/api/dedupe";
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
  DesignDoc,
  ModuleSummary,
  PersistedTerminalSession,
  ResumableTerminalSession,
  Profile,
  ProjectSummary,
  RunningAgentCountsPayload,
  TaskState,
  TaskSummary,
} from "./types";

export { ApiError } from "../../../shared/api/client";

async function request<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const key = await studioApiKey();
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

async function studioApiKey(): Promise<string | undefined> {
  const { useConfigStore } = await import("../stores/configStore");
  const { profiles, recentProfileIndex } = useConfigStore.getState();
  const profile =
    recentProfileIndex === null ? null : profiles[recentProfileIndex] ?? null;
  return profile?.api_key || runtimeConfiguration().values.workTrackerApiKey || undefined;
}

// ---------- WorkTracker SDK client (the /api/work-tracker/* surface) ----------
// The studio surface owns its own SDK client (it does not reuse Studio's
// module-level sdk(), which authenticates from a static env key). The key here
// is resolved from the active profile, then the runtime when no profile key is
// available. A custom fetch wrapper injects it on every request — the same auth
// logic the old worktrackerRequest carried, just relocated to the SDK's
// documented `fetch` extension point. The singleton tracks the active profile
// with no rebuild on profile switch.
const worktrackerFetch: typeof fetch = async (input, init) => {
  const key = await studioApiKey();
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
    issue_type: task.issue_type ?? null,
    assignees: task.assignees.map((a) => ({
      display_name: a.display_name ?? null,
      email: a.email ?? null,
    })),
    labels: task.labels.map((l) => ({ name: l.name })),
    description_html: task.description_html,
    description_stripped: task.description_stripped,
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
        workItemReorderIn: {
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

// ---------- Config ----------
// gated: CODIN-668 — host /api/config surface is not in the OpenAPI the SDK is
// generated from; stays on raw fetch until host-surface SDK coverage is taken up.
// Coalesced with the agents config store's identical bootstrap GET so the
// two stores share one round trip (the key is shared across both API layers).
export const getConfig = () =>
  dedupeInFlight("GET /api/config", () => request<ConfigPayload>("/api/config"));

export const postProfile = (body: Partial<Profile> & { api_key: string }) =>
  request<ConfigPayload>("/api/config/profiles", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const putProfile = (index: number, body: Partial<Profile> & { api_key: string }) =>
  request<ConfigPayload>(`/api/config/profiles/${index}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const deleteProfile = (index: number) =>
  request<ConfigPayload>(`/api/config/profiles/${index}`, { method: "DELETE" });

export const patchConfig = (body: { recent_profile_index: number }) =>
  request<ConfigPayload>("/api/config", {
    method: "PATCH",
    body: JSON.stringify(body),
  });

// ---------- Work tracker (SDK-covered, contract-checked) ----------
export const getProjects = () =>
  call(async () =>
    ((await worktrackerClient().projects.listProjects()) as Project[]).map(normalizeProject),
  );

export const createProject = (body: ProjectCreate) =>
  call(async () =>
    normalizeProject(
      (await worktrackerClient().projects.createProject({
        projectIn: body,
      })) as Project,
    ),
  );

export const getModules = (projectId: string) =>
  call(async () =>
    ((await worktrackerClient().modules.listModules({ projectId })) as Module[]).map(
      normalizeModule,
    ),
  );

// Most-recent agent interaction per module (#598). Hits the server's runs
// endpoint (not the work tracker). Failure resolves to {} so the module list
// still renders, just in its original order — no regression on error.
// gated: CODIN-668 — /api/runs is a host family, not in the SDK's OpenAPI.
export const getModuleActivity = (
  projectId: string,
): Promise<Record<string, string>> =>
  request<Record<string, string>>(
    `/api/runs/module-activity?project_id=${encodeURIComponent(projectId)}`,
  ).catch(() => ({}));

export const createModule = (projectId: string, name: string) =>
  call(async () =>
    normalizeModule(
      (await worktrackerClient().modules.createModule({
        projectId,
        moduleIn: { name },
      })) as Module,
    ),
  );

export const getTasks = async (projectId: string, moduleId: string) => {
  const [tasks, states] = await Promise.all([
    call(async () =>
      (await worktrackerClient().workItems.listModuleWorkItems({ moduleId })) as WorkItem[],
    ),
    getStates(projectId),
  ]);

  return { ...normalizeModuleTaskTree(moduleId, tasks), states };
};

export const getProjectWorkItems = (projectId: string): Promise<WorkItem[]> =>
  call(async () =>
    (await worktrackerClient().workItems.listProjectWorkItems({
      projectId,
      includeArchived: true,
      includePathfind: true,
    })) as WorkItem[]);

export const getSubtasks = (projectId: string, taskId: string) =>
  call(async () =>
    ((await worktrackerClient().workItems.listProjectWorkItems({
      projectId,
      parent: taskId,
    })) as WorkItem[]).map(normalizeTask),
  );

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
    (await worktrackerClient().states.createState({ projectId, stateIn: body })) as State,
  );

export const updateState = (
  stateId: string,
  patch: StatePatch,
): Promise<TaskState> =>
  call(async () =>
    (await worktrackerClient().states.updateState({ stateId, statePatch: patch })) as State,
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
      reorderIn: { ordered_ids: orderedIds },
    })) as State[],
  );

// Catalog data refetched as a serial prerequisite of every story creation;
// a short TTL keeps that off the critical path without risking long-lived
// staleness after workflow edits.
export const getIssueTypes = (projectId: string): Promise<IssueType[]> =>
  cachedFetch(`issue-types:${projectId}`, 60_000, () =>
    call(async () =>
      (await worktrackerClient().issueTypes.listIssueTypes({ projectId })) as IssueType[],
    ),
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
  forceIfCompleted = false,
) =>
  call(async () =>
    normalizeTask(
      (await worktrackerClient().workItems.updateWorkItem({
        issueId: taskId,
        workItemPatch: forceIfCompleted
          ? {
              state_id: stateId,
              origin: WorkItemPatchOriginEnum.human,
              force_if_completed: true,
            }
          : { state_id: stateId, origin: WorkItemPatchOriginEnum.human },
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
        workItemPatch: { parent_id: parentId },
      })) as WorkItem,
    ),
  );

export const createTask = (
  projectId: string,
  name: string,
  parentId?: string | null,
  issueTypeId?: string | null,
) =>
  call(async () =>
    normalizeTask(
      (await worktrackerClient().workItems.createProjectWorkItem({
        projectId,
        workItemIn: {
          name,
          parent_id: parentId ?? null,
          issue_type_id: issueTypeId ?? null,
        },
      })) as WorkItem,
    ),
  );

// The execution service is a Studio-host endpoint rather than part of the
// WorkTracker OpenAPI surface. An empty body deliberately leaves provider
// selection to the current workflow launch bindings.
export const executeTaskSubtree = (taskId: string) =>
  request<unknown>(
    `/api/work-items/${encodeURIComponent(taskId)}/execute-graph`,
    { method: "POST", body: JSON.stringify({}) },
  );

// Worktrees (ticket #589) live in features/agents/worktrees.

// ---------- Settings ----------
// gated: CODIN-668 — host /api/settings surface is not in the SDK's OpenAPI.
export const getPanelWidths = () =>
  request<{ value: unknown }>("/api/settings/panel_widths");

export const putPanelWidths = (value: number[]) =>
  request<{ value: unknown }>("/api/settings/panel_widths", {
    method: "PUT",
    body: JSON.stringify({ value }),
  });

// Per-module expanded sub-task ids, scoped so modules never share a set.
export const getExpandedSubtasks = (moduleId: string) =>
  request<{ value: unknown }>(
    `/api/settings/expanded_subtasks?module_id=${encodeURIComponent(moduleId)}`,
  );

export const putExpandedSubtasks = (moduleId: string, value: string[]) =>
  request<{ value: unknown }>(
    `/api/settings/expanded_subtasks?module_id=${encodeURIComponent(moduleId)}`,
    {
      method: "PUT",
      body: JSON.stringify({ value }),
    },
  );

export const getKeybindingOverrides = () =>
  request<{ value: unknown }>("/api/settings/keybindings");

export const putKeybindingOverrides = (value: unknown) =>
  request<{ value: unknown }>("/api/settings/keybindings", {
    method: "PUT",
    body: JSON.stringify({ value }),
  });

// Typed host provider catalog: the schema is validated server-side, so the
// client sends the whole value and lets a rejection surface as an ApiError.
export const getProviderCatalog = () =>
  request<{ value: ProviderCatalog }>("/api/settings/provider-catalog");

export const putProviderCatalog = (value: ProviderCatalog) =>
  request<{ value: ProviderCatalog; blocked_launch_bindings: number }>(
    "/api/settings/provider-catalog",
    { method: "PUT", body: JSON.stringify({ value }) },
  );

/** How many launch bindings a candidate activation set would block, unsaved. */
export const previewProviderCatalogImpact = (value: ProviderCatalog) =>
  request<{ blocked_launch_bindings: number }>(
    "/api/settings/provider-catalog/impact",
    { method: "POST", body: JSON.stringify({ value }) },
  );

// ---------- Persisted terminal sessions ----------
// gated: CODIN-668 — host /api/terminals surface is not in the SDK's OpenAPI.
export const getTerminals = (taskId: string) =>
  request<PersistedTerminalSession[]>(
    `/api/terminals?task_id=${encodeURIComponent(taskId)}`,
  );

export const listResumableTerminals = (taskId: string) =>
  request<ResumableTerminalSession[]>(
    `/api/terminals/resumable?task_id=${encodeURIComponent(taskId)}`,
  );

// Active no-task (plan/instant) sessions for a project. A module narrows the
// list when opening one scratch workspace; omitting it hydrates Backlog badges.
export const getScratchTerminals = (projectId: string, moduleId?: string) =>
  request<PersistedTerminalSession[]>(
    `/api/terminals/scratch?project_id=${encodeURIComponent(projectId)}${moduleId ? `&module_id=${encodeURIComponent(moduleId)}` : ""}`,
  );

export const getRunningAgentCounts = (projectId: string, moduleId: string) =>
  request<RunningAgentCountsPayload>(
    `/api/terminals/running-counts?project_id=${encodeURIComponent(projectId)}&module_id=${encodeURIComponent(moduleId)}`,
  );

export const terminateTerminal = (agentRunId: string) =>
  request<{ agent_run_id: string; terminated: boolean }>(
    `/api/terminals/?agent_run_id=${encodeURIComponent(agentRunId)}`,
    { method: "DELETE" },
  );

export const resumeTerminal = (agentRunId: string) =>
  request<{ agent_run_id: string; resumed_from: string }>(
    `/api/terminals/resume?agent_run_id=${encodeURIComponent(agentRunId)}`,
    { method: "POST" },
  );

// ---------- Documents (ticket #521) ----------
// gated: CODIN-668 — host /api/docs · /api/documents · /api/fs surfaces are not
// in the SDK's OpenAPI.
// Builds the URL for a registered design document. Path-style so the doc's
// directory levels are mirrored in the URL and its relative assets resolve
// under the same prefix; used as an iframe `src` in a sandboxed opaque origin.
// Registered documents for a task workspace, rescanned server-side on read.
export const getDocuments = (
  taskId: string,
  projectId?: string,
  moduleId?: string,
) => {
  const params = new URLSearchParams({ task_id: taskId });
  if (projectId) params.set("project_id", projectId);
  if (moduleId) params.set("module_id", moduleId);
  return request<{ documents: DesignDoc[] }>(`/api/documents?${params}`);
};

// Registered documents for the scratch (plan/instant) bucket of a module.
export const getScratchDocuments = (moduleId: string) =>
  request<{ documents: DesignDoc[] }>(
    `/api/documents?scope=scratch&module_id=${encodeURIComponent(moduleId)}`,
  );

export const saveDocument = (
  docId: string,
  body: { content: string; digest: string },
) =>
  request<{ digest: string }>(`/api/docs/${encodeURIComponent(docId)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const fsComplete = (path: string, signal?: AbortSignal) =>
  request<{ entries: string[] }>(
    `/api/fs/complete?path=${encodeURIComponent(path)}`,
    { signal },
  );
