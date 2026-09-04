import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  ClearModuleLinkDocument,
  LoadModuleLinksDocument,
} from "../src/features/module-links/generated/moduleLinks.documents";
import { WorktreeStatusDocument } from "../src/features/agents/worktrees/generated/worktreeStatus.documents";
import {
  CreateWorkTrackerWorkItemDocument,
  DeleteWorkTrackerWorkItemDocument,
} from "../src/features/work-items/generated/workItems.documents";
import {
  UpdateWorkTrackerModulePresentationDocument,
  UpdateWorkTrackerProjectDocument,
} from "../src/features/projects/generated/projects.documents";
import {
  CreateWorkTrackerIssueTypeDocument,
  CreateWorkTrackerStateDocument,
  CreateWorkTrackerTransitionDocument,
  DeleteWorkTrackerIssueTypeDocument,
  DeleteWorkTrackerStateDocument,
  DeleteWorkTrackerTransitionDocument,
  RemoveWorkTrackerWorkflowStateDocument,
  ReorderWorkTrackerIssueTypesDocument,
  ReorderWorkTrackerStatesDocument,
  SetWorkTrackerStartStateDocument,
  SetWorkTrackerSubtreeRunDocument,
  UpdateWorkTrackerStateDocument,
} from "../src/features/workflows/generated/workflows.documents";
import {
  acknowledgeOnboarding,
  captureLegacyProductApiRequests,
  CODEX_TEST_MODEL,
  CODEX_TEST_REASONING,
  configureCodexDefault,
  createModule,
  createProject,
  createWorkItem,
  getModules,
  getProjects,
  getWorkItem,
  getWorkItems,
  getWorkflowCatalog,
  graphql,
  graphqlRefusal,
  openModule,
  openWorkItem,
  selectModuleForProfile,
  type ApiRow,
  type ModuleRow,
  type ProjectRow,
  type WorkItemRow,
} from "./support";

let legacyProductApiRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  legacyProductApiRequests = captureLegacyProductApiRequests(page);
});

test.afterEach(async () => {
  expect(legacyProductApiRequests).toEqual([]);
});

async function ensureModulesPane(
  page: Page,
  options: { mayAlreadyBeOpen?: boolean } = {},
): Promise<Locator> {
  const pane = page.getByTestId("pane-modules");
  const toggle = page.getByTestId("modules-pane-toggle");
  if (options.mayAlreadyBeOpen && await pane.isVisible()) return pane;
  await expect(toggle).toHaveAttribute("aria-label", "Open Modules pane");
  await toggle.click();
  await expect(pane).toBeVisible();
  return pane;
}

type IssueTypeRow = ApiRow & { level: "task" | "module" };
type StateRow = ApiRow & {
  color: string | null;
  group: string;
  sort_order: number;
};

const execFileAsync = promisify(execFile);
const attachmentContents = "Rust MCP attachment E2E evidence.\n";

const names = {
  module: "Complete Web App",
  secondModule: "Navigation Target",
  staleModule: "Stale Link Recovery",
  nonRepoModule: "Non-repository Module",
  nonRepoItem: "Work without Git isolation",
  parent: "Complete parent",
  parentRenamed: "Complete parent renamed",
  blocker: "Complete blocker",
  moving: "Complete moving",
  reorderFirst: "Complete reorder first",
  reorderSecond: "Complete reorder second",
  hierarchyParent: "Complete hierarchy parent",
  hierarchyChild: "Complete hierarchy child",
  landing: "Retain committed worktree on completion",
  landingConflict: "Retain diverged worktree on completion",
  landingDirty: "Retain dirty worktree on completion",
  runNow: "Complete safe Run now refusal",
  deletable: "Complete disposable",
};

const fixture: {
  folder: string;
  nonRepoFolder: string;
  alternateFolder: string;
  attachmentPath: string;
  project: ProjectRow;
  module: ModuleRow;
  secondModule: ModuleRow;
  staleModule: ModuleRow;
  nonRepoModule: ModuleRow;
  storyType: IssueTypeRow;
  implementationType: IssueTypeRow;
  states: StateRow[];
  parent: WorkItemRow;
  blocker: WorkItemRow;
  moving: WorkItemRow;
  reorderFirst: WorkItemRow;
  reorderSecond: WorkItemRow;
  hierarchyParent: WorkItemRow;
  hierarchyChild: WorkItemRow;
  landing: WorkItemRow;
  landingConflict: WorkItemRow;
  landingDirty: WorkItemRow;
  runNow: WorkItemRow;
  deletable: WorkItemRow;
  nonRepoItem: WorkItemRow;
} = {} as never;

async function seedProject(request: APIRequestContext): Promise<void> {
  fixture.folder = await mkdtemp(join(tmpdir(), "ticketry-web-e2e-"));
  fixture.nonRepoFolder = await mkdtemp(join(tmpdir(), "ticketry-web-no-repo-e2e-"));
  fixture.alternateFolder = await mkdtemp(join(tmpdir(), "ticketry-web-alternate-e2e-"));
  const gitEnvironment = {
    ...process.env,
    GIT_AUTHOR_NAME: "Ticketry E2E",
    GIT_AUTHOR_EMAIL: "e2e@ticketry.invalid",
    GIT_COMMITTER_NAME: "Ticketry E2E",
    GIT_COMMITTER_EMAIL: "e2e@ticketry.invalid",
  };
  const git = async (...arguments_: string[]): Promise<void> => {
    await execFileAsync("git", ["-C", fixture.folder, ...arguments_], {
      env: gitEnvironment,
    });
  };
  await git("init", "-b", "main");
  await writeFile(join(fixture.folder, "README.md"), "Ticketry browser E2E\n");
  fixture.attachmentPath = join(fixture.folder, "e2e-implementation-notes.md");
  await writeFile(fixture.attachmentPath, attachmentContents);
  await git("add", "README.md", "e2e-implementation-notes.md");
  await git("commit", "-m", "Initial E2E fixture");
  await acknowledgeOnboarding(request);

  const projects = await getProjects(request);
  fixture.project = projects.find((project) => project.slug === "CDN")
    ?? await createProject(request, {
      name: "Coding",
      slug: "CDN",
      description: "",
    });

  const catalog = await getWorkflowCatalog(request, fixture.project.id);
  const issueTypes = catalog.issue_types.nodes;
  const moduleType = issueTypes.find((issueType) =>
    issueType.level === "module" || issueType.name === "Module"
  );
  const storyType = issueTypes.find((issueType) => issueType.name === "Story");
  const implementationType = issueTypes.find((issueType) =>
    issueType.name === "Implementation"
  );
  expect(moduleType, "the seeded Module issue type").toBeTruthy();
  expect(storyType, "the seeded Story issue type").toBeTruthy();
  expect(implementationType, "the seeded Implementation issue type").toBeTruthy();
  fixture.storyType = storyType!;
  fixture.implementationType = implementationType!;

  const modules = await getModules(request, fixture.project.id);
  fixture.module = modules.find((module) => module.name === names.module)
    ?? await createModule(request, fixture.project.id, {
      name: names.module,
      issue_type_id: moduleType!.id,
    });
  fixture.secondModule = modules.find((module) =>
    module.name === names.secondModule
  ) ?? await createModule(request, fixture.project.id, {
    name: names.secondModule,
    issue_type_id: moduleType!.id,
  });
  fixture.staleModule = modules.find((module) =>
    module.name === names.staleModule
  ) ?? await createModule(request, fixture.project.id, {
    name: names.staleModule,
    issue_type_id: moduleType!.id,
  });
  fixture.nonRepoModule = modules.find((module) =>
    module.name === names.nonRepoModule
  ) ?? await createModule(request, fixture.project.id, {
    name: names.nonRepoModule,
    issue_type_id: moduleType!.id,
  });
  await selectModuleForProfile(
    request,
    fixture.project.id,
    fixture.secondModule.id,
    fixture.folder,
  );
  await selectModuleForProfile(
    request,
    fixture.project.id,
    fixture.module.id,
    fixture.folder,
  );
  await selectModuleForProfile(
    request,
    fixture.project.id,
    fixture.nonRepoModule.id,
    fixture.nonRepoFolder,
  );
  await selectModuleForProfile(
    request,
    fixture.project.id,
    fixture.module.id,
    fixture.folder,
  );

  fixture.states = [...catalog.states.nodes];
  const existingItems = await getWorkItems(request, fixture.project.id);
  const ensureItem = async (
    name: string,
    body: Record<string, unknown>,
    aliases: string[] = [],
  ): Promise<WorkItemRow> => existingItems.find((item) =>
    item.name === name || aliases.includes(item.name)
  ) ?? await createWorkItem(request, fixture.project.id, { name, ...body });
  const rootStory = {
    parent_id: fixture.module.id,
    issue_type_id: fixture.storyType.id,
  };
  fixture.parent = await ensureItem(names.parent, {
    ...rootStory,
    description: "Original complete description",
  }, [names.parentRenamed]);
  fixture.blocker = await ensureItem(names.blocker, rootStory);
  fixture.moving = await ensureItem(names.moving, rootStory);
  fixture.reorderFirst = await ensureItem(names.reorderFirst, rootStory);
  fixture.reorderSecond = await ensureItem(names.reorderSecond, rootStory);
  fixture.hierarchyParent = await ensureItem(names.hierarchyParent, rootStory);
  fixture.hierarchyChild = await ensureItem(names.hierarchyChild, {
    parent_id: fixture.hierarchyParent.id,
    issue_type_id: fixture.implementationType.id,
  });
  fixture.landing = await ensureItem(names.landing, rootStory);
  fixture.landingConflict = await ensureItem(names.landingConflict, rootStory);
  fixture.landingDirty = await ensureItem(names.landingDirty, rootStory);
  fixture.runNow = await ensureItem(names.runNow, rootStory);
  fixture.deletable = await ensureItem(names.deletable, rootStory);
  fixture.nonRepoItem = await ensureItem(names.nonRepoItem, {
    parent_id: fixture.nonRepoModule.id,
    issue_type_id: fixture.storyType.id,
  });
}

async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Open Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Studio settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function editDescription(page: Page, description: string): Promise<void> {
  await page.getByTestId("issue-description").click();
  const source = page.getByRole("textbox", {
    name: "Ticket description source",
  });
  if (await source.isVisible().catch(() => false)) {
    await source.fill(description);
  } else {
    await page.getByTestId("rich-markdown-editor-shell")
      .locator('[contenteditable="true"]')
      .fill(description);
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("issue-description")).toContainText(description);
}

async function selectState(page: Page, stateName: string): Promise<void> {
  const picker = page.getByTestId("state-picker");
  await picker.getByRole("button").click();
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/graphql") &&
    response.request().postDataJSON()?.operationName ===
      "TransitionWorkTrackerWorkItem"
  );
  await page.getByRole("button", { name: stateName, exact: true }).click();
  await saved;
  await expect(picker).toContainText(stateName);
}

async function callMcpTool<TResult>(
  request: APIRequestContext,
  id: number,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<TResult> {
  const mcpPort = process.env.MUXED_DESKTOP_MCP_PORT ?? "8123";
  const response = await request.post(`http://127.0.0.1:${mcpPort}/mcp`, {
    headers: {
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-03-26",
    },
    data: {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: arguments_ },
    },
  });
  const responseText = await response.text();
  expect(response.ok(), responseText).toBeTruthy();
  const envelope = JSON.parse(responseText) as {
    result?: { structuredContent?: TResult };
  };
  expect(envelope.result?.structuredContent, responseText).toBeTruthy();
  return envelope.result!.structuredContent!;
}

test.beforeAll(async ({ request }) => {
  await seedProject(request);
});

test.afterAll(async () => {
  if (fixture.folder) {
    await rm(fixture.folder, { recursive: true, force: true });
  }
  if (fixture.nonRepoFolder) {
    await rm(fixture.nonRepoFolder, { recursive: true, force: true });
  }
  if (fixture.alternateFolder) {
    await rm(fixture.alternateFolder, { recursive: true, force: true });
  }
});

