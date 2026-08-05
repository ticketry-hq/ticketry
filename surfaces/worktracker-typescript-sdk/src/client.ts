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
import { IssueTypesApi } from "./generated/apis/IssueTypesApi.js";
import { LaunchBindingsApi } from "./generated/apis/LaunchBindingsApi.js";
import { ModelsApi } from "./generated/apis/ModelsApi.js";
import { ModulesApi } from "./generated/apis/ModulesApi.js";
import { ProjectsApi } from "./generated/apis/ProjectsApi.js";
import { ProvidersApi } from "./generated/apis/ProvidersApi.js";
import { ReasoningLevelsApi } from "./generated/apis/ReasoningLevelsApi.js";
import { StatesApi } from "./generated/apis/StatesApi.js";
import { WorkflowsApi } from "./generated/apis/WorkflowsApi.js";
import { WorkspaceApi } from "./generated/apis/WorkspaceApi.js";
import { WorkItemsApi } from "./generated/apis/WorkItemsApi.js";
import { WorkTrackerApiError } from "./errors.js";

export interface WorkTrackerClientOptions {
  baseUrl: string;
  apiKey?: string;
  fetch?: FetchAPI;
  headers?: HTTPHeaders;
}

export interface WorkTrackerClient {
  attachments: AttachmentsApi;
  issueTypes: IssueTypesApi;
  launchBindings: LaunchBindingsApi;
  models: ModelsApi;
  modules: ModulesApi;
  projects: ProjectsApi;
  providers: ProvidersApi;
  reasoningLevels: ReasoningLevelsApi;
  states: StatesApi;
  workflows: WorkflowsApi;
  workspace: WorkspaceApi;
  workItems: WorkItemsApi;
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
  const basePath = options.baseUrl.replace(/\/+$/, "");
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
    issueTypes: new IssueTypesApi(configuration),
    launchBindings: new LaunchBindingsApi(configuration),
    models: new ModelsApi(configuration),
    modules: new ModulesApi(configuration),
    projects: new ProjectsApi(configuration),
    providers: new ProvidersApi(configuration),
    reasoningLevels: new ReasoningLevelsApi(configuration),
    states: new StatesApi(configuration),
    workflows: new WorkflowsApi(configuration),
    workspace: new WorkspaceApi(configuration),
    workItems: new WorkItemsApi(configuration),
  };
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}
