import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import { OriginEnum } from "@worktracker/typescript-sdk/models";
import type {
  IssueType,
  IssueTypeCreate,
  IssueTypePatch,
  Module,
  Project,
  ProjectCreate,
  ProjectPatch,
  ConfigurableProvider,
  State,
  StateCreate,
  StatePatch,
  LaunchBindingInput,
  ProviderCatalog,
  ProviderCapabilities,
  ScopedWorkflowSettings,
  SubtreeRunCapabilityMap,
  WorkItem,
  Attachment,
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
// ("A Story cannot move 'Ideas' → 'Done'."), not a bare "422". Falls back to the
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
  call<Workspace>(async () => (await sdk().workspace.retrieveWorkspace()) as Workspace);

export const acknowledgeOnboarding = () =>
  call<Workspace>(async () =>
    (await sdk().workspace.acknowledgeWorkspaceOnboarding()) as Workspace
  );

export const createProject = (body: ProjectCreate) =>
  call<Project>(async () =>
    (await sdk().projects.createProject({ project: body })) as Project
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
      patchedProject: patch,
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
      moduleCreate: { name, issue_type_id: issueTypeId },
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
    ((await sdk().workItems.listWorkItems({
      project: projectId,
      state: filters?.state,
    })) as unknown as WorkItem[]).filter(
      (item) => filters?.parent === undefined || item.parent_id === filters.parent,
    )
  );

/** Read the canonical work-item collection narrowed to the requested ids. */
export const listWorkItemsByIds = (ids: readonly string[]) =>
  call<WorkItem[]>(async () =>
    (await sdk().workItems.batchWorkItems({
      workItemBatch: { ids: [...ids] },
    })) as unknown as WorkItem[],
  );

export const getWorkItem = (keyOrId: string, signal?: AbortSignal) =>
  call<WorkItemDetail>(async () => {
    const client = sdk();
    const options = signal ? { signal } : undefined;
    const [task, attachments] = await Promise.all([
      client.workItems.getWorkItem({ issueId: keyOrId }, options),
      client.attachments.listWorkItemAttachments({ issueId: keyOrId }, options),
    ]);
    return {
      task: task as unknown as WorkItem,
      attachments: attachments as unknown as Attachment[],
    };
  });

export const getWorkItemAttachments = (
  keyOrId: string,
  signal?: AbortSignal,
) =>
  call<Attachment[]>(async () =>
    (await sdk().attachments.listWorkItemAttachments(
      { issueId: keyOrId },
      signal ? { signal } : undefined,
    )) as unknown as Attachment[],
  );

export const createWorkItem = (projectId: string, body: WorkItemCreate) =>
  call<WorkItem>(async () =>
    (await sdk().workItems.createWorkItem({
      projectId,
      workItemCreate: body,
    })) as unknown as WorkItem
  );

export const patchWorkItem = (id: string, patch: WorkItemPatch) => {
  const studioPatch = "state_id" in patch
    ? { ...patch, origin: OriginEnum.human }
    : patch;
  return call<WorkItem>(async () =>
    (await sdk().workItems.updateWorkItem({
      issueId: id,
      patchedWorkItemPatch: studioPatch,
    })) as unknown as WorkItem
  );
};

export const deleteWorkItem = (id: string) =>
  call<void>(() => sdk().workItems.deleteWorkItem({ issueId: id }));

export const reorderWorkItem = (
  id: string,
  neighbors: {
    before_id: string | null;
    after_id: string | null;
    // A module's first drag only: the complete order the user could see, which
    // the server freezes into ranks before applying the move (#360).
    initial_order_ids?: string[] | null;
  },
) =>
  call<WorkItem>(async () =>
    (await sdk().workItems.reorderWorkItem({
      issueId: id,
      workItemReorder: neighbors,
    })) as unknown as WorkItem
  );

export const getTasks = async (projectId: string, moduleId: string) => {
  const [tasks, states] = await Promise.all([
    call(async () =>
      (await sdk().workItems.listWorkItems({ module: moduleId })) as unknown as WorkItem[],
    ),
    getStates(projectId),
  ]);
  return { ...moduleTreeFromWorkItems(moduleId, tasks), states, workItems: tasks };
};

export const getProjectWorkItems = (projectId: string): Promise<WorkItem[]> =>
  call(async () =>
    (await sdk().workItems.listWorkItems({
      project: projectId,
    })) as unknown as WorkItem[]);

export const createTask = (
  projectId: string,
  name: string,
  parentId: string | null,
  issueTypeId: string,
) =>
  call<WorkItem>(async () =>
      (await sdk().workItems.createWorkItem({
        projectId,
        workItemCreate: {
          name,
          parent_id: parentId ?? null,
          issue_type_id: issueTypeId,
        },
      })) as unknown as WorkItem,
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
  call<SubtreeRunCapabilityMap>(async () => {
    const bindings = await sdk().launchBindings.listLaunchBindings({ projectId });
    const result: SubtreeRunCapabilityMap = {};
    for (const binding of bindings) {
      if (!binding.subtree_run_enabled) continue;
      result[binding.issue_type] = [
        ...(result[binding.issue_type] ?? []),
        binding.state,
      ];
    }
    return result;
  });

export const createIssueType = (projectId: string, body: IssueTypeCreate) =>
  call<IssueType>(async () =>
    (await sdk().issueTypes.createIssueType({
      projectId,
      issueType: body as never,
    })) as IssueType
  );

export const patchIssueType = (id: string, patch: IssueTypePatch) =>
  call<IssueType>(async () =>
    (await sdk().issueTypes.updateIssueType({
      typeId: id,
      patchedIssueType: patch as never,
    })) as IssueType
  );

export const deleteIssueType = (id: string, reassignTo?: string) =>
  call<void>(() =>
    sdk().issueTypes.deleteIssueType({
      typeId: id,
      issueTypeDelete: reassignTo ? { reassign_to: reassignTo } : undefined,
    })
  );

export const reorderIssueTypes = (projectId: string, orderedIds: string[]) =>
  call<IssueType[]>(async () =>
    (await sdk().issueTypes.reorderIssueTypes({
      projectId,
      configurationReorder: { ordered_ids: orderedIds },
    })) as IssueType[]
  );

export const createState = (projectId: string, body: StateCreate) =>
  call<State>(async () =>
    (await sdk().states.createState({ projectId, state: body as never })) as State
  );

export const patchState = (id: string, patch: StatePatch) =>
  call<State>(async () =>
    (await sdk().states.updateState({
      stateId: id,
      patchedState: patch as never,
    })) as State
  );

export const updateState = (
  stateId: string,
  patch: StatePatch,
): Promise<State> =>
  call(async () =>
    (await sdk().states.updateState({ stateId, patchedState: patch as never })) as State,
  );

export const deleteState = (
  id: string,
  reassignTo?: string,
  impactToken?: string,
) =>
  call<void>(() => {
    void reassignTo;
    void impactToken;
    return sdk().states.deleteState({ stateId: id });
  });

export const reorderStates = (projectId: string, orderedIds: string[]) =>
  call<State[]>(async () =>
    (await sdk().states.reorderStates({
      projectId,
      configurationReorder: { ordered_ids: orderedIds },
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

export const getLaunchProviderCapabilities = (): Promise<ProviderCapabilities[]> =>
  call(async () => {
    const [providers, models, reasoningLevels] = await Promise.all([
      sdk().providers.listProviders(),
      sdk().models.listAgentModels(),
      sdk().reasoningLevels.listReasoningLevels(),
    ]);
    const reasoningNames = new Map(
      reasoningLevels.map((level) => [level.id, level.name]),
    );
    return providers.filter((provider) => provider.activated).map((provider) => {
      const providerModels = models.filter(
        (model) => model.provider === provider.id || model.provider === provider.slug,
      );
      return {
        agent: provider.slug,
        accepts_model: true,
        accepts_any_model: false,
        model_aliases: providerModels.map((model) => model.name),
        model_prefixes: [],
        reasoning_levels: [...new Set(
          providerModels.flatMap((model) =>
            (model.permitted_reasoning_levels ?? []).map(
              (level) => reasoningNames.get(level) ?? level,
            )),
        )],
        supports_unattended: provider.supports_unattended,
      };
    });
  });

const issueTypePath = (typeId: string) =>
  `${runtimeConfiguration().endpoints.workTrackerApi}/issue-types/${encodeURIComponent(typeId)}`;

const issueTypeTransitionPath = (typeId: string) =>
  `${issueTypePath(typeId)}/transitions`;

const issueTypeWorkflowPath = (typeId: string) =>
  `${issueTypePath(typeId)}/workflow-settings`;

interface WorkflowCatalogProvider {
  id: string;
  slug: string;
  activated?: boolean;
}

interface WorkflowCatalogModel {
  id: string;
  provider: string;
  name: string;
}

interface WorkflowCatalogReasoning {
  id: string;
  name: string;
}

interface CanonicalWorkflowTransition {
  from_state: string;
  to_state: string;
  agent_allowed?: boolean;
}

interface CanonicalLaunchBinding {
  issue_type: string;
  state: string;
  prompt?: string;
  required_skills?: unknown;
  model?: string | null;
  reasoning?: string | null;
  auto_start?: boolean;
  subtree_run_enabled?: boolean;
}

const reachableStateIds = (
  startStateId: string | null,
  transitions: readonly ScopedWorkflowSettings["transitions"][number][],
): Set<string> => {
  if (!startStateId) return new Set();
  const outgoing = new Map<string, string[]>();
  for (const transition of transitions) {
    outgoing.set(transition.from_state_id, [
      ...(outgoing.get(transition.from_state_id) ?? []),
      transition.to_state_id,
    ]);
  }
  const reachable = new Set([startStateId]);
  const queue = [startStateId];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const target of outgoing.get(current) ?? []) {
      if (reachable.has(target)) continue;
      reachable.add(target);
      queue.push(target);
    }
  }
  return reachable;
};

function assembleScopedWorkflowSettings(
  issueType: IssueType,
  states: State[],
  transitions: CanonicalWorkflowTransition[],
  bindings: CanonicalLaunchBinding[],
  providers: WorkflowCatalogProvider[],
  models: WorkflowCatalogModel[],
  reasoningLevels: WorkflowCatalogReasoning[],
  hasGlobalDefault: boolean,
): ScopedWorkflowSettings {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const modelById = new Map(models.map((model) => [model.id, model]));
  const reasoningById = new Map(
    reasoningLevels.map((reasoning) => [reasoning.id, reasoning]),
  );
  const scopedTransitions = transitions.map((transition) => ({
    from_state_id: transition.from_state,
    to_state_id: transition.to_state,
    agent_allowed: transition.agent_allowed ?? true,
  }));
  const scopedBindings = bindings
    .filter((binding) => binding.issue_type === issueType.id)
    .map((binding) => {
      const model = binding.model ? modelById.get(binding.model) : undefined;
      const provider = model
        ? providerById.get(model.provider)
          ?? providers.find((candidate) => candidate.slug === model.provider)
        : undefined;
      return {
        state_id: binding.state,
        prompt: binding.prompt ?? "",
        required_skills: Array.isArray(binding.required_skills)
          ? binding.required_skills.filter(
              (skill): skill is string => typeof skill === "string",
            )
          : [],
        agent: provider?.slug ?? null,
        model: model?.name ?? null,
        reasoning: binding.reasoning
          ? reasoningById.get(binding.reasoning)?.name ?? null
          : null,
        auto_start: binding.auto_start ?? false,
        subtree_run_enabled: binding.subtree_run_enabled ?? false,
      };
    });

  const startStateId = issueType.start_state ?? null;
  const stateById = new Map(
    states.flatMap((state) => state.id ? [[state.id, state] as const] : []),
  );
  const warnings: ScopedWorkflowSettings["warnings"] = [];
  if (!startStateId || !stateById.has(startStateId)) {
    warnings.push({
      code: "start_state_not_configured",
      state_id: null,
      message: "No start state is configured for this work-item type.",
    });
  } else {
    const members = reachableStateIds(startStateId, scopedTransitions);
    const completed = new Set(
      [...members].filter((stateId) => stateById.get(stateId)?.group === "completed"),
    );
    const reverseTransitions = scopedTransitions.map((transition) => ({
      from_state_id: transition.to_state_id,
      to_state_id: transition.from_state_id,
      agent_allowed: transition.agent_allowed,
    }));
    const canReachCompleted = new Set<string>();
    for (const completedStateId of completed) {
      for (const stateId of reachableStateIds(completedStateId, reverseTransitions)) {
        canReachCompleted.add(stateId);
      }
    }
    for (const stateId of members) {
      if (canReachCompleted.has(stateId)) continue;
      warnings.push({
        code: "no_path_to_completed",
        state_id: stateId,
        message: `${stateById.get(stateId)?.name ?? stateId} has no path to a completed state.`,
      });
    }
  }

  const activatedProviders = new Set(
    providers.filter((provider) => provider.activated).map((provider) => provider.slug),
  );
  for (const binding of scopedBindings) {
    if (!binding.prompt.trim() && !binding.model) continue;
    const stateName = stateById.get(binding.state_id)?.name ?? "This state";
    if (binding.agent && !activatedProviders.has(binding.agent)) {
      warnings.push({
        code: "provider_not_activated",
        state_id: binding.state_id,
        message: `${stateName} launches with ${binding.agent}, which is deactivated in Settings → Model configuration; those launches are blocked.`,
      });
    } else if (binding.auto_start && !binding.agent && !hasGlobalDefault) {
      warnings.push({
        code: "auto_start_without_default",
        state_id: binding.state_id,
        message: `${stateName} auto-starts through the global launch default, and none is configured.`,
      });
    }
  }

  return {
    issue_type_id: issueType.id,
    start_state_id: startStateId,
    workflow_revision: issueType.workflow_revision ?? 0,
    transitions: scopedTransitions,
    launch_bindings: scopedBindings,
    warnings,
  };
}

export const getIssueTypeWorkflowSettings = (
  projectId: string,
  typeId: string,
): Promise<ScopedWorkflowSettings> => call(async () => {
  const client = sdk();
  const [
    issueType,
    states,
    transitions,
    bindings,
    providers,
    models,
    reasoningLevels,
    providerCatalog,
  ] = await Promise.all([
    client.issueTypes.getIssueType({ typeId }),
    client.states.listStates({ projectId }),
    client.workflows.listIssueTypeTransitions({ typeId }),
    client.launchBindings.listLaunchBindings({ projectId }),
    client.providers.listProviders(),
    client.models.listAgentModels(),
    client.reasoningLevels.listReasoningLevels(),
    client.settings.settingsProviderCatalogRetrieve(),
  ]);
  return assembleScopedWorkflowSettings(
    issueType as IssueType,
    states as State[],
    transitions,
    bindings,
    providers,
    models,
    reasoningLevels,
    Boolean(providerCatalog.value.global_default),
  );
});

export const addIssueTypeWorkflowTransition = (
  typeId: string,
  input: {
    from_state_id: string;
    to_state_id: string;
    agent_allowed: boolean;
    workflow_revision: number;
  },
): Promise<unknown> => request(
  issueTypeTransitionPath(typeId),
  {
    method: "POST",
    body: JSON.stringify({
      from_state: input.from_state_id,
      to_state: input.to_state_id,
      agent_allowed: input.agent_allowed,
      workflow_revision: input.workflow_revision,
    }),
  },
);

export const removeIssueTypeWorkflowTransition = (
  typeId: string,
  fromStateId: string,
  toStateId: string,
  workflowRevision: number,
): Promise<void> => request(
  `${issueTypeTransitionPath(typeId)}/${encodeURIComponent(fromStateId)}/${encodeURIComponent(toStateId)}`,
  {
    method: "DELETE",
    body: JSON.stringify({ workflow_revision: workflowRevision }),
  },
);

export const removeIssueTypeWorkflowState = (
  typeId: string,
  stateId: string,
  workflowRevision: number,
): Promise<void> => request(
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
): Promise<unknown> => request(
  `${issueTypeTransitionPath(typeId)}/${encodeURIComponent(fromStateId)}/${encodeURIComponent(toStateId)}`,
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
): Promise<IssueType> => patchIssueType(typeId, {
  start_state: stateId,
  workflow_revision: workflowRevision,
});

async function resolveLaunchBindingIds(binding: LaunchBindingInput): Promise<{
  model: string | null;
  reasoning: string | null;
}> {
  const client = sdk();
  const [providers, models, reasoningLevels] = await Promise.all([
    client.providers.listProviders(),
    client.models.listAgentModels(),
    client.reasoningLevels.listReasoningLevels(),
  ]);
  const provider = binding.agent
    ? providers.find((candidate) => candidate.slug === binding.agent)
    : undefined;
  if (binding.agent && !provider) {
    throw new Error(`Agent/provider '${binding.agent}' is not in the catalog.`);
  }
  const model = binding.model
    ? models.find((candidate) =>
        candidate.name === binding.model
        && (!provider
          || candidate.provider === provider.id
          || candidate.provider === provider.slug))
    : undefined;
  if (binding.model && !model) {
    throw new Error(
      `Model '${binding.model}' is not in the catalog for agent/provider '${binding.agent ?? ""}'.`,
    );
  }
  const reasoning = binding.reasoning
    ? reasoningLevels.find((candidate) => candidate.name === binding.reasoning)
    : undefined;
  if (binding.reasoning && !reasoning) {
    throw new Error(`Reasoning '${binding.reasoning}' is not in the catalog.`);
  }
  return {
    model: model?.id ?? null,
    reasoning: reasoning?.id ?? null,
  };
}

export const upsertIssueTypeWorkflowLaunchBinding = (
  typeId: string,
  stateId: string,
  binding: LaunchBindingInput,
  workflowRevision: number,
): Promise<unknown> => call(async () => {
  const resolved = await resolveLaunchBindingIds(binding);
  return request(
    `${issueTypeWorkflowPath(typeId)}/launch-bindings/${encodeURIComponent(stateId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        prompt: binding.prompt,
        required_skills: binding.required_skills,
        model: resolved.model,
        reasoning: resolved.reasoning,
        workflow_revision: workflowRevision,
      }),
    },
  );
});

export const setIssueTypeWorkflowAutoStart = (
  typeId: string,
  stateId: string,
  autoStart: boolean,
  workflowRevision: number,
): Promise<unknown> => request(
  `${issueTypeWorkflowPath(typeId)}/launch-bindings/${encodeURIComponent(stateId)}`,
  {
    method: "PUT",
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
): Promise<unknown> => request(
  `${issueTypeWorkflowPath(typeId)}/launch-bindings/${encodeURIComponent(stateId)}`,
  {
    method: "PUT",
    body: JSON.stringify({
      subtree_run_enabled: enabled,
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

const CONFIGURABLE_PROVIDER_SLUGS: readonly ConfigurableProvider[] = [
  "claude",
  "codex",
  "gemini",
];

export const getProviderCatalog = () =>
  call(async () => {
    const response = await sdk().settings.settingsProviderCatalogRetrieve();
    const activated = new Set(response.value.activated_providers ?? []);
    const globalDefault = response.value.global_default;
    return {
      value: {
        activated_providers: CONFIGURABLE_PROVIDER_SLUGS.filter((provider) =>
          activated.has(provider)),
        global_default: globalDefault
          ? {
              provider: globalDefault.provider as ConfigurableProvider,
              model: globalDefault.model ?? null,
              reasoning: globalDefault.reasoning ?? null,
            }
          : null,
      } satisfies ProviderCatalog,
    };
  });

export const putProviderCatalog = (value: ProviderCatalog) =>
  call(async () => {
    const response = await sdk().settings.settingsProviderCatalogUpdate({
      providerCatalogEnvelope: {
        value,
      },
    });
    const activated = new Set(response.value.activated_providers ?? []);
    const globalDefault = response.value.global_default;
    return {
      value: {
        activated_providers: CONFIGURABLE_PROVIDER_SLUGS.filter((provider) =>
          activated.has(provider)),
        global_default: globalDefault
          ? {
              provider: globalDefault.provider as ConfigurableProvider,
              model: globalDefault.model ?? null,
              reasoning: globalDefault.reasoning ?? null,
            }
          : null,
      } satisfies ProviderCatalog,
    };
  });

export const saveDocument = (
  docId: string,
  body: { content: string; digest: string },
) =>
  call(() => sdk().documents.docsUpdate({
    docId,
    saveDocument: body,
  })) as Promise<{ digest: string }>;
