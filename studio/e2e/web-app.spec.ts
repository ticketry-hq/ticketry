import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  acknowledgeOnboarding,
  createModule,
  createProject,
  createWorkItem,
  getModules,
  getProjects,
  getWorkItems,
  getWorkflowCatalog,
  openModule,
  openWorkItem,
  selectModuleForProfile,
  type ApiRow,
  type ModuleRow,
  type ProjectRow,
  type WorkItemRow,
} from "./support";

type IssueTypeRow = ApiRow & { level: "task" | "module" };
type StateRow = ApiRow & {
  color: string | null;
  group: string;
  sort_order: number;
};

const names = {
  module: "Complete Web App",
  secondModule: "Navigation Target",
  parent: "Complete parent",
  parentRenamed: "Complete parent renamed",
  blocker: "Complete blocker",
  moving: "Complete moving",
  reorderFirst: "Complete reorder first",
  reorderSecond: "Complete reorder second",
  deletable: "Complete disposable",
};

const fixture: {
  folder: string;
  project: ProjectRow;
  module: ModuleRow;
  secondModule: ModuleRow;
  storyType: IssueTypeRow;
  implementationType: IssueTypeRow;
  states: StateRow[];
  parent: WorkItemRow;
  blocker: WorkItemRow;
  moving: WorkItemRow;
  reorderFirst: WorkItemRow;
  reorderSecond: WorkItemRow;
  deletable: WorkItemRow;
} = {} as never;

async function seedProject(request: APIRequestContext): Promise<void> {
  fixture.folder = await mkdtemp(join(tmpdir(), "ticketry-web-e2e-"));
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
  fixture.deletable = await ensureItem(names.deletable, rootStory);
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

test.beforeAll(async ({ request }) => {
  await seedProject(request);
});

test.afterAll(async () => {
  if (fixture.folder) {
    await rm(fixture.folder, { recursive: true, force: true });
  }
});

test.describe("complete browser application", () => {
  test("creates a module with a local folder and restores it as the selected workspace", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await page.getByRole("button", { name: "Add module" }).click();

    const dialog = page.getByRole("dialog", { name: "Add Module" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Module name").fill("Browser-created module");
    await dialog.getByRole("textbox", { name: "Module folder" })
      .fill(fixture.folder);
    await dialog.getByRole("button", { name: "Create module" }).click();

    await expect(dialog).toHaveCount(0);
    const createdTab = page.getByRole("tab", {
      name: "Browser-created module",
    });
    await expect(createdTab).toHaveAttribute("aria-selected", "true");

    await page.reload();
    await expect(page.getByRole("tab", { name: "Browser-created module" }))
      .toHaveAttribute("aria-selected", "true");
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

  test("edits details, hierarchy, blockers, type, and persistent panel state", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parent);

    await page.getByTestId("issue-name").click();
    const nameEditor = page.getByRole("textbox", { name: "Name" });
    await nameEditor.fill(names.parentRenamed);
    await nameEditor.press("Enter");
    await expect(page.getByRole("treeitem", {
      name: new RegExp(names.parentRenamed),
    })).toBeVisible();
    await editDescription(page, "Description saved through the real editor");

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

    await page.getByRole("button", { name: "Add blocker" }).click();
    await page.getByRole("button", { name: new RegExp(names.blocker) }).click();
    await expect(page.getByTestId("blocked-by-row")).toContainText(
      fixture.blocker.key,
    );
    await page.getByRole("button", { name: "Remove blocker" }).click();
    await expect(page.getByTestId("blocked-by-row")).not.toContainText(
      fixture.blocker.key,
    );

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

  test("reorders rows and preserves collapsed groups", async ({
    page,
  }) => {
    await openModule(page, names.module);

    const first = page.getByRole("treeitem", { name: names.reorderFirst });
    const second = page.getByRole("treeitem", { name: names.reorderSecond });
    await second.dragTo(first);
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
    const handle = page.getByTestId("pane-resize-handle").first();
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
    const restored = Number(await page.getByTestId("pane-resize-handle").first()
      .getAttribute("aria-valuenow"));
    expect(Math.abs(restored - resized)).toBeLessThanOrEqual(1);
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
      name: "Filter keyboard shortcuts",
    });
    await filter.click();
    await expect(filter).toBeFocused();
    await filter.fill("definitely-no-such-shortcut");
    await expect(dialog.getByRole("status")).toContainText(
      "No keyboard shortcuts match",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.keyboard.press("/");
    await expect(page.getByRole("textbox", { name: "Search stories" })).toBeFocused();
  });

  test("opens state policy from the board and closes back to the selected issue", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parentRenamed);

    await page.getByRole("button", { name: "Configure Grill state" }).click();
    const panel = page.getByRole("region", {
      name: "Grill state configuration",
    });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Grill" })).toBeVisible();
    await panel.getByRole("button", {
      name: "Close Grill state configuration",
    }).click();

    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("issue-name")).toContainText(
      names.parentRenamed,
    );
  });

  test("surfaces and dismisses an agent-launch failure without leaving the workspace", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parentRenamed);

    await page.getByRole("button", { name: "Run agent" }).click();
    const alert = page.getByRole("alert").filter({
      hasText: "Agent run could not be started",
    });
    await expect(alert).toContainText("requires the Ticketry desktop runtime");
    await alert.getByRole("button", { name: "Dismiss" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByTestId("issue-name")).toContainText(
      names.parentRenamed,
    );
  });

  test("loads and edits every Settings section without stale endpoints", async ({
    page,
  }) => {
    const legacyApiRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/work-tracker")) {
        legacyApiRequests.push(request.url());
      }
    });
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
    expect(legacyApiRequests).toEqual([]);
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
});
