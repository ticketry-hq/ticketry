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
  createWorkItem,
  openModule,
  openWorkItem,
  responseJson,
  linkModuleFolder,
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

  const projects = await responseJson<ProjectRow[]>(
    await request.get("/api/work-tracker/projects"),
  );
  fixture.project = projects.find((project) => project.slug === "CDN")
    ?? await responseJson<ProjectRow>(await request.post(
      "/api/work-tracker/projects",
      { data: { name: "Coding", slug: "CDN", description: "" } },
    ));

  const issueTypes = await responseJson<IssueTypeRow[]>(await request.get(
    `/api/work-tracker/projects/${fixture.project.id}/issue-types`,
  ));
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

  const modules = await responseJson<ModuleRow[]>(await request.get(
    `/api/work-tracker/projects/${fixture.project.id}/modules`,
  ));
  fixture.module = modules.find((module) => module.name === names.module)
    ?? await responseJson<ModuleRow>(await request.post(
      `/api/work-tracker/projects/${fixture.project.id}/modules`,
      { data: { name: names.module, issue_type_id: moduleType!.id } },
    ));
  fixture.secondModule = modules.find((module) =>
    module.name === names.secondModule
  ) ?? await responseJson<ModuleRow>(await request.post(
    `/api/work-tracker/projects/${fixture.project.id}/modules`,
    { data: { name: names.secondModule, issue_type_id: moduleType!.id } },
  ));
  await linkModuleFolder(
    request,
    fixture.module.id,
    fixture.folder,
  );

  fixture.states = await responseJson<StateRow[]>(await request.get(
    `/api/work-tracker/projects/${fixture.project.id}/states`,
  ));
  const existingItems = await responseJson<WorkItemRow[]>(await request.get(
    `/api/work-tracker/work-items?project=${fixture.project.id}`,
  ));
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
    await expect(page.getByRole("treeitem", { name: names.parent })).toHaveCount(0);
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

  test("moves state, reorders rows, and preserves collapsed groups", async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.moving);

    await page.getByTestId("state-picker").getByRole("button").click();
    // Story workflows begin Grill → Cancelled. Follow a real configured edge so
    // this test exercises a successful move rather than the rollback path.
    await page.getByRole("button", { name: "Cancelled", exact: true }).click();
    await expect(page.getByTestId("state-picker")).toContainText("Cancelled");
    // Verify the optimistic picker result reached the durable server state
    // before continuing with the independent ordering checks.
    const cancelledId = fixture.states.find((state) =>
      state.name === "Cancelled"
    )!.id;
    await expect.poll(async () => {
      const item = await responseJson<WorkItemRow>(await page.request.get(
        `/api/work-tracker/work-items/${fixture.moving.id}`,
      ));
      const state = (item as unknown as {
        state: string | { id: string };
      }).state;
      return typeof state === "string" ? state : state.id;
    }).toBe(cancelledId);

    const first = page.getByRole("treeitem", { name: names.reorderFirst });
    const second = page.getByRole("treeitem", { name: names.reorderSecond });
    await second.dragTo(first);
    await expect.poll(async () => {
      const labels = await page.getByRole("treeitem").allTextContents();
      return labels.findIndex((label) => label.includes(names.reorderSecond))
        < labels.findIndex((label) => label.includes(names.reorderFirst));
    }).toBe(true);

    await page.getByRole("button", { name: "Collapse Grill" }).click();
    await page.reload();
    await expect(page.getByRole("button", { name: "Expand Grill" })).toBeVisible();
    await page.getByRole("button", { name: "Expand Grill" }).click();
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
    const trigger = page.getByRole("button", { name: "Open Keyboard Shortcuts" });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
    await expect(dialog).toBeVisible();
    const filter = dialog.getByRole("searchbox", {
      name: "Filter keyboard shortcuts",
    });
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
    await expect(panel.getByRole("tablist", { name: "Issue types" }))
      .toBeVisible();
    await expect(panel.getByRole("heading", { name: "Launch configuration" }))
      .toBeVisible();
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
    await page.route(
      `**/api/work-tracker/work-items/${fixture.parent.id}/launch-agent`,
      async (route) => {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ detail: "provider unavailable" }),
        });
      },
    );

    await page.getByRole("button", { name: "Run agent" }).click();
    const alert = page.getByRole("alert").filter({
      hasText: "Agent run could not be started",
    });
    await expect(alert).toContainText("provider unavailable");
    await alert.getByRole("button", { name: "Dismiss" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByTestId("issue-name")).toContainText(
      names.parentRenamed,
    );
  });

  test("loads and edits every Settings section without stale endpoints", async ({
    page,
  }) => {
    const api404s: string[] = [];
    page.on("response", (response) => {
      if (response.status() === 404 && response.url().includes("/api/")) {
        api404s.push(response.url());
      }
    });
    await openModule(page, names.module);
    let dialog = await openSettings(page);
    await expect(dialog.getByRole("heading", { name: "States" })).toBeVisible();
    await expect(dialog.getByText("HTTP 404", { exact: false })).toHaveCount(0);

    await dialog.getByRole("button", { name: "Add state" }).click();
    await dialog.getByRole("textbox", { name: "State name", exact: true })
      .fill("E2E paused");
    await dialog.getByRole("combobox", { name: "State group" })
      .selectOption("started");
    await dialog.getByRole("button", { name: "Create state" }).click();
    let stateRow = dialog.getByRole("listitem", { name: "E2E paused state" });
    await expect(stateRow).toBeVisible();
    const stateName = stateRow.getByRole("textbox", {
      name: "State name for E2E paused",
    });
    await stateName.fill("E2E paused renamed");
    await stateName.blur();
    stateRow = dialog.getByRole("listitem", { name: "E2E paused renamed state" });
    await expect(stateRow).toBeVisible();
    await stateRow.getByRole("button", { name: "Move E2E paused renamed earlier" })
      .click();
    await stateRow.getByRole("button", { name: "Delete E2E paused renamed" })
      .click();
    const deleteDialog = page.getByRole("dialog", {
      name: "Delete E2E paused renamed?",
    });
    await expect(deleteDialog).toContainText("Nothing is in this state");
    await deleteDialog.getByRole("button", { name: "Delete state" }).click();
    await expect(dialog.getByRole("listitem", {
      name: "E2E paused renamed state",
    })).toHaveCount(0);

    await dialog.getByRole("tab", { name: "Issue types" }).click();
    await expect(dialog.getByRole("heading", { name: "Issue types" })).toBeVisible();
    await dialog.getByRole("tab", { name: "Story", exact: true }).click();
    await expect(dialog.getByRole("combobox", { name: "Start State" }))
      .not.toHaveValue("");
    const workflowStates = dialog.getByRole("list", {
      name: "Story workflow states",
    });
    await expect(workflowStates.getByRole("listitem").first()).toBeVisible();
    const launchButton = workflowStates.getByRole("button", {
      name: /^Expand .* launch configuration$/,
    }).first();
    await launchButton.click();
    await expect(workflowStates.getByRole("textbox", { name: "Prompt" }).first())
      .toBeVisible();
    const transition = workflowStates.getByRole("button", {
      name: /^Expand .* to /,
    }).first();
    if (await transition.isVisible().catch(() => false)) {
      await transition.click();
      const permission = workflowStates.getByRole("checkbox", {
        name: /^Agents may move /,
      }).first();
      const wasChecked = await permission.isChecked();
      // This controlled input applies immediately through the API, then
      // refreshes from the canonical workflow. A plain click lets that async
      // round-trip complete before Playwright asserts the resulting state.
      await permission.click();
      await expect(permission).toBeChecked({ checked: !wasChecked });
      await permission.click();
      await expect(permission).toBeChecked({ checked: wasChecked });
    }

    await dialog.getByRole("tab", { name: "Models" }).click();
    await expect(dialog.getByRole("region", { name: "Model configuration" }))
      .toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "Activate codex" }))
      .toBeChecked();
    await expect(dialog.getByRole("combobox", { name: "Agent/provider" }))
      .toHaveValue("codex");
    // An input backed by a datalist exposes the ARIA combobox role.
    await expect(dialog.getByRole("combobox", { name: "Model" }))
      .toHaveValue("gpt-5.6-luna");
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
    expect(api404s).toEqual([]);
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
