import { expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  documentOperationName,
  documentSource,
  type TypedDocumentNode,
} from "../src/graphql-foundation/typedDocument";
import { RefreshTaskDocumentRegistryDocument } from "../src/features/documents/generated/documentRegistry.documents";
import {
  AcknowledgeWorkTrackerOnboardingDocument,
  CreateWorkTrackerProjectDocument,
  WorkTrackerOnboardingDocument,
  WorkTrackerProjectOpenDocument,
  WorkTrackerProjectsDocument,
} from "../src/features/projects/generated/projects.documents";
import {
  CreateWorkTrackerWorkItemDocument,
  WorkTrackerWorkItemDocument,
  WorkTrackerWorkItemsDocument,
  type GeneratedWorkTrackerWorkItemFieldsFragment,
} from "../src/features/work-items/generated/workItems.documents";
import {
  LoadProviderCatalogDocument,
  UpdateProviderCatalogDocument,
  type LoadProviderCatalogQuery,
} from "../src/features/settings/generated/providerCatalog.documents";
import {
  SetModuleLinkDocument,
} from "../src/features/module-links/generated/moduleLinks.documents";

export type ApiRow = { id: string; name: string; [key: string]: unknown };
export type ProjectRow = ApiRow & { slug: string };
export type ModuleRow = ApiRow & { sequence_id: number };
export type WorkItemRow = ApiRow & {
  key: string;
  sequence_id: number;
  state_id: string | null;
};

export const CODEX_TEST_MODEL = "gpt-5.4";
export const CODEX_TEST_REASONING = "medium";
type ProviderCatalogPayload = LoadProviderCatalogQuery["provider_catalog"];

type GraphqlEnvelope<TResult> = {
  data?: TResult;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
};

/** Record any retired product REST request made by a visible browser journey. */
export function captureLegacyProductApiRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/work-tracker")) {
      requests.push(`${request.method()} ${url.pathname}`);
    }
  });
  return requests;
}

export async function graphql<TResult, TVariables>(
  request: APIRequestContext,
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  const operationName = documentOperationName(document);
  const response = await request.post("/graphql", {
    data: {
      operationName,
      query: documentSource(document),
      variables,
    },
  });
  const text = await response.text();
  expect(
    response.ok(),
    `${operationName} -> ${response.status()} ${text}`,
  ).toBeTruthy();
  const envelope = JSON.parse(text) as GraphqlEnvelope<TResult>;
  expect(
    envelope.errors,
    `${operationName} -> ${JSON.stringify(envelope.errors)}`,
  ).toBeUndefined();
  expect(envelope.data, `${operationName} returned no data`).toBeTruthy();
  return envelope.data!;
}

function workItemRow(row: GeneratedWorkTrackerWorkItemFieldsFragment): WorkItemRow {
  return { ...row, key: `T-${row.sequence_id}` };
}

export async function refreshTaskDocuments(
  request: APIRequestContext,
  taskId: string,
  projectId: string,
  moduleId: string,
) {
  return (await graphql(request, RefreshTaskDocumentRegistryDocument, {
    taskId,
    projectId,
    moduleId,
  })).refresh_task_document_registry;
}

export async function getWorkspace(request: APIRequestContext) {
  const data = await graphql(request, WorkTrackerOnboardingDocument, {});
  const project = data.projects.nodes[0];
  expect(project, "the provisioned project").toBeTruthy();
  return project!;
}

export async function getProjects(request: APIRequestContext): Promise<ProjectRow[]> {
  const data = await graphql(request, WorkTrackerProjectsDocument, {});
  return [...data.projects.nodes];
}

export async function createProject(
  request: APIRequestContext,
  values: { name: string; slug: string; description?: string },
): Promise<ProjectRow> {
  return (await graphql(request, CreateWorkTrackerProjectDocument, values))
    .create_project;
}

export async function getWorkflowCatalog(
  request: APIRequestContext,
  projectId: string,
) {
  return await graphql(request, WorkTrackerProjectOpenDocument, { projectId });
}

export async function getModules(
  request: APIRequestContext,
  projectId: string,
): Promise<ModuleRow[]> {
  const data = await graphql(request, WorkTrackerProjectOpenDocument, { projectId });
  return [...data.modules.nodes];
}

