// Leaf imports (not generated/index.js): the generated barrel re-exports the
// full model surface, and pulling it here would put every model module in the
// dependency graph of anything that touches the client.
import {
  Configuration,
  type FetchAPI,
  type HTTPHeaders,
  type Middleware,
} from "./generated/runtime.js";
import { AttachmentsApi } from "./generated/apis/AttachmentsApi.js";
import { DocumentsApi } from "./generated/apis/DocumentsApi.js";
import { ExecutionApi } from "./generated/apis/ExecutionApi.js";
import { IssueTypesApi } from "./generated/apis/IssueTypesApi.js";
import { LaunchBindingsApi } from "./generated/apis/LaunchBindingsApi.js";
import { ModelsApi } from "./generated/apis/ModelsApi.js";
import { ModuleLinksApi } from "./generated/apis/ModuleLinksApi.js";
import { ModulesApi } from "./generated/apis/ModulesApi.js";
import { ProjectsApi } from "./generated/apis/ProjectsApi.js";
import { ProvidersApi } from "./generated/apis/ProvidersApi.js";
import { ReasoningLevelsApi } from "./generated/apis/ReasoningLevelsApi.js";
import { RunsApi } from "./generated/apis/RunsApi.js";
import { SettingsApi } from "./generated/apis/SettingsApi.js";
import { StatesApi } from "./generated/apis/StatesApi.js";
import { WorkflowsApi } from "./generated/apis/WorkflowsApi.js";
import { WorkItemsApi } from "./generated/apis/WorkItemsApi.js";
import { SystemApi } from "./generated/apis/SystemApi.js";
import { TerminalsApi } from "./generated/apis/TerminalsApi.js";
import { WorktreesApi } from "./generated/apis/WorktreesApi.js";
import { WorkTrackerApiError } from "./errors.js";

export interface WorkTrackerClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: FetchAPI;
  headers?: HTTPHeaders;
}

export interface WorkTrackerClient {
  attachments: AttachmentsApi;
  documents: DocumentsApi;
  execution: ExecutionApi;
  issueTypes: IssueTypesApi;
  launchBindings: LaunchBindingsApi;
  models: ModelsApi;
  moduleLinks: ModuleLinksApi;
  modules: ModulesApi;
  projects: ProjectsApi;
  providers: ProvidersApi;
  reasoningLevels: ReasoningLevelsApi;
  runs: RunsApi;
  settings: SettingsApi;
  states: StatesApi;
  workflows: WorkflowsApi;
  workItems: WorkItemsApi;
  system: SystemApi;
  terminals: TerminalsApi;
  worktrees: WorktreesApi;
}

export function createAuthenticatedFetch(
  options: Pick<WorkTrackerClientOptions, "apiKey" | "fetch">,
): FetchAPI {
  const apiKey = options.apiKey?.trim() || undefined;
  const configuredFetch = options.fetch ?? globalThis.fetch;
  if (!configuredFetch) {
    throw new Error("A standard Fetch implementation is required.");
  }
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (apiKey) headers.set("x-api-key", apiKey);
    return configuredFetch(input, { ...init, headers });
  };
}

export function createWorkTrackerClient(
  options: WorkTrackerClientOptions,
): WorkTrackerClient {
  const configuredBasePath = options.baseUrl.replace(/\/+$/, "");
  const basePath = configuredBasePath.endsWith("/work-tracker")
    ? configuredBasePath.slice(0, -"/work-tracker".length)
    : configuredBasePath;
  const apiKey = options.apiKey?.trim() || undefined;
  const fetchApi = createAuthenticatedFetch(options);
  const middleware: Middleware = {
    post: async ({ response }) => {
      if (!response.ok) throw await WorkTrackerApiError.fromResponse(response);
      return response;
    },
    onError: async ({ error }) => {
      if (isAbortError(error)) throw error;
      return undefined;
    },
  };
  const configuration = new Configuration({
    basePath,
    fetchApi,
    apiKey,
    headers: options.headers,
    middleware: [middleware],
  });

  return {
    attachments: new AttachmentsApi(configuration),
    documents: new DocumentsApi(configuration),
    execution: new ExecutionApi(configuration),
    issueTypes: new IssueTypesApi(configuration),
    launchBindings: new LaunchBindingsApi(configuration),
    models: new ModelsApi(configuration),
    moduleLinks: new ModuleLinksApi(configuration),
    modules: new ModulesApi(configuration),
    projects: new ProjectsApi(configuration),
    providers: new ProvidersApi(configuration),
    reasoningLevels: new ReasoningLevelsApi(configuration),
    runs: new RunsApi(configuration),
    settings: new SettingsApi(configuration),
    states: new StatesApi(configuration),
    workflows: new WorkflowsApi(configuration),
    workItems: new WorkItemsApi(configuration),
    system: new SystemApi(configuration),
    terminals: new TerminalsApi(configuration),
    worktrees: new WorktreesApi(configuration),
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}
