/**
 * Test-only compatibility names for suites that mock the retired REST client.
 * Product modules must use feature-owned GraphQL or native transports.
 */

type RetiredOperation = (...args: any[]) => Promise<any>;

const retiredOperation: RetiredOperation = async () => {
  throw new Error("The REST client was retired; use the owning GraphQL or native transport.");
};

export function apiBase(): string {
  return "/graphql";
}

export function agentApiBase(): string {
  return "/graphql";
}

export function apiKey(): string {
  return "";
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = error.body && typeof error.body === "object"
      ? (error.body as { detail?: unknown }).detail
      : null;
    return typeof detail === "string" && detail
      ? detail
      : `${error.status}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export function isNoOpTransition(error: unknown): boolean {
  if (!(error instanceof ApiError) || !error.body || typeof error.body !== "object") return false;
  const { from, to } = error.body as { from?: unknown; to?: unknown };
  return typeof from === "string" && from === to;
}

export function moduleTreeFromWorkItems(
  moduleId: string,
  tasks: ReadonlyArray<{ id: string; parent_id?: string | null }>,
) {
  const rootIds: string[] = [];
  const children: Record<string, string[]> = {};
  const order = tasks.map(({ id }) => id);
  for (const task of tasks) children[task.id] = [];
  for (const task of tasks) {
    if (task.parent_id === moduleId) rootIds.push(task.id);
    else if (task.parent_id && children[task.parent_id]) children[task.parent_id].push(task.id);
  }
  return { rootIds, children, order };
}

export const getConfig: RetiredOperation = retiredOperation;
export const postProfile: RetiredOperation = retiredOperation;
export const putProfile: RetiredOperation = retiredOperation;
export const deleteProfile: RetiredOperation = retiredOperation;
export const patchConfig: RetiredOperation = retiredOperation;
export const listProjects: RetiredOperation = retiredOperation;
export const getOnboardingProjects: RetiredOperation = retiredOperation;
export const acknowledgeOnboarding: RetiredOperation = retiredOperation;
export const createProject: RetiredOperation = retiredOperation;
export const createProjectSummary: RetiredOperation = retiredOperation;
export const updateProject: RetiredOperation = retiredOperation;
export const deleteProject: RetiredOperation = retiredOperation;
export const listModules: RetiredOperation = retiredOperation;
export const createModule: RetiredOperation = retiredOperation;
export const createModuleSummary: RetiredOperation = retiredOperation;
export const getModuleActivity: RetiredOperation = retiredOperation;
export const listStates: RetiredOperation = retiredOperation;
export const getStates: RetiredOperation = retiredOperation;
export const listProjectWorkItems: RetiredOperation = retiredOperation;
export const listWorkItemsByIds: RetiredOperation = retiredOperation;
export const getWorkItem: RetiredOperation = retiredOperation;
export const getWorkItemAttachments: RetiredOperation = retiredOperation;
export const createWorkItem: RetiredOperation = retiredOperation;
export const patchWorkItem: RetiredOperation = retiredOperation;
export const deleteWorkItem: RetiredOperation = retiredOperation;
export const reorderWorkItem: RetiredOperation = retiredOperation;
export const getTasks: RetiredOperation = retiredOperation;
export const getProjectWorkItems: RetiredOperation = retiredOperation;
export const createTask: RetiredOperation = retiredOperation;
export const listIssueTypeTransitions: RetiredOperation = retiredOperation;
export const listIssueTypes: RetiredOperation = retiredOperation;
export const listSubtreeRunCapabilities: RetiredOperation = retiredOperation;
export const createIssueType: RetiredOperation = retiredOperation;
export const patchIssueType: RetiredOperation = retiredOperation;
export const deleteIssueType: RetiredOperation = retiredOperation;
export const reorderIssueTypes: RetiredOperation = retiredOperation;
export const createState: RetiredOperation = retiredOperation;
export const patchState: RetiredOperation = retiredOperation;
export const updateState: RetiredOperation = retiredOperation;
export const deleteState: RetiredOperation = retiredOperation;
export const reorderStates: RetiredOperation = retiredOperation;
export const reorderWorkflowStates: RetiredOperation = retiredOperation;
export const getIssueTypes: RetiredOperation = retiredOperation;
export const getLaunchProviderCapabilities: RetiredOperation = retiredOperation;
export const getIssueTypeWorkflowSettings: RetiredOperation = retiredOperation;
export const addIssueTypeWorkflowTransition: RetiredOperation = retiredOperation;
export const removeIssueTypeWorkflowTransition: RetiredOperation = retiredOperation;
export const removeIssueTypeWorkflowState: RetiredOperation = retiredOperation;
export const setIssueTypeWorkflowTransitionPermission: RetiredOperation = retiredOperation;
export const setIssueTypeWorkflowStartState: RetiredOperation = retiredOperation;
export const upsertIssueTypeWorkflowLaunchBinding: RetiredOperation = retiredOperation;
export const setIssueTypeWorkflowAutoStart: RetiredOperation = retiredOperation;
export const setIssueTypeWorkflowSubtreeRun: RetiredOperation = retiredOperation;
export const getKeybindingOverrides: RetiredOperation = retiredOperation;
export const putKeybindingOverrides: RetiredOperation = retiredOperation;
export const getProviderCatalog: RetiredOperation = retiredOperation;
export const putProviderCatalog: RetiredOperation = retiredOperation;
export const saveDocument: RetiredOperation = retiredOperation;

export const assembleScopedWorkflowSettings = (...args: any[]) => args[0];