export async function getWorkItems(
  request: APIRequestContext,
  projectId: string,
): Promise<WorkItemRow[]> {
  const data = await graphql(request, WorkTrackerWorkItemsDocument, { projectId });
  return data.work_items.nodes.map(workItemRow);
}

export async function getWorkItem(
  request: APIRequestContext,
  id: string,
): Promise<WorkItemRow> {
  const data = await graphql(request, WorkTrackerWorkItemDocument, { id });
  const row = data.work_item.nodes[0];
  expect(row, `work item ${id}`).toBeTruthy();
  return workItemRow(row!);
}

export async function getProviderCatalog(
  request: APIRequestContext,
): Promise<ProviderCatalogPayload> {
  return (await graphql(request, LoadProviderCatalogDocument, {})).provider_catalog;
}

export async function ensureCodexTestModel(
  request: APIRequestContext,
): Promise<void> {
  const catalog = await getProviderCatalog(request);
  const codex = catalog.configurable_providers.find((provider) =>
    provider.slug === "codex"
  );
  const medium = catalog.reasoning_levels.find((reasoning) =>
    reasoning.name === CODEX_TEST_REASONING
  );
  const model = catalog.agent_models.find((candidate) =>
    candidate.provider === codex?.id && candidate.name === CODEX_TEST_MODEL
  );
  expect(codex, "the provisioned codex provider").toBeTruthy();
  expect(medium, "the provisioned medium reasoning level").toBeTruthy();
  expect(model, `the provisioned ${CODEX_TEST_MODEL} model`).toBeTruthy();
  expect(model!.reasoning_levels.nodes.map((row) => row.reasoning_level_id))
    .toContain(medium!.id);
}

export async function acknowledgeOnboarding(
  request: APIRequestContext,
): Promise<void> {
  const project = await getWorkspace(request);
  await graphql(request, AcknowledgeWorkTrackerOnboardingDocument, {
    projectId: project.id,
  });
}

/** Configure the deterministic model used by launch-surface assertions. */
export async function configureCodexDefault(
  request: APIRequestContext,
): Promise<void> {
  await ensureCodexTestModel(request);
  const catalog = await getProviderCatalog(request);
  const activatedProviders = catalog.configurable_providers
    .filter((provider) => provider.activated || provider.slug === "codex")
    .map((provider) => provider.slug);
  const saved = (await graphql(request, UpdateProviderCatalogDocument, {
    activatedProviders,
    defaultProvider: "codex",
    defaultModel: CODEX_TEST_MODEL,
    defaultReasoning: CODEX_TEST_REASONING,
  })).update_provider_catalog;
  expect(saved.global_default).toMatchObject({
    provider: "codex",
    model: CODEX_TEST_MODEL,
    reasoning: CODEX_TEST_REASONING,
  });
}

export async function createWorkItem(
  request: APIRequestContext,
  projectId: string,
  body: Record<string, unknown>,
): Promise<WorkItemRow> {
  const data = await graphql(request, CreateWorkTrackerWorkItemDocument, {
    projectId,
    name: body.name as string,
    issueTypeId: body.issue_type_id as string,
    description: body.description as string | undefined,
    stateId: body.state_id as string | undefined,
    parentId: body.parent_id as string | undefined,
  });
  return workItemRow(data.create_work_item);
}

export async function createModule(
  request: APIRequestContext,
  projectId: string,
  body: { name: string; issue_type_id: string },
): Promise<ModuleRow> {
  return await createWorkItem(request, projectId, body);
}

export async function selectModuleForProfile(
  request: APIRequestContext,
  _projectId: string,
  moduleId: string,
  moduleFolder?: string,
): Promise<void> {
  if (!moduleFolder) return;
  await graphql(request, SetModuleLinkDocument, {
    moduleId,
    path: moduleFolder,
  });
}

export async function openModule(page: Page, moduleName: string): Promise<void> {
  await page.goto("/");
  const moduleTab = page.getByRole("tab", { name: moduleName }).last();
  await expect(moduleTab).toBeVisible();
  await moduleTab.click();
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}

export async function openWorkItem(page: Page, name: string): Promise<void> {
  await page.getByRole("treeitem", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("issue-name")).toContainText(name);
}
