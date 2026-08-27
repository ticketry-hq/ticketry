import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { UpdateWorkTrackerWorkItemDocument } from "../src/features/work-items/generated/workItems.documents";
import {
  acknowledgeOnboarding,
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

type Row = { id: string; name: string; [key: string]: unknown };

const ids: Record<string, string> = {};

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

async function openItem(page: Page, name: string) {
  await page.getByRole("treeitem", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("issue-name")).toContainText(name);
}

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
  const moduleTab = page.getByRole("tab", { name: "Overhaul Module" });
  await expect(moduleTab).toBeVisible();
  await moduleTab.click();
  await expect(page.getByRole("treeitem", { name: /E2E parent/ })).toBeVisible();
});

test("[overhaul-web-01] edits every Story field through visible controls", async ({ page }) => {
  await openItem(page, "E2E parent");
  await page.getByTestId("issue-name").click();
  await page.getByRole("textbox", { name: "Name" }).fill("E2E parent renamed");
  await page.getByRole("textbox", { name: "Name" }).press("Enter");
  await expect(page.getByRole("treeitem", { name: /E2E parent renamed/ })).toBeVisible();

  await page.getByTestId("issue-description").click();
  const source = page.getByRole("textbox", { name: "Ticket description source" });
  if (await source.isVisible().catch(() => false)) {
    await source.fill("Fresh description");
  } else {
    await page.getByTestId("rich-markdown-editor-shell")
      .locator('[contenteditable="true"]')
      .fill("Fresh description");
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("issue-description")).toContainText("Fresh description");

  const parentPicker = page.getByTestId("parent-picker");
  await parentPicker.getByRole("button").click();
  await page.getByPlaceholder("Search by number, key, or name…").fill("E2E first");
  await page.getByRole("button", { name: /E2E first/ }).click();
  await expect(parentPicker).not.toContainText("No parent");
  await parentPicker.getByRole("button").click();
  await page.getByPlaceholder("Search by number, key, or name…").fill("Overhaul Module");
  await parentPicker.getByRole("button", { name: /Overhaul Module/ }).click();

  // Retyping is part of the acceptance contract and therefore must have a
  // user-facing control; this assertion intentionally exposes its absence.
  await expect(page.getByTestId("issue-type-picker")).toBeVisible();
});

test("[overhaul-web-02] moving state relocates the row immediately", async ({ page }) => {
  await openItem(page, "E2E moving");
  await page.getByTestId("state-picker").getByRole("button").click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(page.getByTestId("state-picker")).toContainText("Review");
  await expect(page.getByRole("button", { name: /Collapse Review/ })).toContainText("1");
});

test("[overhaul-web-03] drag reorder survives the server reply and reload", async ({ page }) => {
  const first = page.getByRole("treeitem", { name: /E2E first/ });
  const second = page.getByRole("treeitem", { name: /E2E second/ });
  await second.dragTo(first);
  await expect.poll(async () =>
    await page.getByRole("treeitem").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-task-id")),
    )
  ).toEqual(expect.arrayContaining([ids.second, ids.first]));
  await page.reload();
  await expect(page.getByRole("treeitem", { name: /E2E second/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /E2E first/ })).toBeVisible();
  const order = await page.getByRole("treeitem").allTextContents();
  expect(order.findIndex((text) => text.includes("E2E second")))
    .toBeLessThan(order.findIndex((text) => text.includes("E2E first")));
});

test("[overhaul-web-04] refused write visibly rolls back", async ({ page }) => {
  await openItem(page, "E2E first");
  await page.route("**/graphql", async (route) => {
    const body = route.request().postDataJSON() as {
      operationName?: string;
      variables?: { id?: string };
    };
    if (
      body.operationName === "UpdateWorkTrackerWorkItem"
      && body.variables?.id === ids.first.replaceAll("-", "")
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ errors: [{ message: "refused" }] }),
      });
    } else await route.continue();
  });
  await page.getByTestId("issue-name").click();
  await page.getByRole("textbox", { name: "Name" }).fill("E2E refused name");
  await page.getByRole("textbox", { name: "Name" }).press("Enter");
  await expect(page.getByTestId("issue-name")).toContainText("E2E first");
  await expect.poll(async () => (await getWorkItem(page.request, ids.first)).name)
    .toBe("E2E first");
});

test("[overhaul-web-05] external GraphQL edit appears after canonical refresh", async ({ page, request }) => {
  await openItem(page, "E2E external before");
  await graphql(request, UpdateWorkTrackerWorkItemDocument, {
    id: ids.external,
    name: "E2E external after",
  });
  await page.reload();
  await expect(page.getByTestId("issue-name")).toContainText("E2E external after");
  await expect(page.getByRole("treeitem", { name: /E2E external after/ })).toBeVisible();
});

test("[overhaul-web-06] cycling loaded selection has no loading flash", async ({ page }) => {
  for (const name of ["E2E first", "E2E second"]) {
    await page.getByRole("treeitem", { name: new RegExp(name) }).click();
    await expect(page.getByTestId("issue-name")).toContainText(name);
    await expect(page.getByText("Loading issue…")).toHaveCount(0);
  }
  const parent = page.getByRole("treeitem", {
    name: /E2E parent(?: renamed)?/,
  });
  await parent.click();
  await expect(page.getByTestId("issue-name")).toContainText(/E2E parent/);
  await expect(page.getByText("Loading issue…")).toHaveCount(0);
});

test("[overhaul-web-12] expansion and collapsed sections survive reload", async ({ page }) => {
  const parent = page.getByRole("treeitem", {
    name: /E2E parent(?: renamed)?/,
  });
  await parent.getByRole("button", { name: "Expand subtasks" }).click();
  await expect(page.getByRole("treeitem", { name: /E2E child/ })).toBeVisible();
  await page.getByRole("button", { name: "Collapse Review" }).click();
  await page.reload();
  await expect(page.getByRole("treeitem", { name: /E2E child/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand Review" })).toBeVisible();
});

test("[overhaul-web-14] reconnect replay closes an offline edit gap", async ({ page, request, context }) => {
  await openItem(page, "E2E second");
  await context.setOffline(true);
  await graphql(request, UpdateWorkTrackerWorkItemDocument, {
    id: ids.second,
    name: "E2E replayed",
  });
  await context.setOffline(false);
  await expect(page.getByRole("treeitem", { name: /E2E replayed/ })).toBeVisible();
  await expect(page.getByRole("treeitem", { name: /E2E second/ })).toHaveCount(0);
});
