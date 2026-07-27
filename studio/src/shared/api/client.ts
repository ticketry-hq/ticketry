import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import { WorkTrackerApiError } from "@worktracker/typescript-sdk/errors";
import { WorkItemPatchOriginEnum } from "@worktracker/typescript-sdk/models";
import { dedupeInFlight } from "./dedupe";
import type {
  IssueType,
  IssueTypeCreate,
  IssueTypePatch,
  Module,
  ModuleWorkItemCreate,
  Project,
  ProjectCreate,
  ProjectPatch,
  ScopeContext,
  State,
  StateCreate,
  StatePatch,
  SubtreeRunCapabilityMap,
  WorkItem,
  WorkItemCreate,
  WorkItemDetail,
  WorkItemFilters,
  WorkItemPatch,
  Workspace,
} from "./types";
import { runtimeConfiguration } from "../../runtime";

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

// Read paths below coalesce concurrent duplicates: parallel Zustand stores
// (tasksStore, projects store, backlogStore, issueStore) can request the same
// project resources at once when an issue surface opens (client-swr-dedup).
export const listProjects = () =>
  dedupeInFlight("wt:projects", () =>
    call<Project[]>(async () => (await sdk().projects.listProjects()) as Project[]),
  );

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
  dedupeInFlight(`wt:modules:${projectId}`, () =>
    call<Module[]>(async () =>
      (await sdk().modules.listModules({ projectId })) as Module[]
    ),
  );

export const createModule = (projectId: string, name: string) =>
  call<Module>(async () =>
    (await sdk().modules.createModule({
      projectId,
      moduleIn: { name },
    })) as Module
  );

export const listStates = (projectId: string) =>
  dedupeInFlight(`wt:states:${projectId}`, () =>
    call<State[]>(async () =>
      (await sdk().states.listStates({ projectId })) as State[]
    ),
  );

export const listProjectWorkItems = (
  projectId: string,
  filters?: WorkItemFilters,
) =>
  dedupeInFlight(
    `wt:project-work-items:${projectId}:${filters?.parent ?? ""}:${filters?.state ?? ""}:${filters?.includePathfind ?? ""}`,
    () =>
      call<WorkItem[]>(async () =>
        (await sdk().workItems.listProjectWorkItems({
          projectId,
          parent: filters?.parent,
          state: filters?.state,
          includePathfind: filters?.includePathfind,
        })) as WorkItem[]
      ),
  );

export const listModuleWorkItems = (moduleId: string) =>
  dedupeInFlight(`wt:module-work-items:${moduleId}`, () =>
    call<WorkItem[]>(async () =>
      (await sdk().workItems.listModuleWorkItems({ moduleId })) as WorkItem[]
    ),
  );

export const getWorkItem = (keyOrId: string, signal?: AbortSignal) =>
  call<WorkItemDetail>(async () =>
    (await sdk().workItems.getWorkItem(
      { issueId: keyOrId },
      signal ? { signal } : undefined,
    )) as WorkItemDetail
  );

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
    ? { ...patch, origin: WorkItemPatchOriginEnum.human }
    : patch;
  return call<WorkItem>(async () =>
    (await sdk().workItems.updateWorkItem({
      issueId: id,
      workItemPatch: studioPatch,
    })) as WorkItem
  );
};

// Agent scope-context (#667 B): read-only dependency slice for one task. Used
// by agents, not the dependency graph view (which derives from loaded items).
export const fetchScopeContext = (id: string) =>
  call<ScopeContext>(async () =>
    (await sdk().workItems.getWorkItemScopeContext({
      issueId: id,
    })) as ScopeContext
  );

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

export const deleteState = (id: string, reassignTo?: string) =>
  call<void>(() => sdk().states.deleteState({ stateId: id, reassignTo }));

export const reorderStates = (projectId: string, orderedIds: string[]) =>
  call<State[]>(async () =>
    (await sdk().states.reorderStates({
      projectId,
      reorderIn: { ordered_ids: orderedIds },
    })) as State[]
  );
