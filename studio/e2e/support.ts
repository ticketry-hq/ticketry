import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { TypedDocumentNode } from "../src/graphql-foundation/typedDocument";
import { RefreshTaskDocumentRegistryDocument } from "../src/features/documents/generated/documentRegistry";
import {
  AcknowledgeWorkTrackerOnboardingDocument,
  CreateWorkTrackerProjectDocument,
} from "../src/features/projects/generated/mutations";
import {
  WorkTrackerModulesDocument,
  WorkTrackerProjectsDocument,
  WorkTrackerWorkspaceDocument,
} from "../src/features/projects/generated/operations";
import { CreateWorkTrackerWorkItemDocument } from "../src/features/work-items/generated/mutations";
import {
  WorkTrackerWorkItemDocument,
  WorkTrackerWorkItemsDocument,
  type GeneratedWorkTrackerWorkItem,
} from "../src/features/work-items/generated/operations";
import { WorkTrackerWorkflowCatalogDocument } from "../src/features/workflows/generated/operations";
import {
  LoadProviderCatalogDocument,
  UpdateProviderCatalogDocument,
  type ProviderCatalogPayload,
} from "../src/features/settings/generated/providerCatalog";
import {
  LoadLocalSettingsDocument,
  ReplaceLocalProfileDocument,
} from "../src/features/settings/generated/profileSettings";

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

type GraphqlEnvelope<TResult> = {
  data?: TResult;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
};

export async function graphql<TResult, TVariables>(
  request: APIRequestContext,
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  const response = await request.post("/graphql", {
    data: {
      operationName: document.operationName,
      query: document.source,
      variables,
    },
  });
  const text = await response.text();
  expect(
    response.ok(),
    `${document.operationName} -> ${response.status()} ${text}`,
  ).toBeTruthy();
  const envelope = JSON.parse(text) as GraphqlEnvelope<TResult>;
  expect(
    envelope.errors,
    `${document.operationName} -> ${JSON.stringify(envelope.errors)}`,
  ).toBeUndefined();
  expect(envelope.data, `${document.operationName} returned no data`).toBeTruthy();
  return envelope.data!;
}

function workItemRow(row: GeneratedWorkTrackerWorkItem): WorkItemRow {
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
  const data = await graphql(request, WorkTrackerWorkspaceDocument, {});
  const workspace = data.workspace.nodes[0];
  expect(workspace, "the provisioned workspace").toBeTruthy();
  return workspace!;
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
  return await graphql(request, WorkTrackerWorkflowCatalogDocument, { projectId });
}

export async function getModules(
  request: APIRequestContext,
  projectId: string,
): Promise<ModuleRow[]> {
  const data = await graphql(request, WorkTrackerModulesDocument, { projectId });
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
  await graphql(request, AcknowledgeWorkTrackerOnboardingDocument, {});
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
  expect(saved.global_default).toEqual({
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
  projectId: string,
  moduleId: string,
  moduleFolder?: string,
): Promise<void> {
  const config = (await graphql(request, LoadLocalSettingsDocument, {})).local_settings;
  const index = config.recent_profile_index ?? 0;
  const profile = config.profiles[index];
  expect(profile, "active local profile").toBeTruthy();
  const moduleLinks = moduleFolder
    ? [
        ...profile!.module_links.filter((link) => link.module_id !== moduleId),
        { module_id: moduleId, path: moduleFolder },
      ]
    : profile!.module_links;
  await graphql(request, ReplaceLocalProfileDocument, {
    index,
    profile: {
      ...profile!,
      recent_project_id: projectId,
      recent_module_ids: { ...profile!.recent_module_ids, [projectId]: moduleId },
      module_links: moduleLinks,
    },
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