test.describe("complete browser application", () => {
  test("recovers bootstrap after the local Rust adapter is initially unavailable", async ({
    page,
  }) => {
    await page.route("**/graphql", (route) => route.abort());
    await page.goto("/");
    await expect(page.getByText("The local server is not running."))
      .toBeVisible({ timeout: 10_000 });
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();

    await page.unroute("**/graphql");
    await retry.click();
    await expect(page.getByRole("tablist", { name: "Project module tabs" }))
      .toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: names.module }))
      .toBeVisible();
  });

  test("retries an invalid module folder without duplicating the persisted module", async ({
    page,
  }) => {
    await openModule(page, names.module);
    const modulesPane = await ensureModulesPane(page);
    await modulesPane.getByRole("button", { name: "Add module" }).click();

    let dialog = page.getByRole("dialog", { name: "Add Module" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Module name").fill("Cancelled invalid module");
    await dialog.getByRole("textbox", { name: "Module folder" })
      .fill(join(fixture.folder, "folder-that-does-not-exist"));
    await dialog.getByRole("button", { name: "Create module" }).click();
    await expect(dialog.getByRole("alert"))
      .toHaveText(
        "Module created, but its folder could not be saved. Retry to save the folder.",
      );
    await expect(dialog.getByPlaceholder("Module name")).toBeDisabled();
    await dialog.getByRole("textbox", { name: "Module folder" })
      .fill(fixture.folder);
    await dialog.getByRole("button", { name: "Save folder" }).click();

    await expect(dialog).toHaveCount(0);
    const createdTab = page.getByRole("tab", {
      name: "Cancelled invalid module",
    });
    await expect(createdTab).toHaveAttribute("aria-selected", "true");

    await page.reload();
    await expect(page.getByRole("tab", { name: "Cancelled invalid module" }))
      .toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Cancelled invalid module" }))
      .toHaveCount(1);
    await page.getByRole("tab", { name: names.module }).click();
  });

  test("creates, switches, and searches the visible module workspace", async ({
    page,
  }) => {
    await openModule(page, names.module);

    await page.getByRole("tab", { name: names.secondModule }).click();
    await expect(page.getByRole("tab", { name: names.secondModule }))
      .toHaveAttribute("aria-selected", "true");
    await page.getByRole("tab", { name: names.module }).click();
    await expect(page.getByRole("treeitem", { name: names.parent })).toBeVisible();

    const idea = page.getByRole("textbox", { name: "Capture an idea" });
    await idea.fill("Created through the idea field");
    await idea.press("Enter");
    await expect(page.getByRole("treeitem", {
      name: /Created through the idea field/,
    })).toBeVisible();

    const search = page.getByRole("textbox", { name: "Search stories" });
    await search.fill(names.blocker);
    await expect(page.getByRole("treeitem", { name: names.blocker })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: names.parent })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.getByRole("treeitem", { name: names.parent })).toBeVisible();
  });

  test("reorders module tabs and restores the canonical order after reload", async ({
    page,
  }) => {
    await openModule(page, names.module);
    const modulesPane = await ensureModulesPane(page);
    const moduleTabs = page.getByRole("tablist", {
      name: "Project module tabs",
    });
    const first = moduleTabs.getByRole("tab", { name: names.secondModule });
    const second = moduleTabs.getByRole("tab", { name: names.module });
    const sidebarModuleNames = () => modulesPane
      .locator("li[data-module-id]")
      .allTextContents()
      .then((labels) => labels
        .map((label) => label.replace(/^📦\s*/, "").trim())
        .filter((label) => [names.module, names.secondModule].includes(label)));

    await expect.poll(async () =>
      (await moduleTabs.getByRole("tab").allTextContents())
        .filter((label) => [names.module, names.secondModule].includes(label))
    ).toEqual([names.secondModule, names.module]);
    await expect.poll(sidebarModuleNames)
      .toEqual([names.secondModule, names.module]);

    const target = await first.boundingBox();
    expect(target).toBeTruthy();
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "ReorderWorkTrackerModulePresentation"
    );
    await second.dragTo(first, {
      targetPosition: { x: 2, y: target!.height / 2 },
    });
    await saved;

    await expect.poll(async () =>
      (await moduleTabs.getByRole("tab").allTextContents())
        .filter((label) => [names.module, names.secondModule].includes(label))
    ).toEqual([names.module, names.secondModule]);
    await expect.poll(sidebarModuleNames)
      .toEqual([names.module, names.secondModule]);

    await page.reload();
    await expect.poll(async () =>
      (await page.getByRole("tablist", { name: "Project module tabs" })
        .getByRole("tab").allTextContents())
        .filter((label) => [names.module, names.secondModule].includes(label))
    ).toEqual([names.module, names.secondModule]);
    await ensureModulesPane(page);
    await expect.poll(sidebarModuleNames)
      .toEqual([names.module, names.secondModule]);
  });

  test("reorders modules by dragging inside the Modules pane", async ({
    page,
  }) => {
    await openModule(page, names.module);
    const modulesPane = await ensureModulesPane(page);
    const seededNames = [names.module, names.secondModule];
    const paneRow = (moduleName: string) =>
      modulesPane.locator("li[data-module-id]").filter({ hasText: moduleName });
    const paneOrder = () => modulesPane
      .locator("li[data-module-id]")
      .allTextContents()
      .then((labels) => labels
        .map((label) => label.replace(/^📦\s*/, "").trim())
        .filter((label) => seededNames.includes(label)));
    const tabOrder = () => page
      .getByRole("tablist", { name: "Project module tabs" })
      .getByRole("tab")
      .allTextContents()
      .then((labels) => labels.filter((label) => seededNames.includes(label)));

    // Whichever order earlier tests left persisted, dragging the trailing row
    // onto the leading row's near edge must swap exactly those two.
    const before = await paneOrder();
    expect(before).toHaveLength(2);
    await expect.poll(tabOrder).toEqual(before);
    const [leading, trailing] = before;
    const after = [trailing, leading];

    const leadingRow = paneRow(leading);
    const target = await leadingRow.boundingBox();
    expect(target).toBeTruthy();
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "ReorderWorkTrackerModulePresentation"
    );
    await paneRow(trailing).dragTo(leadingRow, {
      targetPosition: { x: target!.width / 2, y: 2 },
    });
    await saved;

    await expect.poll(paneOrder).toEqual(after);
    // The tab strip reads the same persisted ranks, so it must agree at once.
    await expect.poll(tabOrder).toEqual(after);
    // Dropping a row must not also register as a click that switches module.
    await expect(page.getByRole("tab", { name: names.module }).last())
      .toHaveAttribute("aria-selected", "true");

    await page.reload();
    await expect.poll(tabOrder).toEqual(after);
    await ensureModulesPane(page);
    await expect.poll(paneOrder).toEqual(after);

    // Leave the persisted order exactly as it was found, so every later test
    // sees the arrangement it was written against.
    const restoredRow = paneRow(trailing);
    const restoreTarget = await restoredRow.boundingBox();
    expect(restoreTarget).toBeTruthy();
    const restored = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "ReorderWorkTrackerModulePresentation"
    );
    await paneRow(leading).dragTo(restoredRow, {
      targetPosition: { x: restoreTarget!.width / 2, y: 2 },
    });
    await restored;
    await expect.poll(paneOrder).toEqual(before);
    await expect.poll(tabOrder).toEqual(before);
  });

  test("hides a module tab and restores it through the module picker", async ({
    page,
  }) => {
    await openModule(page, names.module);
    const modulesPane = await ensureModulesPane(page);
    const moduleTabs = page.getByRole("tablist", {
      name: "Project module tabs",
    });
    const hidden = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "UpdateWorkTrackerModulePresentation"
    );
    await moduleTabs.getByRole("button", {
      name: `Hide ${names.secondModule} tab`,
    }).click();
    await hidden;
    await expect(moduleTabs.getByRole("tab", { name: names.secondModule }))
      .toHaveCount(0);
    await expect(modulesPane).toContainText(
      names.secondModule,
    );

    await page.reload();
    await expect(page.getByRole("tab", { name: names.secondModule }))
      .toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: names.parent }))
      .toBeVisible();

    const pickerTrigger = page.getByRole("button", {
      name: "Open module picker",
    });
    await pickerTrigger.click();
    let picker = page.getByRole("dialog", { name: "Module picker" });
    await expect(picker.getByRole("combobox", { name: "Search modules" }))
      .toBeFocused();
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    await expect(pickerTrigger).toBeFocused();

    await pickerTrigger.click();
    picker = page.getByRole("dialog", { name: "Module picker" });
    await expect(picker).toBeVisible();
    const search = picker.getByRole("combobox", { name: "Search modules" });
    await search.fill(names.secondModule);
    const hiddenModule = picker.getByRole("option", {
      name: `Restore ${names.secondModule} module tab`,
    });
    await search.press("ArrowDown");
    await expect(hiddenModule).toHaveAttribute("aria-selected", "true");
    const restored = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "UpdateWorkTrackerModulePresentation"
    );
    await search.press("Enter");
    await restored;

    await expect(picker).toHaveCount(0);
    await expect(page.getByRole("tab", { name: names.secondModule }).last())
      .toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(page.getByRole("tab", { name: names.secondModule }).last())
      .toBeVisible();
  });

  test("recovers through the Modules pane after every module tab is hidden", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    const moduleTabs = page.getByRole("tablist", {
      name: "Project module tabs",
    });
    const visibleNames = (await moduleTabs.getByRole("tab").evaluateAll((tabs) =>
      tabs.map((tab) => tab.getAttribute("aria-label"))
        .filter((name): name is string => Boolean(name))));
    expect(visibleNames.length).toBeGreaterThan(1);

    for (const moduleName of visibleNames) {
      const hidden = page.waitForResponse((response) =>
        response.url().endsWith("/graphql") &&
        response.request().postDataJSON()?.operationName ===
          "UpdateWorkTrackerModulePresentation"
      );
      await moduleTabs.getByRole("button", {
        name: `Hide ${moduleName} tab`,
      }).click();
      await hidden;
      await expect(moduleTabs.getByRole("tab", { name: moduleName }))
        .toHaveCount(0);
    }
    await expect(page.getByTestId("empty-module-workspace")).toContainText(
      /(?:Open the Modules sidebar|Select a module in the Modules pane) to restore (?:a module|its) tab\./,
    );

    const modules = (await getModules(request, fixture.project.id))
      .filter((module) => visibleNames.includes(module.name));

    try {
      const modulesPane = await ensureModulesPane(page, {
        mayAlreadyBeOpen: true,
      });
      const restored = page.waitForResponse((response) =>
        response.url().endsWith("/graphql") &&
        response.request().postDataJSON()?.operationName ===
          "UpdateWorkTrackerModulePresentation"
      );
      await modulesPane.locator("li[data-module-id]")
        .filter({ hasText: names.module })
        .click();
      await restored;
      await expect(moduleTabs.getByRole("tab", { name: names.module }).last())
        .toBeVisible();
      await expect(moduleTabs.getByRole("tab", { name: names.module }).last())
        .toHaveAttribute("aria-selected", "true");
    } finally {
      for (const module of modules) {
        await graphql(request, UpdateWorkTrackerModulePresentationDocument, {
          moduleId: module.id,
          tabHidden: false,
        });
      }
      await page.reload();
    }

    for (const moduleName of visibleNames) {
      await expect(page.getByRole("tab", { name: moduleName }).last())
        .toBeVisible();
    }
    await expect(page.getByRole("tab", { name: names.module }).last())
      .toHaveAttribute("aria-selected", "true");
  });

  test("creates, detects changes in, and explicitly discards a real Git worktree", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    const worktree = page.getByTestId("worktree-block");
    const create = worktree.getByRole("button", { name: "+ Create worktree" });
    await expect(create).toBeVisible();

    const created = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName === "WorktreeCreate"
    );
    await create.click();
    await created;
    await expect(worktree).toContainText(/wt\/CODIN-\d+-complete-parent → main/);
    await expect(worktree).toContainText("clean");
    await expect(worktree.getByRole("button", { name: "Discard" })).toBeVisible();

    const status = (await graphql(request, WorktreeStatusDocument, {
      taskId: fixture.parent.id,
    })).worktree_status;
    expect(status.kind).toBe("worktree");
    expect(status.path).toBeTruthy();
    await writeFile(join(status.path!, "e2e-uncommitted-change.txt"), "dirty\n");

    await page.reload();
    await expect(worktree).toContainText(/wt\/CODIN-\d+-complete-parent → main/);
    await expect(worktree).toContainText("dirty");
    await worktree.getByRole("button", { name: "Discard" }).click();
    await expect(worktree).toContainText("Discard — work is thrown away?");
    await worktree.getByRole("button", { name: "Cancel" }).click();
    await expect(worktree).not.toContainText("Discard — work is thrown away?");
    await expect(worktree.getByRole("button", { name: "Discard" })).toBeVisible();

    await worktree.getByRole("button", { name: "Discard" }).click();
    const discarded = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName === "WorktreeDiscard"
    );
    await worktree.getByRole("button", { name: "Yes, discard" }).click();
    await discarded;
    await expect(create).toBeVisible();
    await expect(worktree).toContainText("Runs in the primary checkout.");

    await page.reload();
    await expect(create).toBeVisible();
    await expect(worktree.getByRole("button", { name: "Discard" }))
      .toHaveCount(0);
  });

  test("keeps a top-level worktree when a sharing child reaches Done", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.hierarchyParent);
    let worktree = page.getByTestId("worktree-block");
    const created = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName === "WorktreeCreate"
    );
    await worktree.getByRole("button", { name: "+ Create worktree" }).click();
    await created;
    await expect(worktree).toContainText(/wt\/CODIN-\d+-complete-hierarchy-parent/);

    await page.getByTestId("child-issues").getByRole("button", {
      name: new RegExp(names.hierarchyChild),
    }).click();
    worktree = page.getByTestId("worktree-block");
    await expect(worktree).toContainText(
      "Shares the worktree owned by top-level task",
    );
    await expect(worktree.getByRole("button", { name: "+ Create worktree" }))
      .toHaveCount(0);
    await expect(worktree.getByRole("button", { name: "Discard" }))
      .toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(
      names.hierarchyChild,
    );
    await expect(page.getByTestId("worktree-block")).toContainText(
      "Shares the worktree owned by top-level task",
    );
    await selectState(page, "Review");
    await selectState(page, "Done");
    await expect.poll(async () => (
      await graphql(request, WorktreeStatusDocument, {
        taskId: fixture.hierarchyParent.id,
      })
    ).worktree_status.kind).toBe("worktree");
    await expect(page.getByTestId("worktree-block")).toContainText(
      "Shares the worktree owned by top-level task",
    );

    await openWorkItem(page, names.hierarchyParent);
    worktree = page.getByTestId("worktree-block");
    await worktree.getByRole("button", { name: "Discard" }).click();
    await worktree.getByRole("button", { name: "Yes, discard" }).click();
    await expect(worktree.getByRole("button", { name: "+ Create worktree" }))
      .toBeVisible();
  });

  test("keeps a committed worktree when its Story reaches Done until explicit discard", async ({
    page,
    request,
  }) => {
    test.setTimeout(45_000);
    await openModule(page, names.module);
    await openWorkItem(page, names.landing);
    const worktree = page.getByTestId("worktree-block");
    const created = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName === "WorktreeCreate"
    );
    await worktree.getByRole("button", { name: "+ Create worktree" }).click();
    await created;
    await expect(worktree).toContainText(
      /wt\/CODIN-\d+-retain-committed-worktree-on-completion → main/,
    );

    const status = (await graphql(request, WorktreeStatusDocument, {
      taskId: fixture.landing.id,
    })).worktree_status;
    expect(status).toMatchObject({
      kind: "worktree",
      base_branch: "main",
      clean: true,
    });
    expect(status.path).toBeTruthy();
    const evidenceName = "retained-worktree-e2e.txt";
    const evidence = "Retained after Work Item completion.\n";
    await writeFile(join(status.path!, evidenceName), evidence);
    const gitEnvironment = {
      ...process.env,
      GIT_AUTHOR_NAME: "Ticketry E2E",
      GIT_AUTHOR_EMAIL: "e2e@ticketry.invalid",
      GIT_COMMITTER_NAME: "Ticketry E2E",
      GIT_COMMITTER_EMAIL: "e2e@ticketry.invalid",
    };
    await execFileAsync("git", ["-C", status.path!, "add", evidenceName], {
      env: gitEnvironment,
    });
    await execFileAsync(
      "git",
      ["-C", status.path!, "commit", "-m", "E2E retained worktree"],
      { env: gitEnvironment },
    );

    await page.reload();
    await expect(worktree).toContainText("clean");
    await expect(worktree).toContainText("↑1");
    await selectState(page, "Implement");
    await selectState(page, "Review");
    await selectState(page, "Done");

    await expect.poll(async () => (
      await graphql(request, WorktreeStatusDocument, {
        taskId: fixture.landing.id,
      })
    ).worktree_status.kind, { timeout: 20_000 }).toBe("worktree");
    await expect.poll(async () => {
      try {
        return await readFile(join(status.path!, evidenceName), "utf8");
      } catch {
        return null;
      }
    }).toBe(evidence);
    await expect(worktree).toContainText(
      "completion leaves this worktree unchanged",
    );
    await expect(worktree.getByRole("button", { name: "Discard" })).toBeVisible();
    await expect.poll(async () => {
      try {
        return await readFile(join(fixture.folder, evidenceName), "utf8");
      } catch {
        return null;
      }
    }).toBeNull();

    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Done");
    const retained = page.getByTestId("worktree-block");
    await expect(retained).toContainText(status.branch!);
    await retained.getByRole("button", { name: "Discard" }).click();
    await retained.getByRole("button", { name: "Yes, discard" }).click();
    await expect(retained).toContainText("Runs in the primary checkout.");
    await expect.poll(async () => {
      try {
        await access(status.path!);
        return true;
      } catch {
        return false;
      }
    }).toBe(false);
  });

  test("keeps diverged worktree and primary checkouts independent on Done", async ({
    page,
    request,
  }) => {
    test.setTimeout(45_000);
    await openModule(page, names.module);
    await openWorkItem(page, names.landingConflict);
    const worktree = page.getByTestId("worktree-block");
    const created = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName === "WorktreeCreate"
    );
    await worktree.getByRole("button", { name: "+ Create worktree" }).click();
    await created;
    await expect(worktree).toContainText(
      /wt\/CODIN-\d+-retain-diverged-worktree-on-completion/,
    );

    const status = (await graphql(request, WorktreeStatusDocument, {
      taskId: fixture.landingConflict.id,
    })).worktree_status;
    expect(status.path).toBeTruthy();
    const gitEnvironment = {
      ...process.env,
      GIT_AUTHOR_NAME: "Ticketry E2E",
      GIT_AUTHOR_EMAIL: "e2e@ticketry.invalid",
      GIT_COMMITTER_NAME: "Ticketry E2E",
      GIT_COMMITTER_EMAIL: "e2e@ticketry.invalid",
    };
    await writeFile(join(status.path!, "README.md"), "task-side conflict\n");
    await execFileAsync("git", ["-C", status.path!, "add", "README.md"], {
      env: gitEnvironment,
    });
    await execFileAsync(
      "git",
      ["-C", status.path!, "commit", "-m", "E2E task-side conflict"],
      { env: gitEnvironment },
    );
    const primaryContents = "primary-side conflict\n";
    await writeFile(join(fixture.folder, "README.md"), primaryContents);
    await execFileAsync("git", ["-C", fixture.folder, "add", "README.md"], {
      env: gitEnvironment,
    });
    await execFileAsync(
      "git",
      ["-C", fixture.folder, "commit", "-m", "E2E primary-side conflict"],
      { env: gitEnvironment },
    );

    await selectState(page, "Implement");
    await selectState(page, "Review");
    await selectState(page, "Done");

    await expect.poll(async () => (
      await graphql(request, WorktreeStatusDocument, {
        taskId: fixture.landingConflict.id,
      })
    ).worktree_status.kind, { timeout: 20_000 }).toBe("worktree");
    await expect(worktree).toContainText(
      "completion leaves this worktree unchanged",
    );
    expect(await readFile(join(status.path!, "README.md"), "utf8"))
      .toBe("task-side conflict\n");
    expect(await readFile(join(fixture.folder, "README.md"), "utf8"))
      .toBe(primaryContents);
    await expect.poll(async () => {
      try {
        await access(join(fixture.folder, ".git", "MERGE_HEAD"));
        return true;
      } catch {
        return false;
      }
    }).toBe(false);

  });

  test("keeps uncommitted work when a Story reaches Done", async ({
    page,
    request,
  }) => {
    test.setTimeout(45_000);
    await openModule(page, names.module);
    await openWorkItem(page, names.landingDirty);
    const worktree = page.getByTestId("worktree-block");
    const created = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName === "WorktreeCreate"
    );
    await worktree.getByRole("button", { name: "+ Create worktree" }).click();
    await created;
    const status = (await graphql(request, WorktreeStatusDocument, {
      taskId: fixture.landingDirty.id,
    })).worktree_status;
    expect(status.path).toBeTruthy();
    const protectedName = "uncommitted-retained-e2e.txt";
    const protectedContents = "Uncommitted work must survive completion.\n";
    await writeFile(join(status.path!, protectedName), protectedContents);

    await page.reload();
    await expect(worktree).toContainText("dirty");
    await selectState(page, "Implement");
    await selectState(page, "Review");
    await selectState(page, "Done");
    const retainedStatus = (await graphql(request, WorktreeStatusDocument, {
      taskId: fixture.landingDirty.id,
    })).worktree_status;
    expect(retainedStatus).toMatchObject({
      kind: "worktree",
      dirty: true,
      checkout_present: true,
    });
    expect(await readFile(join(status.path!, protectedName), "utf8"))
      .toBe(protectedContents);
    await expect.poll(async () => {
      try {
        await access(join(fixture.folder, protectedName));
        return true;
      } catch {
        return false;
      }
    }).toBe(false);
    await expect(worktree).toContainText("dirty");
    await expect(worktree.getByRole("button", { name: "Discard" })).toBeVisible();

    await worktree.getByRole("button", { name: "Discard" }).click();
    await worktree.getByRole("button", { name: "Yes, discard" }).click();
    await expect(worktree).toContainText("Runs in the primary checkout.");
    await expect.poll(async () => {
      try {
        await access(status.path!);
        return true;
      } catch {
        return false;
      }
    }).toBe(false);
  });

  test("keeps a non-Git module usable without offering false worktree isolation", async ({
    page,
  }) => {
    await openModule(page, names.nonRepoModule);
    await openWorkItem(page, names.nonRepoItem);
    const worktree = page.getByTestId("worktree-block");
    await expect(worktree).toContainText(
      "Changes are not isolated — no git repo encloses this task's path",
    );
    await expect(worktree).toContainText("Runs work directly in the path.");
    await expect(worktree.getByRole("button", { name: "+ Create worktree" }))
      .toHaveCount(0);
    await expect(worktree.getByRole("button", { name: "Discard" }))
      .toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.nonRepoItem);
    await expect(page.getByTestId("worktree-block")).toContainText(
      "Changes are not isolated",
    );
  });

  test("renders an attachment created through the Rust MCP", async ({
    page,
    request,
  }) => {
    const result = await callMcpTool<{ success?: boolean }>(
      request,
      1,
      "attach_file",
      {
        project_id: fixture.project.id,
        task_id: fixture.parent.id,
        file_path: fixture.attachmentPath,
      },
    );
    expect(result.success).toBe(true);

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    const attachments = page.getByTestId("attachments");
    await expect(attachments).toContainText("Attachments1");
    const attachment = attachments.getByRole("link", {
      name: /e2e-implementation-notes\.md/,
    });
    await expect(attachment).toBeVisible();
    await expect(attachment).toContainText(
      `${Buffer.byteLength(attachmentContents)} B`,
    );
    await expect(attachment).toHaveAttribute(
      "href",
      /worktracker\/attachments\/e2e-implementation-notes\.md$/,
    );

    await page.reload();
    await expect(page.getByTestId("attachments").getByRole("link", {
      name: /e2e-implementation-notes\.md/,
    })).toContainText(`${Buffer.byteLength(attachmentContents)} B`);
  });

  test("rejects a missing MCP attachment without creating a phantom row", async ({
    page,
    request,
  }) => {
    const result = await callMcpTool<{
      success?: boolean;
      message?: string;
      data?: unknown;
    }>(request, 16, "attach_file", {
      project_id: fixture.project.id,
      task_id: fixture.parent.id,
      file_path: join(fixture.folder, "missing-e2e-evidence.txt"),
    });
    expect(result).toEqual({
      success: false,
      message: "File not found",
      data: null,
    });

    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    await expect(page.getByTestId("attachments").getByTestId("attachment-row"))
      .toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("attachments").getByTestId("attachment-row"))
      .toHaveCount(1);
  });

  test("converges an ordinary MCP task edit and workflow move into the open UI", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);
    const changedName = "MCP-updated moving task";
    const changedDescription = "Description replaced through the Rust MCP.";

    const updated = await callMcpTool<{
      ok?: boolean;
      updated_fields?: string[];
    }>(request, 3, "update_task", {
      id_or_key: fixture.moving.id,
      name: changedName,
      description: changedDescription,
    });
    expect(updated).toMatchObject({
      ok: true,
      updated_fields: ["name", "description"],
    });
    await expect(page.getByTestId("issue-name")).toContainText(changedName);
    await expect(page.getByTestId("issue-description"))
      .toContainText(changedDescription);
    await expect(page.getByRole("treeitem", { name: changedName })).toBeVisible();

    const moved = await callMcpTool<{ ok?: boolean; status?: string }>(
      request,
      4,
      "update_task_status",
      {
        project_id: fixture.project.id,
        task_id: fixture.moving.id,
        status_name: "Grill",
      },
    );
    expect(moved).toMatchObject({ ok: true, status: "Grill" });
    await expect(page.getByTestId("status-row")).toContainText("Grill");
    await expect(page.getByRole("treeitem", { name: changedName })).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(changedName);
    await expect(page.getByTestId("issue-description"))
      .toContainText(changedDescription);
    await expect(page.getByTestId("status-row")).toContainText("Grill");

    const restored = await callMcpTool<{ ok?: boolean }>(
      request,
      5,
      "update_task",
      {
        id_or_key: fixture.moving.id,
        name: names.moving,
        description: "",
      },
    );
    expect(restored.ok).toBe(true);
    const restoredState = await callMcpTool<{ ok?: boolean; status?: string }>(
      request,
      6,
      "update_task_status",
      {
        project_id: fixture.project.id,
        task_id: fixture.moving.id,
        status_name: "Ideas",
      },
    );
    expect(restoredState).toMatchObject({ ok: true, status: "Ideas" });
    await expect(page.getByTestId("issue-name")).toContainText(names.moving);
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
  });

  test("appends MCP description content without replacing the human-authored body", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);
    const baseline = "Human-authored baseline retained by append.";
    const appended = "Agent-appended Rust MCP note.";
    await editDescription(page, baseline);

    const result = await callMcpTool<{ result?: boolean }>(
      request,
      14,
      "append_task_description",
      {
        project_id: fixture.project.id,
        task_id: fixture.moving.id,
        new_content: appended,
      },
    );
    expect(result.result).toBe(true);
    await expect(page.getByTestId("issue-description")).toContainText(baseline);
    await expect(page.getByTestId("issue-description")).toContainText(appended);

    await page.reload();
    await expect(page.getByTestId("issue-description")).toContainText(baseline);
    await expect(page.getByTestId("issue-description")).toContainText(appended);

    const restored = await callMcpTool<{ ok?: boolean }>(
      request,
      15,
      "update_task",
      {
        id_or_key: fixture.moving.id,
        description: "",
      },
    );
    expect(restored.ok).toBe(true);
    await expect(page.getByTestId("issue-description")).not.toContainText(appended);
  });

  test("keeps a human-only workflow edge closed to the Rust MCP agent", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);
    await selectState(page, "Spec");
    await selectState(page, "Tickets");

    const refused = await callMcpTool<{
      ok?: boolean;
      code?: string;
      detail?: string;
      from?: string;
      to?: string;
    }>(request, 11, "update_task_status", {
      project_id: fixture.project.id,
      task_id: fixture.moving.id,
      status_name: "Implement",
    });
    expect(refused).toMatchObject({
      ok: false,
      code: "human_only_transition",
      from: "Tickets",
      to: "Implement",
    });
    expect(refused.detail).toMatch(/human-only/i);
    await expect(page.getByTestId("status-row")).toContainText("Tickets");

    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Tickets");

    // The same edge remains available to an explicit human action in Studio.
    await selectState(page, "Implement");
    await selectState(page, "Grill");
    await selectState(page, "Ideas");
    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
  });

  test("streams an MCP-created root Story into the module and deletes it through UI", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    const createdName = "Root Story created through MCP";
    const createdDescription = "Created outside the UI through the Rust MCP.";
    const created = await callMcpTool<{ result?: string }>(
      request,
      7,
      "create_task",
      {
        project_id: fixture.project.id,
        module_id: fixture.module.id,
        name: createdName,
        issue_type: "Story",
        description: createdDescription,
      },
    );
    expect(created.result).toBeTruthy();

    const row = page.getByRole("treeitem", { name: createdName });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("issue-name")).toContainText(createdName);
    await expect(page.getByTestId("issue-description"))
      .toContainText(createdDescription);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(createdName);
    await expect(page.getByTestId("issue-description"))
      .toContainText(createdDescription);

    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete issue" });
    await expect(dialog).toContainText(createdName);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("treeitem", { name: createdName })).toHaveCount(0);
  });

  test("streams MCP sub-task creation and partial reparenting into the open hierarchy", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.hierarchyParent);
    const childName = "MCP-created hierarchy child";
    const childDescription = "Created and reparented through the Rust MCP.";
    const created = await callMcpTool<{ result?: string }>(
      request,
      17,
      "create_sub_task",
      {
        project_id: fixture.project.id,
        parent_id: fixture.hierarchyParent.id,
        name: childName,
        issue_type: "Implementation",
        description: childDescription,
      },
    );
    expect(created.result).toBeTruthy();

    const originalChildren = page.getByTestId("child-issues");
    await expect(originalChildren).toContainText(childName);
    await originalChildren.getByRole("button", {
      name: new RegExp(childName),
    }).click();
    await expect(page.getByTestId("issue-description"))
      .toContainText(childDescription);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(fixture.hierarchyParent.key);

    const refusedCycle = await callMcpTool<{
      reparented?: unknown[];
      skipped?: unknown[];
      failed?: Array<{ task_id?: string; error?: string }>;
    }>(request, 18, "reparent_tasks", {
      project_id: fixture.project.id,
      parent_task_id: created.result,
      task_ids: [fixture.hierarchyParent.id],
    });
    expect(refusedCycle).toMatchObject({
      reparented: [],
      skipped: [],
      failed: [{
        task_id: fixture.hierarchyParent.id,
        error: expect.stringMatching(/beneath its descendant/i),
      }],
    });
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(fixture.hierarchyParent.key);

    await openWorkItem(page, names.hierarchyParent);
    const missingKey = "CDN-999999";
    const partiallyReparented = await callMcpTool<{
      parent_task_id?: string;
      reparented?: Array<{ task_id?: string; previous_parent_id?: string }>;
      skipped?: Array<{ task_id?: string; reason?: string }>;
      failed?: unknown[];
    }>(request, 19, "reparent_tasks", {
      project_id: fixture.project.id,
      parent_task_id: fixture.blocker.id,
      task_ids: [created.result, missingKey],
    });
    expect(partiallyReparented).toMatchObject({
      parent_task_id: fixture.blocker.id,
      reparented: [{
        task_id: created.result,
        previous_parent_id: fixture.hierarchyParent.id,
      }],
      skipped: [{ task_id: missingKey, reason: "not_found" }],
      failed: [],
    });
    await expect(originalChildren).not.toContainText(childName);

    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("child-issues")).toContainText(childName);
    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    const restoredChildren = page.getByTestId("child-issues");
    await expect(restoredChildren).toContainText(childName);
    await restoredChildren.getByRole("button", {
      name: new RegExp(childName),
    }).click();
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(fixture.blocker.key);

    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete issue" });
    await expect(dialog).toContainText(childName);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("treeitem", { name: childName })).toHaveCount(0);
  });

  test("persists, guards, and clears an MCP blocker edge in both visible directions", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);

    const blocked = await callMcpTool<{
      task_id?: string;
      blocked_by_ids?: string[];
      blocks_ids?: string[];
    }>(request, 8, "set_task_blockers", {
      task_id: fixture.moving.id,
      blocked_by_ids: [fixture.blocker.id],
    });
    expect(blocked).toMatchObject({
      task_id: fixture.moving.id,
      blocked_by_ids: [fixture.blocker.id],
    });

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.moving);
    await expect(page.getByTestId("blocked-by-row"))
      .toContainText(fixture.blocker.key);
    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("blocks-row"))
      .toContainText(fixture.moving.key);

    const refusedCycle = await callMcpTool<{
      task_id?: string;
      error?: string;
    }>(request, 9, "set_task_blockers", {
      task_id: fixture.blocker.id,
      blocked_by_ids: [fixture.moving.id],
    });
    expect(refusedCycle.task_id).toBe(fixture.blocker.id);
    expect(refusedCycle.error).toMatch(/cycle/i);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    await expect(page.getByTestId("blocked-by-row").getByTestId("blocker-chip"))
      .toHaveCount(0);
    await expect(page.getByTestId("blocks-row"))
      .toContainText(fixture.moving.key);

    const cleared = await callMcpTool<{
      task_id?: string;
      blocked_by_ids?: string[];
    }>(request, 10, "set_task_blockers", {
      task_id: fixture.moving.id,
      blocked_by_ids: [],
    });
    expect(cleared).toMatchObject({
      task_id: fixture.moving.id,
      blocked_by_ids: [],
    });

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    await expect(page.getByTestId("blocks-row")).toHaveCount(0);
    await openWorkItem(page, names.moving);
    await expect(page.getByTestId("blocked-by-row").getByTestId("blocker-chip"))
      .toHaveCount(0);
  });

  test("rejects malformed and out-of-phase MCP review findings without creating children", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
    await expect(page.getByTestId("child-issues"))
      .toContainText("No sub-tasks yet.");

    const malformed = await callMcpTool<{
      ok?: boolean;
      code?: string;
      field?: string;
    }>(request, 12, "create_review_finding", {
      project_id: fixture.project.id,
      parent_id: fixture.parent.id,
      name: "Malformed MCP finding",
      path: "../outside-the-repository.rs",
      line_start: 0,
      line_end: 0,
    });
    expect(malformed).toMatchObject({
      ok: false,
      code: "malformed_path",
      field: "path",
    });

    const wrongPhase = await callMcpTool<{
      ok?: boolean;
      code?: string;
      field?: string;
    }>(request, 13, "create_review_finding", {
      project_id: fixture.project.id,
      parent_id: fixture.parent.id,
      name: "Out-of-phase MCP finding",
      path: "studio/src/runtime/browserRuntime.ts",
      line_start: 1,
      line_end: 1,
    });
    expect(wrongPhase).toMatchObject({
      ok: false,
      code: "invalid_review_parent",
      field: "parent_id",
    });

    await expect(page.getByTestId("child-issues"))
      .toContainText("No sub-tasks yet.");
    await expect(page.getByTestId("findings-panel")).toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: "Malformed MCP finding" }))
      .toHaveCount(0);
    await expect(page.getByRole("treeitem", { name: "Out-of-phase MCP finding" }))
      .toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("child-issues"))
      .toContainText("No sub-tasks yet.");
  });

  test("streams an MCP review finding into the visible Story", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    for (const state of ["Grill", "Spec", "Tickets", "Implement", "Review"]) {
      await selectState(page, state);
    }

    const result = await callMcpTool<{ ok?: boolean; task_id?: string }>(
      request,
      2,
      "create_review_finding",
      {
        project_id: fixture.project.id,
        parent_id: fixture.parent.id,
        name: "MCP integration finding",
        path: "studio/src/runtime/browserRuntime.ts",
        line_start: 47,
        line_end: 52,
        note: "Verify the browser adapter lifecycle boundary.",
      },
    );
    expect(result.ok).toBe(true);
    expect(result.task_id).toBeTruthy();

    const findings = page.getByTestId("findings-panel");
    await expect(findings).toContainText("MCP integration finding");
    await expect(findings.getByTestId("finding-location")).toHaveText(
      "studio/src/runtime/browserRuntime.ts:47-52",
    );
    await expect(findings.getByTestId("findings-queued-count"))
      .toHaveText("1 fix queued");

    await page.reload();
    const restored = page.getByTestId("findings-panel");
    await expect(restored).toContainText("MCP integration finding");
    await expect(restored.getByTestId("finding-state")).toHaveText("Implement");

    await restored.getByTestId("finding-row").getByRole("button").first().click();
    await expect(page.getByTestId("issue-name"))
      .toContainText("MCP integration finding");
    await expect(page.getByTestId("issue-description"))
      .toContainText("Path: studio/src/runtime/browserRuntime.ts");
    await expect(page.getByTestId("issue-description")).toContainText("Lines: 47-52");

    await openWorkItem(page, names.parent);
    const restoredParent = page.getByTestId("findings-panel");
    await restoredParent.getByTestId("finding-cancel").click();
    await expect(restoredParent.getByTestId("finding-state"))
      .toHaveText("Cancelled");
    await expect(restoredParent.getByTestId("findings-queued-count"))
      .toHaveText("0 fixes queued");
    await expect(restoredParent.getByTestId("finding-cancel")).toHaveCount(0);
  });

  test("edits details, hierarchy, blockers, type, and persistent panel state", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parent);

    await page.getByTestId("issue-name").click();
    let nameEditor = page.getByRole("textbox", { name: "Name" });
    await nameEditor.fill("Name edit that must be discarded");
    await nameEditor.press("Escape");
    await expect(page.getByTestId("issue-name")).toContainText(names.parent);
    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.parent);

    await page.getByTestId("issue-name").click();
    nameEditor = page.getByRole("textbox", { name: "Name" });
    await nameEditor.fill(names.parentRenamed);
    await nameEditor.press("Enter");
    await expect(page.getByRole("treeitem", {
      name: new RegExp(names.parentRenamed),
    })).toBeVisible();
    await editDescription(page, "Description saved through the real editor");

    await page.getByTestId("issue-description").click();
    const descriptionEditor = page.getByTestId("description-editor");
    const source = page.getByRole("textbox", {
      name: "Ticket description source",
    });
    if (await source.isVisible().catch(() => false)) {
      await source.fill("Description that must be discarded");
    } else {
      await descriptionEditor.locator('[contenteditable="true"]')
        .fill("Description that must be discarded");
    }
    await descriptionEditor.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("issue-description")).toContainText(
      "Description saved through the real editor",
    );
    await page.reload();
    await expect(page.getByTestId("issue-description")).toContainText(
      "Description saved through the real editor",
    );
    await expect(page.getByTestId("issue-description")).not.toContainText(
      "Description that must be discarded",
    );

    const typePicker = page.getByTestId("issue-type-picker");
    await typePicker.getByRole("button").click();
    await page.getByRole("button", {
      name: "Implementation",
      exact: true,
    }).click();
    await expect(typePicker.getByRole("button")).toContainText("Implementation");
    await typePicker.getByRole("button").click();
    await page.getByRole("button", { name: "Story", exact: true }).click();
    await expect(typePicker.getByRole("button")).toContainText("Story");

    await page.getByRole("combobox", { name: "Child issue type" })
      .selectOption({ label: "Implementation" });
    const addSubtask = page.getByPlaceholder("Add sub-task…");
    await addSubtask.fill("Child created through details");
    await addSubtask.press("Enter");
    await expect(page.getByTestId("child-issues")).toContainText(
      "Child created through details",
    );

    const parentPicker = page.getByTestId("parent-picker");
    await parentPicker.getByRole("button").click();
    await page.getByPlaceholder("Search by number, key, or name…")
      .fill("Child created through details");
    await expect(page.getByText("No matches.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    const actions = page.getByRole("button", { name: "Issue actions" });
    await actions.click();
    const guardedDelete = page.getByRole("menuitem", {
      name: "Delete issue…",
    });
    await expect(guardedDelete).toBeDisabled();
    await expect(guardedDelete).toHaveAttribute(
      "title",
      "Remove sub-tasks first",
    );
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();

    await page.getByRole("button", { name: "Add blocker" }).click();
    await page.getByRole("button", { name: new RegExp(names.blocker) }).click();
    await expect(page.getByTestId("blocked-by-row")).toContainText(
      fixture.blocker.key,
    );

    await page.getByTestId("blocked-by-row").getByRole("button", {
      name: fixture.blocker.key,
    }).click();
    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    await expect(page.getByTestId("blocks-row")).toContainText(
      fixture.parent.key,
    );
    await page.getByRole("treeitem", {
      name: new RegExp(names.parentRenamed),
    }).click();
    const blockerRemoved = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "SetWorkTrackerBlockers"
    );
    await page.getByRole("button", { name: "Remove blocker" }).click();
    await blockerRemoved;
    await expect(page.getByTestId("blocked-by-row")).not.toContainText(
      fixture.blocker.key,
    );

    await page.getByRole("treeitem", { name: names.blocker }).click();
    await page.reload();
    await expect(page.getByTestId("blocks-row").getByTestId("blocker-chip"))
      .toHaveCount(0);
    await page.getByRole("treeitem", {
      name: new RegExp(names.parentRenamed),
    }).click();

    await page.getByRole("button", { name: "Hide details panel" }).click();
    await expect(page.getByTestId("details-panel")).toHaveCount(0);
    await page.reload();
    if (await page.getByTestId("issue-sidebar-toggle").count() === 0) {
      await openWorkItem(page, names.parentRenamed);
    }
    await expect(page.getByRole("button", { name: "Show details panel" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Show details panel" }).click();
    await expect(page.getByTestId("details-panel")).toBeVisible();
  });

  test("moves a child between task and module parents and restores it after reload", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);

    const chooseParent = async (name: string): Promise<void> => {
      const picker = page.getByTestId("parent-picker");
      await picker.getByRole("button").click();
      await page.getByPlaceholder("Search by number, key, or name…").fill(name);
      const saved = page.waitForResponse((response) =>
        response.url().endsWith("/graphql") &&
        response.request().postDataJSON()?.operationName ===
          "ReparentWorkTrackerWorkItem"
      );
      await picker.getByRole("button", { name: new RegExp(name) }).click();
      await saved;
    };

    await chooseParent(names.blocker);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(fixture.blocker.key);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.moving);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(fixture.blocker.key);
    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("child-issues")).toContainText(names.moving);

    await page.getByTestId("child-issues").getByRole("button", {
      name: new RegExp(names.moving),
    }).click();
    await chooseParent(names.module);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(`T-${fixture.module.sequence_id}`);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.moving);
    await expect(page.getByTestId("parent-picker").getByRole("button"))
      .toHaveText(`T-${fixture.module.sequence_id}`);
    await openWorkItem(page, names.blocker);
    await expect(page.getByTestId("child-issues")).not.toContainText(names.moving);
  });

  test("reorders rows and preserves collapsed groups", async ({
    page,
  }) => {
    await openModule(page, names.module);

    const first = page.getByRole("treeitem", { name: names.reorderFirst });
    const second = page.getByRole("treeitem", { name: names.reorderSecond });
    const target = await first.boundingBox();
    expect(target).toBeTruthy();
    await second.dragTo(first, {
      targetPosition: { x: target!.width / 2, y: 2 },
    });
    await expect.poll(async () => {
      const labels = await page.getByRole("treeitem").allTextContents();
      return labels.findIndex((label) => label.includes(names.reorderSecond))
        < labels.findIndex((label) => label.includes(names.reorderFirst));
    }).toBe(true);

    await page.getByRole("button", { name: "Collapse Ideas" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand Ideas" })).toBeVisible();
    await page.getByRole("button", { name: "Expand Ideas" }).click();
    await expect(page.getByRole("treeitem", { name: names.reorderFirst })).toBeVisible();

    const labelsAfterReload = await page.getByRole("treeitem").allTextContents();
    expect(labelsAfterReload.findIndex((label) =>
      label.includes(names.reorderSecond)
    )).toBeLessThan(labelsAfterReload.findIndex((label) =>
      label.includes(names.reorderFirst)
    ));
  });

  test("resizes adjacent panes and persists the split", async ({ page }) => {
    await openModule(page, names.module);
    const handle = page.getByTestId("module-workspace-region")
      .getByTestId("pane-resize-handle");
    await expect(handle).toBeVisible();
    await expect(handle).toHaveAttribute("role", "separator");
    await expect(handle).toHaveAttribute("aria-label", "Resize adjacent panes");
    const before = Number(await handle.getAttribute("aria-valuenow"));
    const box = await handle.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 90, box!.y + box!.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => Number(
      await handle.getAttribute("aria-valuenow"),
    )).not.toBe(before);
    const resized = Number(await handle.getAttribute("aria-valuenow"));

    await page.waitForTimeout(650);
    await page.reload();
    const restored = Number(
      await page.getByTestId("module-workspace-region")
        .getByTestId("pane-resize-handle")
        .getAttribute("aria-valuenow"),
    );
    expect(Math.abs(restored - resized)).toBeLessThanOrEqual(1);
  });

  test("persists and restores Modules pane visibility", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await ensureModulesPane(page);
    const toggle = page.getByTestId("modules-pane-toggle");
    await expect(page.getByTestId("pane-modules")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await toggle.click();
    await expect(page.getByTestId("pane-modules")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await page.reload();
    await expect(page.getByTestId("pane-modules")).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(page.getByTestId("pane-modules")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("focuses story search with a shortcut and returns to the tree", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("/");
    const search = page.getByRole("textbox", { name: "Search stories" });
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tree")).toBeFocused();
  });

  test("opens keyboard shortcut help directly with question mark", async ({
    page,
  }) => {
    await openModule(page, names.module);
    const trigger = page.getByRole("button", { name: "Open Settings" });
    await trigger.focus();
    await page.keyboard.press("?");

    const dialog = page.getByRole("dialog", { name: "Studio settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab", { name: "Keyboard shortcuts" }))
      .toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("heading", { name: "Keyboard shortcuts" }))
      .toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("opens the status command by keyboard, cancels, then persists a choice", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.reorderFirst);
    const status = page.getByTestId("status-row");
    await expect(status).toContainText("Ideas");

    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("s");
    let dialog = page.getByRole("dialog", { name: "Set Status" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(status).toContainText("Ideas");

    await page.keyboard.press("s");
    dialog = page.getByRole("dialog", { name: "Set Status" });
    await dialog.getByText("Grill", { exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(status).toContainText("Grill");

    const grill = fixture.states.find((state) => state.name === "Grill");
    expect(grill?.color).toBeTruthy();
    const expectedColor = await page.evaluate((color) => {
      const probe = document.createElement("span");
      probe.style.color = color!;
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    }, grill!.color);
    const grillHeader = page.getByRole("button", { name: "Collapse Grill" });
    await expect(grillHeader).toBeVisible();
    expect(await grillHeader.locator('[data-stage-icon="Grill"]').evaluate(
      (element) => getComputedStyle(element).color,
    )).toBe(expectedColor);
    const movedRow = page.getByRole("treeitem", { name: names.reorderFirst });
    expect(await movedRow.getByText(`T-${fixture.reorderFirst.sequence_id}`, {
      exact: true,
    }).evaluate((element) => getComputedStyle(element).color)).toBe(expectedColor);
    expect(await page.getByTestId("state-picker").locator("span").first()
      .evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe(expectedColor);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.reorderFirst);
    await expect(page.getByTestId("status-row")).toContainText("Grill");

    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("s");
    dialog = page.getByRole("dialog", { name: "Set Status" });
    await dialog.getByText("Ideas", { exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
  });

  test("reorders the state catalog through Rust and regroups the open tree", async ({
    page,
    request,
  }) => {
    const seeded = [...fixture.states]
      .sort((left, right) => left.sort_order - right.sort_order);
    const seededNames = new Set(seeded.map((state) => state.name));
    const headerOrder = () => page
      .locator('button[aria-label^="Collapse "], button[aria-label^="Expand "]')
      .evaluateAll((buttons) => buttons.map((button) =>
        (button.getAttribute("aria-label") ?? "")
          .replace(/^(?:Collapse|Expand) /, "")
      ))
      .then((labels) => labels.filter((label) => seededNames.has(label)));
    const reorder = (order: typeof seeded) =>
      graphql(request, ReorderWorkTrackerStatesDocument, {
        projectId: fixture.project.id,
        orderedIds: order.map((state) => state.id),
      });

    await openModule(page, names.module);
    await expect.poll(headerOrder).toEqual(seeded.map((state) => state.name));

    // Rotate the tail state to the front: an arrangement no other test leaves.
    const rotated = [seeded[seeded.length - 1]!, ...seeded.slice(0, -1)];
    try {
      const reordered = (await reorder(rotated)).reorder_states;
      // Reorder replaces the whole project-owned ordering, so every row is
      // renumbered contiguously rather than only the state that moved.
      expect([...reordered]
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((state) => [state.name, state.sort_order]))
        .toEqual(rotated.map((state, index) => [state.name, index]));

      // Each reordered row is published as a durable fact carrying the whole
      // state, so the open tree regroups without a refetch or a reload.
      await expect.poll(headerOrder).toEqual(rotated.map((state) => state.name));
      await page.reload();
      await expect.poll(headerOrder).toEqual(rotated.map((state) => state.name));
    } finally {
      await reorder(seeded);
    }

    await page.reload();
    await expect.poll(headerOrder).toEqual(seeded.map((state) => state.name));
  });

  test("refuses a Story move outside the published workflow until an edge exists", async ({
    page,
    request,
  }) => {
    const startStateId = fixture.storyType.start_state as string | null;
    const origin = fixture.states.find((state) => state.id === startStateId);
    expect(origin, "the Story start state").toBeTruthy();
    const parkingName = "E2E Parking";
    const probeName = "Complete workflow probe";

    const parking = (await graphql(request, CreateWorkTrackerStateDocument, {
      projectId: fixture.project.id,
      name: parkingName,
      group: "unstarted",
      color: "#7C3AED",
    })).create_state;
    const probe = await createWorkItem(request, fixture.project.id, {
      name: probeName,
      issue_type_id: fixture.storyType.id,
      parent_id: fixture.module.id,
    });

    /** The Story workflow revision every guarded write has to present. */
    const workflowRevision = async (): Promise<number> => {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const story = catalog.issue_types.nodes.find((issueType) =>
        issueType.id === fixture.storyType.id
      );
      expect(story, "the seeded Story issue type").toBeTruthy();
      return story!.workflow_revision;
    };
    const attemptMoveToParking = async (): Promise<void> => {
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("s");
      const dialog = page.getByRole("dialog", { name: "Set Status" });
      await expect(dialog).toBeVisible();
      await dialog.getByText(parkingName, { exact: true }).click();
    };

    try {
      await openModule(page, names.module);
      // The create fact carries the whole row, so the new section appears in
      // the open tree without a reload.
      await expect(page.getByRole("button", { name: `Collapse ${parkingName}` }))
        .toBeVisible();
      await openWorkItem(page, probeName);
      await expect(page.getByTestId("status-row")).toContainText(origin!.name);

      // No published edge reaches the new state, so Rust refuses the move and
      // the visible status stays where it was.
      await attemptMoveToParking();
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(page.getByTestId("status-row")).toContainText(origin!.name);
      expect((await getWorkItem(request, probe.id)).state_id).toBe(origin!.id);

      for (const edge of [
        { fromStateId: origin!.id, toStateId: parking.id },
        { fromStateId: parking.id, toStateId: origin!.id },
      ]) {
        await graphql(request, CreateWorkTrackerTransitionDocument, {
          issueTypeId: fixture.storyType.id,
          agentAllowed: false,
          workflowRevision: await workflowRevision(),
          ...edge,
        });
      }

      await page.reload();
      await openWorkItem(page, probeName);
      await attemptMoveToParking();
      await expect(page.getByTestId("status-row")).toContainText(parkingName);
      await expect
        .poll(async () => (await getWorkItem(request, probe.id)).state_id)
        .toBe(parking.id);

      // Withdrawing the state from the workflow closes both edges again.
      await selectState(page, origin!.name);
      await graphql(request, RemoveWorkTrackerWorkflowStateDocument, {
        issueTypeId: fixture.storyType.id,
        stateId: parking.id,
        workflowRevision: await workflowRevision(),
      });

      await page.reload();
      await openWorkItem(page, probeName);
      await attemptMoveToParking();
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(page.getByTestId("status-row")).toContainText(origin!.name);
      expect((await getWorkItem(request, probe.id)).state_id).toBe(origin!.id);
    } finally {
      await graphql(request, DeleteWorkTrackerWorkItemDocument, { id: probe.id });
      await graphql(request, DeleteWorkTrackerStateDocument, { id: parking.id });
    }

    await page.reload();
    await expect(page.getByRole("button", { name: `Collapse ${parkingName}` }))
      .toHaveCount(0);
  });

  test("reorders issue types through Rust and reorders the visible type picker", async ({
    page,
    request,
  }) => {
    const catalog = await getWorkflowCatalog(request, fixture.project.id);
    const seeded = [...catalog.issue_types.nodes]
      .sort((left, right) => left.sort_order - right.sort_order);
    expect(seeded.length).toBeGreaterThan(1);
    const taskTypeNames = seeded
      .filter((issueType) => issueType.level === "task")
      .map((issueType) => issueType.name);
    expect(taskTypeNames.length).toBeGreaterThan(1);
    const reorder = (order: typeof seeded) =>
      graphql(request, ReorderWorkTrackerIssueTypesDocument, {
        projectId: fixture.project.id,
        orderedIds: order.map((issueType) => issueType.id),
      });
    const pickerOrder = async (): Promise<string[]> => {
      const picker = page.getByTestId("issue-type-picker");
      await picker.getByRole("button").first().click();
      const labels = await picker.getByRole("button").allTextContents();
      await page.keyboard.press("Escape");
      return labels
        .map((label) => label.trim())
        .filter((label) => taskTypeNames.includes(label));
    };

    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);
    // The trigger repeats the selected type, so compare the tail of the list.
    expect((await pickerOrder()).slice(-taskTypeNames.length))
      .toEqual(taskTypeNames);

    // Rotate the whole project-owned set; the picker reads only task levels.
    const rotated = [seeded[seeded.length - 1]!, ...seeded.slice(0, -1)];
    const rotatedTaskNames = rotated
      .filter((issueType) => issueType.level === "task")
      .map((issueType) => issueType.name);
    try {
      const reordered = (await reorder(rotated)).reorder_issue_types;
      expect([...reordered]
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((issueType) => [issueType.name, issueType.sort_order]))
        .toEqual(rotated.map((issueType, index) => [issueType.name, index]));

      // The catalog read is cache-first, so a fresh client proves persistence.
      await page.reload();
      await openWorkItem(page, names.blocker);
      expect((await pickerOrder()).slice(-rotatedTaskNames.length))
        .toEqual(rotatedTaskNames);
    } finally {
      await reorder(seeded);
    }

    await page.reload();
    await openWorkItem(page, names.blocker);
    expect((await pickerOrder()).slice(-taskTypeNames.length))
      .toEqual(taskTypeNames);
  });

  test("renames and recolours a state through Rust and converges the open tree", async ({
    page,
    request,
  }) => {
    const original = [...fixture.states]
      .sort((left, right) => left.sort_order - right.sort_order)
      .at(-1);
    expect(original, "the last seeded state").toBeTruthy();
    const renamed = "E2E Shelved";
    const recolour = "#7C3AED";
    const header = (stateName: string) =>
      page.getByRole("button", { name: `Collapse ${stateName}` });
    const iconColour = async (stateName: string): Promise<string> => {
      const icon = header(stateName).locator(`[data-stage-icon="${stateName}"]`);
      return await icon.evaluate((element) => getComputedStyle(element).color);
    };
    const asComputed = (colour: string) => page.evaluate((value) => {
      const probe = document.createElement("span");
      probe.style.color = value;
      document.body.append(probe);
      const computed = getComputedStyle(probe).color;
      probe.remove();
      return computed;
    }, colour);

    await openModule(page, names.module);
    await expect(header(original!.name)).toBeVisible();

    try {
      const updated = (await graphql(request, UpdateWorkTrackerStateDocument, {
        id: original!.id,
        name: renamed,
        color: recolour,
      })).update_state;
      expect(updated).toMatchObject({ name: renamed, color: recolour });

      // One updated fact carries the whole row, so the section is renamed and
      // recoloured in place — it must not appear twice or leave a stale header.
      await expect(header(renamed)).toBeVisible();
      await expect(header(renamed)).toHaveCount(1);
      await expect(header(original!.name)).toHaveCount(0);
      expect(await iconColour(renamed)).toBe(await asComputed(recolour));

      await page.reload();
      await expect(header(renamed)).toHaveCount(1);
      await expect(header(original!.name)).toHaveCount(0);
    } finally {
      await graphql(request, UpdateWorkTrackerStateDocument, {
        id: original!.id,
        name: original!.name,
        color: original!.color,
      });
    }

    await page.reload();
    await expect(header(original!.name)).toHaveCount(1);
    await expect(header(renamed)).toHaveCount(0);
  });

  test("creates an issue type, moves its start state, and deletes it by reassigning", async ({
    page,
    request,
  }) => {
    const byName = (stateName: string) => {
      const state = fixture.states.find((row) => row.name === stateName);
      expect(state, `the seeded ${stateName} state`).toBeTruthy();
      return state!;
    };
    const ideas = byName("Ideas");
    const grill = byName("Grill");
    const typeName = "E2E Chore";
    const firstItem = "Complete chore before the move";
    const secondItem = "Complete chore after the move";

    const chore = (await graphql(request, CreateWorkTrackerIssueTypeDocument, {
      projectId: fixture.project.id,
      name: typeName,
      level: "task",
      color: "#0EA5E9",
    })).create_issue_type;
    expect(chore).toMatchObject({ name: typeName, level: "task" });
    // A fresh type publishes no workflow, so it starts with no start state.
    expect(chore.start_state).toBeNull();

    const revision = async (): Promise<number> => {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const row = catalog.issue_types.nodes.find((issueType) =>
        issueType.id === chore.id
      );
      expect(row, `the ${typeName} issue type`).toBeTruthy();
      return row!.workflow_revision;
    };
    const createChore = (name: string) => createWorkItem(
      request,
      fixture.project.id,
      { name, issue_type_id: chore.id, parent_id: fixture.module.id },
    );
    const sectionFor = (name: string) => page.evaluate((itemName) => {
      const rows = Array.from(document.querySelectorAll(
        '[role="tree"] li, [role="tree"] [role="treeitem"]',
      ));
      const index = rows.findIndex((row) =>
        row.getAttribute("role") === "treeitem" &&
        (row.textContent ?? "").includes(itemName)
      );
      if (index < 0) return null;
      for (let cursor = index; cursor >= 0; cursor -= 1) {
        const label = rows[cursor]?.querySelector("button")
          ?.getAttribute("aria-label") ?? "";
        const match = /^(?:Collapse|Expand) (.+)$/.exec(label);
        if (match && !label.endsWith("subtasks")) return match[1];
      }
      return null;
    }, name);

    let firstRow: WorkItemRow | null = null;
    let secondRow: WorkItemRow | null = null;
    try {
      await graphql(request, SetWorkTrackerStartStateDocument, {
        id: chore.id,
        startStateId: ideas.id,
        workflowRevision: await revision(),
      });
      firstRow = await createChore(firstItem);
      await openModule(page, names.module);
      await expect(page.getByRole("treeitem", { name: new RegExp(firstItem) }))
        .toBeVisible();
      expect(await sectionFor(firstItem)).toBe(ideas.name);

      // The revision guard rejects a stale claim rather than racing it.
      const stale = await graphqlRefusal(
        request,
        SetWorkTrackerStartStateDocument,
        {
          id: chore.id,
          startStateId: grill.id,
          workflowRevision: (await revision()) - 1,
        },
      );
      expect(stale.message).toBeTruthy();

      await graphql(request, SetWorkTrackerStartStateDocument, {
        id: chore.id,
        startStateId: grill.id,
        workflowRevision: await revision(),
      });
      secondRow = await createChore(secondItem);
      await page.reload();
      await expect(page.getByRole("treeitem", { name: new RegExp(secondItem) }))
        .toBeVisible();
      expect(await sectionFor(secondItem)).toBe(grill.name);
      // Moving the start state must not relocate the item already filed.
      expect(await sectionFor(firstItem)).toBe(ideas.name);

      // Two issues still use the type, so an unqualified delete is refused.
      const refused = await graphqlRefusal(
        request,
        DeleteWorkTrackerIssueTypeDocument,
        { id: chore.id },
      );
      expect(refused.message).toContain("reassign_to");

      await graphql(request, DeleteWorkTrackerIssueTypeDocument, {
        id: chore.id,
        reassignTo: fixture.storyType.id,
      });
      // Reassignment repoints both issues before the type disappears.
      for (const row of [firstRow, secondRow]) {
        expect((await getWorkItem(request, row!.id)).issue_type_id)
          .toBe(fixture.storyType.id);
      }
      const remaining = await getWorkflowCatalog(request, fixture.project.id);
      expect(remaining.issue_types.nodes.map((issueType) => issueType.name))
        .not.toContain(typeName);
    } finally {
      for (const row of [firstRow, secondRow]) {
        if (row) {
          await graphql(request, DeleteWorkTrackerWorkItemDocument, { id: row.id });
        }
      }
    }
  });

  test("guards State deletion and converges the removal into the open tree", async ({
    page,
    request,
  }) => {
    const protectedState = fixture.states.find((state) => state.is_protected);
    expect(protectedState, "a protected seeded state").toBeTruthy();
    const origin = fixture.states.find((state) =>
      state.id === (fixture.storyType.start_state as string | null)
    );
    expect(origin, "the Story start state").toBeTruthy();
    const disposable = "E2E Disposable";
    const header = page.getByRole("button", { name: `Collapse ${disposable}` });
    const workflowRevision = async (): Promise<number> => {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const story = catalog.issue_types.nodes.find((issueType) =>
        issueType.id === fixture.storyType.id
      );
      expect(story, "the seeded Story issue type").toBeTruthy();
      return story!.workflow_revision;
    };

    // A reviewed default state is protected, so deletion is refused outright.
    const refusedProtected = await graphqlRefusal(
      request,
      DeleteWorkTrackerStateDocument,
      { id: protectedState!.id },
    );
    expect(refusedProtected.message).toContain("protected");

    // The last-state-in-group guard is unreachable from here: every group the
    // schema allows is already seeded, and the single-occupant groups hold
    // protected states, so the protected guard always answers first.
    const created = (await graphql(request, CreateWorkTrackerStateDocument, {
      projectId: fixture.project.id,
      name: disposable,
      group: origin!.group,
      color: "#0EA5E9",
    })).create_state;

    let removed = false;
    try {
      await openModule(page, names.module);
      await expect(header).toBeVisible();

      await graphql(request, CreateWorkTrackerTransitionDocument, {
        issueTypeId: fixture.storyType.id,
        fromStateId: origin!.id,
        toStateId: created.id,
        agentAllowed: false,
        workflowRevision: await workflowRevision(),
      });
      const refusedReferenced = await graphqlRefusal(
        request,
        DeleteWorkTrackerStateDocument,
        { id: created.id },
      );
      expect(refusedReferenced.message)
        .toContain("referenced by workflow configuration");
      await expect(header).toBeVisible();

      await graphql(request, RemoveWorkTrackerWorkflowStateDocument, {
        issueTypeId: fixture.storyType.id,
        stateId: created.id,
        workflowRevision: await workflowRevision(),
      });
      await graphql(request, DeleteWorkTrackerStateDocument, { id: created.id });
      removed = true;

      // The deletion fact evicts the row, so the section leaves the open tree
      // without a reload and does not come back on one.
      await expect(header).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("treeitem", { name: names.parent }))
        .toBeVisible();
      await expect(header).toHaveCount(0);
    } finally {
      if (!removed) {
        await graphql(request, DeleteWorkTrackerStateDocument, { id: created.id })
          .catch(() => undefined);
      }
    }
  });

  test("refuses creating a Story outside its published birth state", async ({
    request,
  }) => {
    const startStateId = fixture.storyType.start_state as string | null;
    const elsewhere = fixture.states.find((state) => state.id !== startStateId);
    expect(elsewhere, "a state other than the Story start state").toBeTruthy();
    const phantom = "Complete illegal birth";

    const refused = await graphqlRefusal(
      request,
      CreateWorkTrackerWorkItemDocument,
      {
        projectId: fixture.project.id,
        name: phantom,
        issueTypeId: fixture.storyType.id,
        parentId: fixture.module.id,
        stateId: elsewhere!.id,
      },
    );
    expect(refused.message).toMatch(/born in/i);

    // A refused birth must not leave a row behind.
    const items = await getWorkItems(request, fixture.project.id);
    expect(items.map((item) => item.name)).not.toContain(phantom);
  });

  test("prunes a disposable workflow when its only reachable edge is deleted", async ({
    page,
    request,
  }) => {
    const byName = (stateName: string) => {
      const state = fixture.states.find((row) => row.name === stateName);
      expect(state, `the seeded ${stateName} state`).toBeTruthy();
      return state!;
    };
    const ideas = byName("Ideas");
    const grill = byName("Grill");
    const spec = byName("Spec");
    const typeName = "E2E Pipeline";

    const pipeline = (await graphql(request, CreateWorkTrackerIssueTypeDocument, {
      projectId: fixture.project.id,
      name: typeName,
      level: "task",
      color: "#22C55E",
    })).create_issue_type;

    const workflow = async () => {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const row = catalog.issue_types.nodes.find((issueType) =>
        issueType.id === pipeline.id
      );
      expect(row, `the ${typeName} issue type`).toBeTruthy();
      return row!;
    };
    const edges = async (): Promise<string[]> => {
      const nameById = new Map(fixture.states.map((state) => [state.id, state.name]));
      return (await workflow()).transitions.nodes
        .map((edge) =>
          `${nameById.get(edge.from_state) ?? edge.from_state}->${
            nameById.get(edge.to_state) ?? edge.to_state
          }`
        )
        .sort();
    };
    const addEdge = async (from: string, to: string): Promise<void> => {
      await graphql(request, CreateWorkTrackerTransitionDocument, {
        issueTypeId: pipeline.id,
        fromStateId: from,
        toStateId: to,
        agentAllowed: false,
        workflowRevision: (await workflow()).workflow_revision,
      });
    };
    const born = (name: string) => createWorkItem(
      request,
      fixture.project.id,
      { name, issue_type_id: pipeline.id, parent_id: fixture.module.id },
    );
    const attemptMoveToGrill = async (): Promise<void> => {
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("s");
      const dialog = page.getByRole("dialog", { name: "Set Status" });
      await expect(dialog).toBeVisible();
      await dialog.getByText(grill.name, { exact: true }).click();
    };

    const items: WorkItemRow[] = [];
    try {
      await graphql(request, SetWorkTrackerStartStateDocument, {
        id: pipeline.id,
        startStateId: ideas.id,
        workflowRevision: (await workflow()).workflow_revision,
      });
      await addEdge(ideas.id, grill.id);
      await addEdge(grill.id, spec.id);
      expect(await edges()).toEqual(["Grill->Spec", "Ideas->Grill"]);

      const allowed = await born("Complete pipeline allowed move");
      items.push(allowed);
      await openModule(page, names.module);
      await openWorkItem(page, allowed.name);
      await expect(page.getByTestId("status-row")).toContainText(ideas.name);
      await attemptMoveToGrill();
      await expect(page.getByTestId("status-row")).toContainText(grill.name);

      // Deleting the only edge out of the start state leaves Grill->Spec
      // unreachable, so the publish prunes it rather than keeping an orphan.
      await graphql(request, DeleteWorkTrackerTransitionDocument, {
        issueTypeId: pipeline.id,
        fromStateId: ideas.id,
        toStateId: grill.id,
        workflowRevision: (await workflow()).workflow_revision,
      });
      expect(await edges()).toEqual([]);

      const refusedItem = await born("Complete pipeline refused move");
      items.push(refusedItem);
      await page.reload();
      await openWorkItem(page, refusedItem.name);
      await attemptMoveToGrill();
      await expect(page.getByTestId("toast-error")).toBeVisible();
      await expect(page.getByTestId("status-row")).toContainText(ideas.name);
      expect((await getWorkItem(request, refusedItem.id)).state_id).toBe(ideas.id);
    } finally {
      for (const item of items) {
        await graphql(request, DeleteWorkTrackerWorkItemDocument, { id: item.id })
          .catch(() => undefined);
      }
      await graphql(request, DeleteWorkTrackerIssueTypeDocument, { id: pipeline.id })
        .catch(() => undefined);
    }
  });

  test("renames the project through Rust and shows it in the visible breadcrumb", async ({
    page,
    request,
  }) => {
    const renamed = "Coding Renamed By E2E";
    const crumb = page.getByTestId("crumb-project");

    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);
    await expect(crumb).toHaveText(fixture.project.name);

    try {
      const updated = (await graphql(request, UpdateWorkTrackerProjectDocument, {
        id: fixture.project.id,
        name: renamed,
      })).update_project;
      // The rename must not move the slug every other surface keys off.
      expect(updated).toMatchObject({
        name: renamed,
        slug: fixture.project.slug,
      });

      await page.reload();
      await openWorkItem(page, names.blocker);
      await expect(crumb).toHaveText(renamed);
    } finally {
      await graphql(request, UpdateWorkTrackerProjectDocument, {
        id: fixture.project.id,
        name: fixture.project.name,
      });
    }

    await page.reload();
    await openWorkItem(page, names.blocker);
    await expect(crumb).toHaveText(fixture.project.name);
  });

  test("opens and cancels every keyboard launch entry without starting a run", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);
    const workspaceTabs = page.getByRole("tablist", { name: "Workspace tabs" });
    const initialTabCount = await workspaceTabs.getByRole("tab").count();
    const focusCommandLayer = () =>
      page.getByRole("button", { name: "Open Settings" }).focus();

    await focusCommandLayer();
    await page.keyboard.press("o");
    let picker = page.getByRole("dialog", { name: "Select Agent" });
    await expect(picker).toContainText("codex");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    const openPromptAndCancelProvider = async (
      chord: "Shift+Enter" | "n" | "i",
      promptText: string,
    ): Promise<void> => {
      await focusCommandLayer();
      await page.keyboard.press(chord);
      const prompt = page.getByRole("dialog", { name: "Prompt" });
      await expect(prompt).toBeVisible();
      const input = prompt.getByPlaceholder(
        "Type a prompt. Enter inserts a newline; Ctrl/Cmd+Enter submits.",
      );
      await expect(input).toBeFocused();
      await input.fill(promptText);
      await prompt.getByRole("button", { name: "Submit" }).click();
      await expect(prompt).toHaveCount(0);
      picker = page.getByRole("dialog", { name: "Select Agent" });
      await expect(picker).toContainText("codex");
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
    };

    await openPromptAndCancelProvider(
      "Shift+Enter",
      "Task-scoped prompt that must not launch.",
    );
    await openPromptAndCancelProvider("n", "Planning prompt that must not launch.");
    await openPromptAndCancelProvider("i", "Instant prompt that must not launch.");

    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    await expect(workspaceTabs.getByRole("tab")).toHaveCount(initialTabCount);
  });

  test("opens the shared provider picker from the workspace launcher", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);

    await page.getByRole("button", { name: "＋ Agent" }).click();
    let picker = page.getByRole("dialog", { name: "Select Agent" });
    await expect(picker).toBeVisible();
    await expect(picker.getByText("codex", { exact: true })).toBeVisible();
    await expect(page.getByRole("menu", { name: "Launch agent" }))
      .toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Meta+Enter");
    picker = page.getByRole("dialog", { name: "Select Agent" });
    await expect(picker).toBeVisible();
    await expect(picker.getByText("codex", { exact: true })).toBeVisible();
  });

  test("updates the live Agent Picker when Rust provider activation changes", async ({
    page,
    request,
  }) => {
    await configureCodexDefault(request);
    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);

    const setClaudeActivation = async (active: boolean): Promise<void> => {
      const settings = await openSettings(page);
      await settings.getByRole("combobox", { name: "Agent/provider" })
        .selectOption("codex");
      await settings.getByRole("combobox", { name: "Model" })
        .fill(CODEX_TEST_MODEL);
      await settings.getByRole("combobox", { name: "Reasoning" })
        .selectOption(CODEX_TEST_REASONING);
      const claude = settings.getByRole("checkbox", { name: "Activate claude" });
      await claude.setChecked(active);
      await settings.getByRole("button", { name: "Save changes" }).click();
      await expect(settings).toContainText("Model configuration saved.");
      await settings.getByRole("button", { name: "Close dialog" }).click();
    };
    const openAgentPicker = async (): Promise<Locator> => {
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("o");
      const picker = page.getByRole("dialog", { name: "Select Agent" });
      await expect(picker).toBeVisible();
      await expect(picker.getByText("codex", { exact: true })).toBeVisible();
      return picker;
    };

    let settings = await openSettings(page);
    const original = await settings.getByRole("checkbox", {
      name: "Activate claude",
    }).isChecked();
    await settings.getByRole("button", { name: "Close dialog" }).click();

    await setClaudeActivation(!original);
    let picker = await openAgentPicker();
    await expect(picker.getByText("claude", { exact: true })).toHaveCount(
      original ? 0 : 1,
    );
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    await setClaudeActivation(original);
    picker = await openAgentPicker();
    await expect(picker.getByText("claude", { exact: true })).toHaveCount(
      original ? 1 : 0,
    );
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    await page.reload();
    settings = await openSettings(page);
    await expect(settings.getByRole("checkbox", { name: "Activate claude" }))
      .toBeChecked({ checked: original });
    await settings.getByRole("button", { name: "Close dialog" }).click();
  });

  test("refuses Run now before moving state when its module link is unavailable", async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.runNow);
    const runNow = page.getByRole("button", { name: "Run now" });
    await expect(runNow).toBeVisible();
    await expect(page.getByTestId("status-row")).toContainText("Ideas");

    await graphql(request, ClearModuleLinkDocument, {
      moduleId: fixture.module.id,
    });

    try {
      const refused = page.waitForResponse((response) =>
        response.url().endsWith("/graphql") &&
        response.request().postDataJSON()?.operationName ===
          "RunWorkTrackerWorkItemNow"
      );
      await runNow.click();
      await refused;
      const alert = page.getByRole("alert").filter({
        hasText: "Run now could not be started",
      });
      await expect(alert).toContainText(/no local folder is linked/i);
      await expect(alert).toContainText(/existing writable module folder/i);
      await expect(page.getByTestId("status-row")).toContainText("Ideas");
      await expect(runNow).toBeEnabled();
    } finally {
      await selectModuleForProfile(
        request,
        fixture.project.id,
        fixture.module.id,
        fixture.folder,
      );
    }

    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
    await expect(page.getByRole("button", { name: "Run now" })).toBeVisible();
  });

  test("opens, hides, restores, and closes a Rust-backed module shell", async ({
    page,
  }) => {
    await openModule(page, names.module);
    const footerToggle = page.getByTestId("footer-terminal-toggle");
    await expect(footerToggle).toHaveAttribute(
      "aria-label",
      "Open terminal panel",
    );
    await footerToggle.click();

    const panel = page.getByTestId("terminal-panel");
    await expect(panel).toBeVisible();
    await expect(footerToggle).toHaveAttribute(
      "aria-label",
      "Minimize terminal panel",
    );
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();

    const terminalInput = panel.locator(".xterm-helper-textarea");
    const terminalRows = panel.locator(".xterm-rows");
    await expect(terminalInput).toBeVisible();
    await terminalInput.click();
    await page.keyboard.type("pwd");
    await page.keyboard.press("Enter");
    await expect(terminalRows).toContainText(fixture.folder);
    await page.keyboard.type(
      "printf '\\124\\111\\103\\113\\105\\124\\122\\131\\137\\120\\124\\131\\137\\117\\113\\012'",
    );
    await page.keyboard.press("Enter");
    await expect(terminalRows).toContainText("TICKETRY_PTY_OK");

    const resizeGrip = panel.getByRole("separator", {
      name: "Resize the terminal panel",
    });
    const ordinaryHeight = Number(
      await resizeGrip.getAttribute("aria-valuenow"),
    );
    await resizeGrip.press("ArrowUp");
    await expect(resizeGrip).toHaveAttribute(
      "aria-valuenow",
      String(ordinaryHeight + 24),
    );
    await page.waitForTimeout(650);
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(resizeGrip).toHaveAttribute(
      "aria-valuenow",
      String(ordinaryHeight + 24),
    );
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await expect(panel.locator(".xterm-rows")).toContainText("TICKETRY_PTY_OK");

    await panel.getByRole("button", { name: "Maximize terminal panel" }).click();
    await expect(panel.getByRole("button", {
      name: "Restore terminal panel size",
    })).toBeVisible();
    const maximizedHeight = Number(
      await resizeGrip.getAttribute("aria-valuenow"),
    );
    expect(maximizedHeight).toBeGreaterThan(ordinaryHeight + 24);
    await page.waitForTimeout(650);
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", {
      name: "Restore terminal panel size",
    })).toBeVisible();
    await expect(resizeGrip).toHaveAttribute(
      "aria-valuenow",
      String(maximizedHeight),
    );
    await panel.getByRole("button", {
      name: "Restore terminal panel size",
    }).click();
    await expect(resizeGrip).toHaveAttribute(
      "aria-valuenow",
      String(ordinaryHeight + 24),
    );

    await page.getByRole("tab", { name: names.secondModule }).last().click();
    await expect(panel).toHaveCount(0);
    await expect(footerToggle).toHaveAttribute(
      "aria-label",
      "Open terminal panel",
    );
    await page.getByRole("tab", { name: names.module }).last().click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();

    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
    await expect(panel).toHaveCount(0);
    await expect(footerToggle).toHaveAttribute(
      "aria-label",
      "Open terminal panel",
    );

    await page.keyboard.press("Control+Backquote");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await page.keyboard.press("Control+Backquote");
    await expect(panel).toHaveCount(0);

    await footerToggle.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close shell 1" }).click();
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toHaveCount(0);
    await expect(panel.getByTestId("terminal-panel-no-shells")).toBeVisible();
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("creates, selects, restores, caps, and closes Rust-backed shells", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    const firstShell = panel.getByRole("tab", { name: "Shell 1" });
    await expect(firstShell).toBeVisible();

    await panel.getByRole("button", { name: "New shell" }).click();
    const secondShell = panel.getByRole("tab", { name: "Shell 2" });
    await expect(secondShell).toBeVisible();
    await expect(secondShell).toHaveAttribute("aria-selected", "true");

    await panel.getByRole("button", { name: "New shell" }).click();
    const thirdShell = panel.getByRole("tab", { name: "Shell 3" });
    await expect(thirdShell).toHaveAttribute("aria-selected", "true");
    await panel.getByRole("button", { name: "New shell" }).click();
    const fourthShell = panel.getByRole("tab", { name: "Shell 4" });
    await expect(fourthShell).toHaveAttribute("aria-selected", "true");
    const newShell = panel.getByRole("button", { name: "New shell" });
    await expect(newShell).toBeDisabled();
    await expect(newShell).toHaveAttribute(
      "title",
      "A module can hold 4 shells.",
    );

    await firstShell.click();
    await expect(firstShell).toHaveAttribute("aria-selected", "true");
    await secondShell.click();
    await expect(secondShell).toHaveAttribute("aria-selected", "true");

    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    await expect(secondShell).toHaveAttribute("aria-selected", "true");

    await panel.getByRole("button", { name: "Close shell 4" }).click();
    await expect(fourthShell).toHaveCount(0);
    await expect(secondShell).toHaveAttribute("aria-selected", "true");
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
  });

  test("recovers a refused module shell after its folder link is removed", async ({
    page,
    request,
  }) => {
    await openModule(page, names.secondModule);
    await graphql(request, ClearModuleLinkDocument, {
      moduleId: fixture.secondModule.id,
    });
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    const recovery = panel.getByTestId("terminal-panel-folder-required");
    await expect(recovery).toHaveAttribute(
      "data-refusal-reason",
      "module_folder_unusable",
    );
    await expect(recovery).toContainText("This module has no usable folder.");

    const folder = recovery.getByRole("textbox", {
      name: "Module folder for the terminal panel",
    });
    await folder.fill("relative/path");
    await expect(folder).toHaveAttribute("aria-invalid", "true");
    await expect(recovery.getByRole("button", { name: "Use this folder" }))
      .toBeDisabled();

    await folder.fill(join(fixture.folder, "missing-module-folder"));
    await recovery.getByRole("button", { name: "Use this folder" }).click();
    await expect(recovery.getByRole("alert"))
      .toContainText("Could not save the module folder. Retry to continue.");
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toHaveCount(0);

    await folder.fill(fixture.folder);
    await recovery.getByRole("button", { name: "Use this folder" }).click();

    await expect(recovery).toHaveCount(0);
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await panel.getByRole("button", { name: "Close shell 1" }).click();
    await expect(panel.getByTestId("terminal-panel-no-shells")).toBeVisible();
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
  });

  test("repairs a persisted module link after its folder disappears", async ({
    page,
    request,
  }) => {
    const staleFolder = await mkdtemp(join(tmpdir(), "ticketry-stale-link-e2e-"));
    try {
      await selectModuleForProfile(
        request,
        fixture.project.id,
        fixture.staleModule.id,
        staleFolder,
      );
      await rm(staleFolder, { recursive: true, force: true });

      await openModule(page, names.staleModule);
      await page.reload();
      await page.getByRole("button", { name: "Open terminal panel" }).click();
      const panel = page.getByTestId("terminal-panel");
      const recovery = panel.getByTestId("terminal-panel-folder-required");
      await expect(recovery).toHaveAttribute(
        "data-refusal-reason",
        "module_folder_unusable",
      );
      await expect(recovery).toContainText(
        "This module has no usable folder.",
      );
      await expect(panel.getByRole("tab", { name: "Shell 1" })).toHaveCount(0);

      await recovery.getByRole("textbox", {
        name: "Module folder for the terminal panel",
      }).fill(fixture.folder);
      await recovery.getByRole("button", { name: "Use this folder" }).click();
      await expect(recovery).toHaveCount(0);
      await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
      const links = (await graphql(request, LoadModuleLinksDocument, {}))
        .moduleLinks.nodes;
      expect(links.find((link) =>
        link.moduleId.replaceAll("-", "") ===
          fixture.staleModule.id.replaceAll("-", "")
      )?.path)
        .toBe(fixture.folder);
      await panel.getByRole("button", { name: "Close shell 1" }).click();
      await expect(panel.getByTestId("terminal-panel-no-shells")).toBeVisible();
      await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
    } finally {
      await rm(staleFolder, { recursive: true, force: true });
      await selectModuleForProfile(
        request,
        fixture.project.id,
        fixture.staleModule.id,
        fixture.folder,
      );
    }
  });

  test("surfaces a failed Rust shell exit status", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    const input = panel.locator(".xterm-helper-textarea");
    await expect(input).toBeVisible();
    await input.click();
    await page.keyboard.insertText("exit 7");
    await page.keyboard.press("Enter");

    await expect(panel.locator(".xterm-rows"))
      .toContainText("Pane is dead (status 7", { timeout: 15_000 });
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
  });

  test("persists the keyboard-selected module folder and launches a shell there", async ({
    page,
  }) => {
    await openModule(page, names.nonRepoModule);
    const openFolderCommand = async (): Promise<Locator> => {
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("f");
      const dialog = page.getByRole("dialog", { name: "Module Folder" });
      await expect(dialog).toBeVisible();
      return dialog;
    };

    let dialog = await openFolderCommand();
    let folder = dialog.getByPlaceholder("Local folder (optional)");
    await expect(folder).toHaveValue(fixture.nonRepoFolder);
    await folder.fill(fixture.alternateFolder);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    await page.reload();
    dialog = await openFolderCommand();
    folder = dialog.getByPlaceholder("Local folder (optional)");
    await expect(folder).toHaveValue(fixture.alternateFolder);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    const terminalInput = panel.locator(".xterm-helper-textarea");
    await expect(terminalInput).toBeVisible();
    await terminalInput.click();
    await page.keyboard.type("pwd");
    await page.keyboard.press("Enter");
    await expect(panel.locator(".xterm-rows"))
      .toContainText(fixture.alternateFolder);
    await panel.getByRole("button", { name: "Close shell 1" }).click();
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();

    dialog = await openFolderCommand();
    folder = dialog.getByPlaceholder("Local folder (optional)");
    await folder.fill(fixture.nonRepoFolder);
    await dialog.getByRole("button", { name: "Save" }).click();
    await page.reload();
    dialog = await openFolderCommand();
    await expect(dialog.getByPlaceholder("Local folder (optional)"))
      .toHaveValue(fixture.nonRepoFolder);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("supports three-zone edit-view keyboard navigation", async ({ page }) => {
    await openModule(page, names.module);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Backslash");
    await expect(page.getByTestId("pane-modules")).not.toBeVisible();
    const storiesZone = page.locator('[data-navigation-zone="stories"]');
    await expect(storiesZone).toBeFocused();

    await page.getByRole("treeitem", {
      name: new RegExp(`${names.parent}(?: renamed)?`),
    }).click();
    await expect(page.getByTestId("issue-name")).toContainText(names.parent);

    await page.keyboard.press("Shift+Tab");
    const workspaceTabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await expect(workspaceTabs).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-navigation-zone="active-tab-body"]'))
      .toBeFocused();

    await page.keyboard.press("Backslash");
    await expect(page.getByTestId("pane-modules")).toBeVisible();
  });

  test("supports shortcut discovery, filtering, focus, and responsive dialogs", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await page.setViewportSize({ width: 900, height: 650 });
    const trigger = page.getByRole("button", { name: "Open Settings" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Studio settings" });
    await dialog.getByRole("tab", { name: "Keyboard shortcuts" }).click();
    const filter = dialog.getByRole("searchbox", {
      name: "Search bindings",
    });
    await filter.click();
    await expect(filter).toBeFocused();
    await filter.fill("Search");
    await expect(dialog.getByRole("button", {
      name: "Record Search binding",
    })).toHaveText("/");
    await filter.fill("definitely-no-such-shortcut");
    await expect(dialog.getByText("No bindings match", { exact: false }))
      .toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("persists, executes, and resets a custom Search shortcut", async ({
    page,
  }) => {
    await openModule(page, names.module);

    const openSearchBinding = async (): Promise<{
      binding: Locator;
      dialog: Locator;
    }> => {
      const dialog = await openSettings(page);
      await dialog.getByRole("tab", { name: "Keyboard shortcuts" }).click();
      await dialog.getByRole("searchbox", { name: "Search bindings" })
        .fill("Search");
      const binding = dialog.getByRole("button", {
        name: "Record Search binding",
      });
      await expect(binding).toBeVisible();
      return { binding, dialog };
    };

    let { binding, dialog } = await openSearchBinding();
    await expect(binding).toHaveText("/");
    await binding.click();
    await expect(binding).toHaveText("Press a chord…");
    await page.keyboard.press("Alt+k");
    await expect(binding).toHaveText("Alt+K");
    await expect(dialog.getByRole("button", { name: "Reset Search binding" }))
      .toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();

    await page.reload();
    ({ binding, dialog } = await openSearchBinding());
    await expect(binding).toHaveText("Alt+K");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.keyboard.press("Alt+k");
    await expect(page.getByRole("textbox", { name: "Search stories" }))
      .toBeFocused();

    ({ binding, dialog } = await openSearchBinding());
    await dialog.getByRole("button", { name: "Reset Search binding" }).click();
    await expect(binding).toHaveText("/");
    await expect(dialog.getByRole("button", { name: "Reset Search binding" }))
      .toHaveCount(0);
    await dialog.getByRole("button", { name: "Close dialog" }).click();

    await page.reload();
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("/");
    await expect(page.getByRole("textbox", { name: "Search stories" }))
      .toBeFocused();
  });

  test("sends serial and parallel subtree launches through the visible controls", async ({
    page,
    request,
  }) => {
    const root = await getWorkItem(request, fixture.hierarchyParent.id);
    expect(root.state_id, "the campaign root state").toBeTruthy();

    const readStoryPolicy = async () => {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const story = catalog.issue_types.nodes.find((type) =>
        type.id === fixture.storyType.id
      );
      expect(story, "the current Story workflow").toBeTruthy();
      const binding = story!.launch_bindings.nodes.find((candidate) =>
        candidate.state === root.state_id
      );
      return { story: story!, binding };
    };
    const original = await readStoryPolicy();
    const originalEnabled = original.binding?.subtree_run_enabled ?? false;
    await graphql(request, SetWorkTrackerSubtreeRunDocument, {
      issueTypeId: fixture.storyType.id,
      stateId: root.state_id!,
      workflowRevision: original.story.workflow_revision,
      enabled: true,
    });

    const requestedModes: Array<string | null> = [];
    let armed = false;
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON() as {
        operationName?: string;
        variables?: { rootId?: string; executionMode?: string | null };
      } | null;
      if (body?.operationName === "ExecutionGraphRunHolding") {
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              graph_run_holding: {
                __typename: "GraphRunsConnection",
                nodes: armed
                  ? [{
                    __typename: "GraphRuns",
                    root_id: fixture.hierarchyParent.id,
                    execution_mode: requestedModes.at(-1) ?? "parallel",
                  }]
                  : [],
              },
            },
          }),
        });
        return;
      }
      if (
        body?.operationName === "CreateExecutionGraphRun" ||
        body?.operationName === "UpdateExecutionGraphRun"
      ) {
        const mode = body.variables?.executionMode ?? null;
        requestedModes.push(mode);
        armed = true;
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({
            data: {
              graph_run_result: {
                __typename: "GraphRunMutationPayload",
                graph_run: {
                  __typename: "GraphRuns",
                  root_id: fixture.hierarchyParent.id,
                  execution_mode: mode ?? "parallel",
                },
                launched: [fixture.hierarchyChild.id],
              },
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    try {
      await openModule(page, names.module);
      await openWorkItem(page, names.hierarchyParent);
      const details = page.getByRole("region", { name: "Details" });
      const runSerially = details.getByRole("button", { name: "Run serially" });
      const runSubtree = details.getByRole("button", { name: "Run subtree" });
      await expect(runSerially).toBeVisible();
      await expect(runSubtree).toBeVisible();

      await runSerially.click();
      await expect(page.getByRole("status").filter({
        hasText: "Serial subtree run started.",
      })).toBeVisible();
      await runSubtree.click();
      await expect(page.getByRole("status").filter({
        hasText: "Subtree run started.",
      })).toBeVisible();

      expect(requestedModes).toEqual(["serial", null]);
    } finally {
      await page.unroute("**/graphql");
      const current = await readStoryPolicy();
      await graphql(request, SetWorkTrackerSubtreeRunDocument, {
        issueTypeId: fixture.storyType.id,
        stateId: root.state_id!,
        workflowRevision: current.story.workflow_revision,
        enabled: originalEnabled,
      });
    }
  });

  test("persists the Story Grill policy through Rust", async ({
    page,
  }) => {
    let launchBindingWrites = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/graphql") &&
        request.postDataJSON()?.operationName ===
          "UpsertWorkTrackerLaunchBinding"
      ) {
        launchBindingWrites += 1;
      }
    });
    await openModule(page, names.module);
    await page.getByRole("treeitem", { name: new RegExp(fixture.parent.key) })
      .click();
    await expect(page.getByTestId("issue-name"))
      .toContainText(/Complete parent(?: renamed)?/);

    const openGrillPolicy = async (): Promise<Locator> => {
      await page.getByRole("button", { name: "Configure Grill state" }).click();
      const panel = page.getByRole("region", {
        name: "Grill state configuration",
      });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("heading", { name: "Grill" })).toBeVisible();
      await expect(panel.getByRole("tab", { name: "Story" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      return panel;
    };
    const closeGrillPolicy = async (panel: Locator): Promise<void> => {
      await panel.getByRole("button", {
        name: "Close Grill state configuration",
      }).click();
      await expect(panel).toHaveCount(0);
    };
    const waitForWorkflowWrite = () => page.waitForResponse((response) => {
      if (!response.url().endsWith("/graphql")) return false;
      const operation = response.request().postDataJSON()?.operationName;
      return [
        "UpsertWorkTrackerLaunchBinding",
        "UpdateWorkTrackerTransition",
        "SetWorkTrackerAutoStart",
        "SetWorkTrackerSubtreeRun",
      ].includes(operation);
    });
    const selectPersistedOption = async (
      field: Locator,
      value: string,
    ): Promise<void> => {
      if (await field.inputValue() === value) return;
      const saved = waitForWorkflowWrite();
      await field.selectOption(value);
      await saved;
      await expect(field).toHaveValue(value);
      await expect(page.getByText("Applying…")).toHaveCount(0);
    };
    const fillPersistedInput = async (
      field: Locator,
      value: string,
    ): Promise<void> => {
      if (await field.inputValue() === value) return;
      const saved = waitForWorkflowWrite();
      await field.fill(value);
      await field.blur();
      await saved;
      await expect(field).toHaveValue(value);
      await expect(page.getByText("Applying…")).toHaveCount(0);
    };
    const setPolicyCheckbox = async (
      checkbox: Locator,
      checked: boolean,
    ): Promise<void> => {
      if (await checkbox.isChecked() === checked) return;
      const saved = waitForWorkflowWrite();
      await checkbox.click();
      await saved;
      await expect(checkbox).toBeEnabled();
      await expect(checkbox).toBeChecked({ checked });
    };

    let panel = await openGrillPolicy();
    let prompt = panel.getByRole("textbox", { name: "Prompt" });
    let agentPermission = panel.getByRole("checkbox", {
      name: "Agents may move Grill to Spec",
    });
    let handoff = panel.getByRole("checkbox", {
      name: "Handoff Grill to Spec",
    });
    let autoStart = panel.getByRole("checkbox", { name: "Auto-start Grill" });
    let runSubtree = panel.getByRole("checkbox", { name: "Run subtree Grill" });
    let provider = panel.getByRole("combobox", { name: "Agent/provider" });
    let model = panel.getByRole("combobox", { name: "Model" });
    let reasoning = panel.getByRole("combobox", { name: "Reasoning" });
    const originalPrompt = await prompt.inputValue();
    const originalAgentPermission = await agentPermission.isChecked();
    const originalHandoff = await handoff.isChecked();
    const originalAutoStart = await autoStart.isChecked();
    const originalRunSubtree = await runSubtree.isChecked();
    const originalProvider = await provider.inputValue();
    const originalModel = await model.inputValue();
    const originalReasoning = await reasoning.inputValue();
    const changedPrompt = "Rust E2E Grill policy prompt.";

    let saved = waitForWorkflowWrite();
    await prompt.fill(changedPrompt);
    await prompt.blur();
    await saved;
    await expect(panel.getByText("Applying…")).toHaveCount(0);
    await setPolicyCheckbox(agentPermission, !originalAgentPermission);
    await setPolicyCheckbox(handoff, !originalHandoff);
    await setPolicyCheckbox(autoStart, !originalAutoStart);
    await setPolicyCheckbox(runSubtree, !originalRunSubtree);
    if (originalProvider === "codex") {
      await selectPersistedOption(provider, "");
    }
    await selectPersistedOption(provider, "codex");
    await fillPersistedInput(model, CODEX_TEST_MODEL);
    await selectPersistedOption(reasoning, CODEX_TEST_REASONING);
    await closeGrillPolicy(panel);

    await page.reload();
    panel = await openGrillPolicy();
    prompt = panel.getByRole("textbox", { name: "Prompt" });
    agentPermission = panel.getByRole("checkbox", {
      name: "Agents may move Grill to Spec",
    });
    handoff = panel.getByRole("checkbox", {
      name: "Handoff Grill to Spec",
    });
    autoStart = panel.getByRole("checkbox", { name: "Auto-start Grill" });
    runSubtree = panel.getByRole("checkbox", { name: "Run subtree Grill" });
    provider = panel.getByRole("combobox", { name: "Agent/provider" });
    model = panel.getByRole("combobox", { name: "Model" });
    reasoning = panel.getByRole("combobox", { name: "Reasoning" });
    await expect(prompt).toHaveValue(changedPrompt);
    await expect(agentPermission).toBeChecked({
      checked: !originalAgentPermission,
    });
    await expect(handoff).toBeChecked({ checked: !originalHandoff });
    await expect(autoStart).toBeChecked({ checked: !originalAutoStart });
    await expect(runSubtree).toBeChecked({ checked: !originalRunSubtree });
    await expect(provider).toHaveValue("codex");
    await expect(model).toHaveValue(CODEX_TEST_MODEL);
    await expect(reasoning).toHaveValue(CODEX_TEST_REASONING);

    const writesBeforeRefusal = launchBindingWrites;
    await model.fill("unsupported-e2e-model");
    await model.blur();
    await expect(panel).toContainText(
      /not compatible with agent\/provider 'codex'/i,
    );
    expect(launchBindingWrites).toBe(writesBeforeRefusal);

    await page.reload();
    panel = await openGrillPolicy();
    prompt = panel.getByRole("textbox", { name: "Prompt" });
    agentPermission = panel.getByRole("checkbox", {
      name: "Agents may move Grill to Spec",
    });
    handoff = panel.getByRole("checkbox", {
      name: "Handoff Grill to Spec",
    });
    autoStart = panel.getByRole("checkbox", { name: "Auto-start Grill" });
    runSubtree = panel.getByRole("checkbox", { name: "Run subtree Grill" });
    provider = panel.getByRole("combobox", { name: "Agent/provider" });
    model = panel.getByRole("combobox", { name: "Model" });
    reasoning = panel.getByRole("combobox", { name: "Reasoning" });
    await expect(provider).toHaveValue("codex");
    await expect(model).toHaveValue(CODEX_TEST_MODEL);
    await expect(reasoning).toHaveValue(CODEX_TEST_REASONING);

    saved = waitForWorkflowWrite();
    await prompt.fill(originalPrompt);
    await prompt.blur();
    await saved;
    await expect(panel.getByText("Applying…")).toHaveCount(0);
    await setPolicyCheckbox(agentPermission, originalAgentPermission);
    await setPolicyCheckbox(handoff, originalHandoff);
    await setPolicyCheckbox(autoStart, originalAutoStart);
    await setPolicyCheckbox(runSubtree, originalRunSubtree);
    await selectPersistedOption(provider, originalProvider);
    if (originalProvider) {
      await fillPersistedInput(model, originalModel);
      await selectPersistedOption(reasoning, originalReasoning);
    }
    await closeGrillPolicy(panel);

    await page.reload();
    panel = await openGrillPolicy();
    await expect(panel.getByRole("textbox", { name: "Prompt" }))
      .toHaveValue(originalPrompt);
    await expect(panel.getByRole("checkbox", {
      name: "Agents may move Grill to Spec",
    })).toBeChecked({ checked: originalAgentPermission });
    await expect(panel.getByRole("checkbox", {
      name: "Handoff Grill to Spec",
    })).toBeChecked({ checked: originalHandoff });
    await expect(panel.getByRole("checkbox", { name: "Auto-start Grill" }))
      .toBeChecked({ checked: originalAutoStart });
    await expect(panel.getByRole("checkbox", { name: "Run subtree Grill" }))
      .toBeChecked({ checked: originalRunSubtree });
    await expect(panel.getByRole("combobox", { name: "Agent/provider" }))
      .toHaveValue(originalProvider);
    await expect(panel.getByRole("combobox", { name: "Model" }))
      .toHaveValue(originalModel);
    await expect(panel.getByRole("combobox", { name: "Reasoning" }))
      .toHaveValue(originalReasoning);

    await closeGrillPolicy(panel);
    await expect(page.getByTestId("issue-name"))
      .toContainText(/Complete parent(?: renamed)?/);
  });

  test("surfaces and dismisses an agent-launch failure without leaving the workspace", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await page.getByRole("treeitem", { name: new RegExp(fixture.parent.key) })
      .click();

    await page.getByRole("button", { name: "Run agent" }).click();
    const alert = page.getByRole("alert").filter({
      hasText: "Agent run could not be started",
    });
    await expect(alert).toContainText("Agent run could not be started");
    await alert.getByRole("button", { name: "Dismiss" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByTestId("issue-name"))
      .toContainText(/Complete parent(?: renamed)?/);
  });

  test("says whether an automated transition continued a session or started a fresh one", async ({
    page,
  }) => {
    // The browser suite never starts a provider process, so the continued and
    // fresh deliveries are published onto the status stream the application
    // really subscribes to rather than produced by a real handoff. What is
    // under test here is the browser seam: a delivery mode the server puts on
    // the feed has to become something a person can see on the Story row.
    const attempt = (
      workItemId: string,
      attemptId: string,
      deliveryMode: "continued" | "started_fresh",
    ) => ({
      attempt_id: attemptId,
      root_attempt_id: attemptId,
      retry_of_attempt_id: null,
      work_item_id: workItemId,
      // A continued handoff settles its attempt the moment typed delivery
      // lands, so the happy path is only ever a succeeded attempt.
      status: "succeeded",
      error: null,
      failure: null,
      retryable: false,
      agent_run_id: null,
      delivery_mode: deliveryMode,
      updated_at: "2026-09-01T12:00:00+00:00",
    });
    const snapshot = {
      __typename: "RunStatusSnapshot",
      project_id: fixture.project.id,
      cursor: 1,
      at: "2026-09-01T12:00:00+00:00",
      runs: [],
      automation_attempts: [
        attempt(fixture.parent.id, "11111111-1111-4111-8111-111111111111", "continued"),
        attempt(fixture.moving.id, "22222222-2222-4222-8222-222222222222", "started_fresh"),
      ],
    };

    await page.route("**/graphql/subscribe", async (route) => {
      await route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({
          type: "next",
          payload: { data: { run_status_stream: snapshot } },
        })}\n\n`,
      });
    });
    try {
      await openModule(page, names.module);

      const continued = page
        .getByRole("treeitem", { name: new RegExp(fixture.parent.key) })
        .getByTestId("automation-delivery-chicklet");
      await expect(continued).toHaveAttribute("data-delivery-mode", "continued");
      await expect(continued).toContainText("Continued");
      await expect(continued).toContainText(
        "This transition continued the Story's existing agent session.",
      );

      const fresh = page
        .getByRole("treeitem", { name: new RegExp(fixture.moving.key) })
        .getByTestId("automation-delivery-chicklet");
      await expect(fresh).toHaveAttribute("data-delivery-mode", "started_fresh");
      await expect(fresh).toContainText("Fresh");
      await expect(fresh).toContainText(
        "This transition started a fresh agent session.",
      );

      // A Story that nothing delivered stays silent rather than implying a
      // mode it has no fact for.
      await expect(
        page
          .getByRole("treeitem", { name: new RegExp(fixture.blocker.key) })
          .getByTestId("automation-delivery-chicklet"),
      ).toHaveCount(0);
    } finally {
      await page.unroute("**/graphql/subscribe");
    }
  });

  test("loads and edits every Settings section without stale endpoints", async ({
    page,
  }) => {
    await openModule(page, names.module);
    let dialog = await openSettings(page);
    await expect(dialog.getByRole("heading", { name: "Models" })).toBeVisible();
    await expect(dialog.getByText("HTTP 404", { exact: false })).toHaveCount(0);
    await expect(dialog.getByRole("region", { name: "Model configuration" }))
      .toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "Activate codex" }))
      .toBeChecked();
    await expect(dialog.getByRole("combobox", { name: "Agent/provider" }))
      .toHaveValue("codex");
    // An input backed by a datalist exposes the ARIA combobox role.
    await expect(dialog.getByRole("combobox", { name: "Model" }))
      .toHaveValue("gpt-5.4");
    await expect(dialog.getByRole("combobox", { name: "Reasoning" }))
      .toHaveValue("medium");

    const claude = dialog.getByRole("checkbox", { name: "Activate claude" });
    const claudeWasActive = await claude.isChecked();
    await claude.setChecked(!claudeWasActive);
    await expect(dialog.getByText("1 unsaved change", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(claude).toBeChecked({ checked: claudeWasActive });
    await claude.setChecked(!claudeWasActive);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("Model configuration saved.");

    await dialog.getByRole("tab", { name: "Keyboard shortcuts" }).click();
    await expect(dialog.getByRole("heading", { name: "Keyboard shortcuts" }))
      .toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();

    dialog = await openSettings(page);
    await dialog.getByRole("tab", { name: "Models" }).click();
    await expect(dialog.getByRole("checkbox", { name: "Activate claude" }))
      .toBeChecked({ checked: !claudeWasActive });
    await dialog.getByRole("checkbox", { name: "Activate claude" })
      .setChecked(claudeWasActive);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("Model configuration saved.");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
  });

  test("confirms destructive issue deletion through visible UI", async ({ page }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.deletable);
    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete issue" });
    await expect(dialog).toContainText(fixture.deletable.key);
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("treeitem", { name: names.deletable }))
      .toHaveCount(0);
  });

  test("cancels a child deletion before removing it and releasing its parent", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.hierarchyParent);

    const children = page.getByTestId("child-issues");
    await children.getByRole("button", { name: new RegExp(names.hierarchyChild) })
      .click();
    await expect(page.getByTestId("issue-name")).toContainText(names.hierarchyChild);

    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    let dialog = page.getByRole("dialog", { name: "Delete issue" });
    await expect(dialog).toContainText(fixture.hierarchyChild.key);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId("issue-name")).toContainText(names.hierarchyChild);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.hierarchyChild);
    await page.getByRole("button", { name: "Issue actions" }).click();
    await page.getByRole("menuitem", { name: "Delete issue…" }).click();
    dialog = page.getByRole("dialog", { name: "Delete issue" });
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("treeitem", { name: names.hierarchyChild }))
      .toHaveCount(0);

    await openWorkItem(page, names.hierarchyParent);
    await expect(page.getByTestId("child-issues")).toContainText("No sub-tasks yet.");
    await page.getByRole("button", { name: "Issue actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete issue…" }))
      .toBeEnabled();
  });
});
