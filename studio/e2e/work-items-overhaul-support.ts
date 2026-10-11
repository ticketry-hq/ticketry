import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { UpdateWorkTrackerWorkItemDetailsDocument } from "../src/features/work-items/generated/workItems.documents";
import {
  acknowledgeOnboarding,
  captureLegacyProductApiRequests,
  createModule,
  createProject,
  createWorkItem,
  getModules,
  getProjects,
  getWorkflowCatalog,
  getWorkItem,
  getWorkItems,
  graphql,
  selectModuleForProfile,
} from "./support";

let legacyProductApiRequests: string[] = [];

type Row = { id: string; name: string; [key: string]: unknown };

export const ids: Record<string, string> = {};

async function ensureWorkItem(
  request: APIRequestContext,
  projectId: string,
  body: Record<string, unknown> & { name: string },
) {
  const existing = await getWorkItems(request, projectId);
  const laterNames: Record<string, string[]> = {
    "E2E parent": ["E2E parent renamed"],
    "E2E external before": ["E2E external after"],
    "E2E second": ["E2E replayed"],
  };
  return existing.find((row) =>
    row.name === body.name || laterNames[body.name]?.includes(row.name)
  ) ??
    await createWorkItem(request, projectId, body);
}

export async function openItem(page: Page, name: string) {
  await page.getByRole("treeitem", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("issue-name")).toContainText(name);
}

export function installOverhaulFixture() {
test.beforeEach(async ({ page }) => {
  legacyProductApiRequests = captureLegacyProductApiRequests(page);
});

test.afterEach(async () => {
  expect(legacyProductApiRequests).toEqual([]);
});

test.beforeAll(async ({ request }) => {
  await acknowledgeOnboarding(request);
  const projects = await getProjects(request);
  const project = projects.find((row) => row.slug === "CDN") ??
    await createProject(request, { name: "Coding", slug: "CDN", description: "" });
  ids.project = project.id;

  const types = (await getWorkflowCatalog(request, project.id)).issue_types.nodes;
  const moduleType = types.find((row) => row.name === "Module");
  const storyType = types.find((row) => row.name === "Story");
  const implementationType = types.find((row) => row.name === "Implementation");
  expect(moduleType).toBeTruthy();
  expect(storyType).toBeTruthy();
  expect(implementationType).toBeTruthy();
  ids.storyType = storyType!.id;
  ids.implementationType = implementationType!.id;

  const modules = await getModules(request, project.id);
  const module = modules.find((row) => row.name === "Overhaul Module") ??
    await createModule(request, project.id, {
      name: "Overhaul Module",
      issue_type_id: moduleType!.id,
  });
  ids.module = module.id;
  await selectModuleForProfile(request, project.id, module.id, process.cwd());

  const parent = await ensureWorkItem(request, project.id, {
    name: "E2E parent",
    description: "Original description",
    parent_id: module.id,
    issue_type_id: storyType!.id,
  });
  ids.parent = parent.id;
  ids.child = (await ensureWorkItem(request, project.id, {
    name: "E2E child",
    parent_id: parent.id,
    issue_type_id: implementationType!.id,
  })).id;
  ids.moving = (await ensureWorkItem(request, project.id, {
    name: "E2E moving",
    parent_id: module.id,
    issue_type_id: implementationType!.id,
  })).id;
  ids.first = (await ensureWorkItem(request, project.id, {
    name: "E2E first",
    parent_id: module.id,
    issue_type_id: storyType!.id,
  })).id;
  ids.second = (await ensureWorkItem(request, project.id, {
    name: "E2E second",
    parent_id: module.id,
    issue_type_id: storyType!.id,
  })).id;
  ids.external = (await ensureWorkItem(request, project.id, {
    name: "E2E external before",
    parent_id: module.id,
    issue_type_id: storyType!.id,
  })).id;
});

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  const moduleTab = page.getByRole("tab", { name: "Overhaul Module", exact: true });
  await expect(moduleTab).toBeVisible();
  await moduleTab.click();
  await expect(page.getByRole("treeitem", { name: /E2E parent/ })).toBeVisible();
});

}
