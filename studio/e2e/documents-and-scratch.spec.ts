import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createModule,
  createProject,
  createWorkItem,
  captureLegacyProductApiRequests,
  getProjects,
  getWorkflowCatalog,
  openModule,
  openWorkItem,
  refreshTaskDocuments,
  selectModuleForProfile,
} from "./support";

type ModuleRow = {
  id: string;
  name: string;
  sequence_id: number;
};

type WorkItemRow = {
  id: string;
  name: string;
  sequence_id: number;
};

test.describe.serial("Documents and Local scratch workspace", () => {
  let legacyProductApiRequests: string[] = [];
  let moduleFolder = "";
  let designPath = "";
  let moduleRow!: ModuleRow;
  let workItem!: WorkItemRow;
  let isolationWorkItem!: WorkItemRow;

  test.beforeEach(async ({ page }) => {
    legacyProductApiRequests = captureLegacyProductApiRequests(page);
  });

  test.afterEach(async () => {
    expect(legacyProductApiRequests).toEqual([]);
  });

  test.beforeAll(async ({ request }) => {
    moduleFolder = await mkdtemp(join(tmpdir(), "ticketry-documents-e2e-"));

    const projects = await getProjects(request);
    const project = projects.find((row) => row.slug === "CDN")
      ?? await createProject(request, {
        name: "Coding",
        slug: "CDN",
        description: "",
      });
    const issueTypes = (await getWorkflowCatalog(request, project.id))
      .issue_types.nodes;
    const moduleType = issueTypes.find((row) => row.name === "Module");
    const storyType = issueTypes.find((row) => row.name === "Story");
    expect(moduleType, "the seeded module issue type").toBeTruthy();
    expect(storyType, "the seeded Story issue type").toBeTruthy();

    moduleRow = await createModule(request, project.id, {
      name: "Documents Module",
      issue_type_id: moduleType!.id,
    });
    workItem = await createWorkItem(request, project.id, {
      name: "Document persistence task",
      parent_id: moduleRow.id,
      issue_type_id: storyType!.id,
    });
    isolationWorkItem = await createWorkItem(request, project.id, {
      name: "Workspace tab isolation task",
      parent_id: moduleRow.id,
      issue_type_id: storyType!.id,
    });

    await selectModuleForProfile(
      request,
      project.id,
      moduleRow.id,
      moduleFolder,
    );

    const designDirectory = join(
      moduleFolder,
      "spec",
      `documents-module--${moduleRow.id.slice(0, 8)}`,
      `T${workItem.sequence_id}--document-persistence-task`,
    );
    await mkdir(designDirectory, { recursive: true });
    designPath = join(designDirectory, "DESIGN.md");
    await writeFile(
      designPath,
      "# Canonical design\n\nInitial document body.\n",
      "utf8",
    );
    await writeFile(
      join(designDirectory, "NOTES.md"),
      "# Notes\n\nSecond document body.\n",
      "utf8",
    );
    const isolationDirectory = join(
      moduleFolder,
      "spec",
      `documents-module--${moduleRow.id.slice(0, 8)}`,
      `T${isolationWorkItem.sequence_id}--workspace-tab-isolation-task`,
    );
    await mkdir(isolationDirectory, { recursive: true });
    await writeFile(
      join(isolationDirectory, "DESIGN.md"),
      "# Isolated design\n",
      "utf8",
    );
    await writeFile(
      join(isolationDirectory, "NOTES.md"),
      "# Isolated notes\n",
      "utf8",
    );
    await expect.poll(async () =>
      (await refreshTaskDocuments(
        request,
        workItem.id,
        project.id,
        moduleRow.id,
      )).map((row) => row.relPath)
    ).toEqual(expect.arrayContaining(["DESIGN.md", "NOTES.md"]));
    await expect.poll(async () =>
      (await refreshTaskDocuments(
        request,
        isolationWorkItem.id,
        project.id,
        moduleRow.id,
      )).map((row) => row.relPath)
    ).toEqual(expect.arrayContaining(["DESIGN.md", "NOTES.md"]));
  });

  test.afterAll(async () => {
    if (moduleFolder) {
      await rm(moduleFolder, { recursive: true, force: true });
    }
  });

  test("[overhaul-web-11] discovers, preserves, and saves a task document across tab switches", async ({
    page,
  }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);

    const workspaceTabs = page.getByRole("tablist", {
      name: "Workspace tabs",
    });
    const detailsTab = workspaceTabs.getByRole("tab", { name: "Details" });
    const documentTab = workspaceTabs.getByRole("tab", { name: "DESIGN" });
    await expect(documentTab).toBeVisible();
    await documentTab.click();

    const editor = page.getByTestId("rich-markdown-editor-shell")
      .filter({ visible: true });
    const editable = editor.getByRole("textbox", { name: "editable markdown" });
    await expect(editable).toContainText("Initial document body.");
    await editable.click();
    await editable.press("ControlOrMeta+A");
    await editable.pressSequentially("Unsaved Playwright document draft");
    const actionRow = page.getByTestId("document-editor-action-row")
      .filter({ visible: true });
    const saveDocument = actionRow.getByRole("button", { name: "Save document" });
    await expect(saveDocument).toBeEnabled();

    await detailsTab.click();
    await expect(detailsTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("rich-markdown-editor-shell")
      .filter({ visible: true })).toHaveCount(0);
    await documentTab.click();
    await expect(editable).toContainText("Unsaved Playwright document draft");
    await expect(saveDocument).toBeEnabled();

    await saveDocument.click();
    const overwrite = actionRow.getByRole("button", { name: "Overwrite with mine" });
    await expect.poll(async () => {
      if (await overwrite.isVisible().catch(() => false)) return "conflict";
      return await saveDocument.isDisabled() ? "saved" : "pending";
    }).not.toBe("pending");
    if (await overwrite.isVisible().catch(() => false)) {
      await overwrite.click();
    }
    await expect(saveDocument).toBeDisabled();

    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const reloadedWorkspaceTabs = page.getByRole("tablist", {
      name: "Workspace tabs",
    });
    await reloadedWorkspaceTabs.getByRole("tab", { name: "DESIGN" }).click();
    await expect(
      page
        .getByTestId("rich-markdown-editor-shell")
        .getByRole("textbox", { name: "editable markdown" }),
    ).toContainText("Unsaved Playwright document draft");

    const reloadedEditor = page.getByTestId("rich-markdown-editor-shell")
      .filter({ visible: true });
    const reloadedEditable = reloadedEditor.getByRole("textbox", {
      name: "editable markdown",
    });
    await reloadedEditable.click();
    await reloadedEditable.press("ControlOrMeta+A");
    await reloadedEditable.pressSequentially("Document edit that must be discarded");
    const reloadedActionRow = page.getByTestId("document-editor-action-row")
      .filter({ visible: true });
    await reloadedActionRow.getByRole("button", { name: "Cancel editing" })
      .click();
    await expect(reloadedEditor).toHaveCount(0);
    await expect(reloadedActionRow).toHaveCount(0);
    await expect(page.getByTestId("markdown-document"))
      .toContainText("Unsaved Playwright document draft");
    await expect(page.getByTestId("markdown-document"))
      .not.toContainText("Document edit that must be discarded");
  });

  test("reorders workspace tabs and restores their order for the work item", async ({
    page,
  }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);

    const workspaceTabs = page.getByRole("tablist", {
      name: "Workspace tabs",
    });
    const details = workspaceTabs.getByRole("tab", { name: "Details" });
    const notes = workspaceTabs.getByRole("tab", { name: "NOTES" });
    await expect.poll(async () => workspaceTabs.getByRole("tab")
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label"))))
      .toEqual([
      "Details",
      "DESIGN",
      "NOTES",
      ]);
    await expect.poll(async () => workspaceTabs.getByRole("tab")
      .evaluateAll((tabs) => tabs.every((tab) => tab.draggable)))
      .toBe(true);

    const target = await details.boundingBox();
    expect(target).toBeTruthy();
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "UpdateWorkTrackerWorkspaceTabOrder"
    );
    await notes.dragTo(details, {
      targetPosition: { x: 2, y: target!.height / 2 },
    });
    await saved;
    await expect.poll(async () => workspaceTabs.getByRole("tab")
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label"))))
      .toEqual([
      "NOTES",
      "Details",
      "DESIGN",
      ]);

    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await expect.poll(async () => page.getByRole("tablist", { name: "Workspace tabs" })
      .getByRole("tab").evaluateAll((tabs) =>
        tabs.map((tab) => tab.getAttribute("aria-label"))))
      .toEqual([
      "NOTES",
      "Details",
      "DESIGN",
    ]);
  });

  test("keeps different persisted workspace-tab orders isolated by work item", async ({
    page,
  }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, isolationWorkItem.name);
    let workspaceTabs = page.getByRole("tablist", { name: "Workspace tabs" });
    const labels = () => workspaceTabs.getByRole("tab").evaluateAll((tabs) =>
      tabs.map((tab) => tab.getAttribute("aria-label"))
    );
    await expect.poll(labels).toEqual(["Details", "DESIGN", "NOTES"]);

    const notes = workspaceTabs.getByRole("tab", { name: "NOTES" });
    const design = workspaceTabs.getByRole("tab", { name: "DESIGN" });
    const target = await notes.boundingBox();
    expect(target).toBeTruthy();
    const saved = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") &&
      response.request().postDataJSON()?.operationName ===
        "UpdateWorkTrackerWorkspaceTabOrder"
    );
    await design.dragTo(notes, {
      targetPosition: { x: target!.width - 2, y: target!.height / 2 },
    });
    await saved;
    await expect.poll(labels).toEqual(["Details", "NOTES", "DESIGN"]);

    await openWorkItem(page, workItem.name);
    workspaceTabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await expect.poll(labels).toEqual(["NOTES", "Details", "DESIGN"]);

    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, isolationWorkItem.name);
    workspaceTabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await expect.poll(labels).toEqual(["Details", "NOTES", "DESIGN"]);
  });

  test("closes and reopens a document in its saved workspace position", async ({
    page,
  }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);

    const workspaceTabs = page.getByRole("tablist", {
      name: "Workspace tabs",
    });
    const visibleOrder = async () => workspaceTabs.getByRole("tab")
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label")));
    const initialOrder = await visibleOrder();
    expect(initialOrder).toEqual(expect.arrayContaining([
      "Details",
      "DESIGN",
      "NOTES",
    ]));

    await workspaceTabs.getByRole("tab", { name: "DESIGN" }).click();
    await page.keyboard.press("q");
    await expect(workspaceTabs.getByRole("tab", { name: "DESIGN" }))
      .toHaveCount(0);

    const reopen = page.getByRole("button", { name: "Reopen DESIGN" });
    await expect(reopen).toBeVisible();
    await reopen.click();
    await expect.poll(visibleOrder).toEqual(initialOrder);

    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await expect.poll(async () => page.getByRole("tablist", {
      name: "Workspace tabs",
    }).getByRole("tab").evaluateAll((tabs) =>
      tabs.map((tab) => tab.getAttribute("aria-label"))))
      .toEqual(initialOrder);
  });

  test("cycles workspace tabs in visible order with keyboard shortcuts", async ({
    page,
  }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);

    const workspaceTabs = page.getByRole("tablist", {
      name: "Workspace tabs",
    });
    const labels = await workspaceTabs.getByRole("tab")
      .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label")));
    const detailsIndex = labels.indexOf("Details");
    expect(detailsIndex).toBeGreaterThanOrEqual(0);
    const nextLabel = labels[(detailsIndex + 1) % labels.length];

    const details = workspaceTabs.getByRole("tab", { name: "Details" });
    await details.click();
    await page.keyboard.press("Meta+ArrowRight");
    await expect(workspaceTabs.getByRole("tab", { name: nextLabel! }))
      .toHaveAttribute("aria-selected", "true");

    await page.keyboard.press("Meta+ArrowLeft");
    await expect(details).toHaveAttribute("aria-selected", "true");
  });

  test("compares, reloads, and explicitly overwrites external document changes", async ({
    page,
  }) => {
    const subscriptionReady = page.waitForResponse((response) =>
      response.url().endsWith("/graphql/subscribe") && response.ok()
    );
    await openModule(page, moduleRow.name);
    await subscriptionReady;
    await openWorkItem(page, workItem.name);
    await page.getByRole("tablist", { name: "Workspace tabs" })
      .getByRole("tab", { name: "DESIGN" }).click();

    const editor = page.getByTestId("rich-markdown-editor-shell")
      .filter({ visible: true });
    const editable = editor.getByRole("textbox", { name: "editable markdown" });
    await editable.click();
    await editable.press("ControlOrMeta+A");
    await editable.pressSequentially("Local draft retained during comparison");

    await writeFile(
      designPath,
      "# Canonical design\n\nExternal disk version.\n",
      "utf8",
    );
    // Reconnect forces the live feed's canonical catch-up. This covers the
    // case where the file changed while no active agent-owned watcher existed.
    await page.context().setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await page.context().setOffline(false);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);

    const actionRow = page.getByTestId("document-editor-action-row")
      .filter({ visible: true });
    await expect(actionRow).toContainText(
      "This document changed on disk. Your edits are still here.",
      { timeout: 15_000 },
    );
    await expect(editable).toContainText("Local draft retained during comparison");

    await actionRow.getByRole("button", { name: "Compare versions" }).click();
    const comparison = page.getByRole("region", {
      name: "Document comparison",
    });
    await expect(comparison.getByRole("heading", { name: "Mine" }))
      .toBeVisible();
    await expect(comparison).toContainText("Local draft retained during comparison");
    await expect(comparison.getByRole("heading", { name: "On disk" }))
      .toBeVisible();
    await expect(comparison).toContainText("External disk version.");

    await actionRow.getByRole("button", {
      name: "Reload external version",
    }).click();
    const confirmation = page.getByRole("dialog", {
      name: "Reload external version?",
    });
    await expect(confirmation).toContainText(
      "Your unsaved edits will be discarded",
    );
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(editable).toContainText("Local draft retained during comparison");
    await expect(actionRow).toContainText(
      "This document changed on disk. Your edits are still here.",
    );

    await actionRow.getByRole("button", {
      name: "Reload external version",
    }).click();
    const confirmedReload = page.getByRole("dialog", {
      name: "Reload external version?",
    });
    await confirmedReload.getByRole("button", { name: "Reload theirs" }).click();

    await expect(editable).toContainText("External disk version.");
    await expect(editable).not.toContainText(
      "Local draft retained during comparison",
    );
    await expect(comparison).toHaveCount(0);
    await expect(actionRow.getByRole("button", { name: "Save document" }))
      .toBeDisabled();

    await editable.click();
    await editable.press("ControlOrMeta+A");
    await editable.pressSequentially("Local overwrite wins");
    await writeFile(
      designPath,
      "# Canonical design\n\nSecond external disk version.\n",
      "utf8",
    );
    await page.context().setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await page.context().setOffline(false);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(actionRow).toContainText(
      "This document changed on disk. Your edits are still here.",
      { timeout: 15_000 },
    );

    await actionRow.getByRole("button", { name: "Save document" }).click();
    await expect(actionRow).toContainText(
      "This document changed on disk before your save.",
    );
    await actionRow.getByRole("button", { name: "Overwrite with mine" })
      .click();
    await expect(actionRow.getByRole("button", { name: "Overwrite with mine" }))
      .toHaveCount(0);
    await expect(actionRow.getByRole("button", { name: "Save document" }))
      .toBeDisabled();
    await expect.poll(() => readFile(designPath, "utf8"))
      .toContain("Local overwrite wins");

    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await page.getByRole("tablist", { name: "Workspace tabs" })
      .getByRole("tab", { name: "DESIGN" }).click();
    await expect(page.getByTestId("rich-markdown-editor-shell")
      .filter({ visible: true }))
      .toContainText("Local overwrite wins");
  });

  test("converges external document creation and deletion through the Rust registry", async ({
    page,
  }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);

    const workspaceTabs = page.getByRole("tablist", {
      name: "Workspace tabs",
    });
    const livePath = join(dirname(designPath), "LIVE.md");
    await writeFile(
      livePath,
      "# Live document\n\nDiscovered by Rust registry convergence.\n",
      "utf8",
    );

    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const liveTab = workspaceTabs.getByRole("tab", { name: "LIVE" });
    await expect(liveTab).toBeVisible();
    await liveTab.click();
    await expect(page.getByTestId("rich-markdown-editor-shell")
      .filter({ visible: true }))
      .toContainText("Discovered by Rust registry convergence.");

    await workspaceTabs.getByRole("tab", { name: "Details" }).click();
    await unlink(livePath);
    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await expect(liveTab).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reopen LIVE" }))
      .toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Workspace tabs" })
      .getByRole("tab", { name: "LIVE" })).toHaveCount(0);
  });

  test("serves an HTML document with a sibling asset through the Rust document route", async ({
    page,
    request,
  }) => {
    const reportDirectory = dirname(designPath);
    const reportPath = join(reportDirectory, "REPORT.html");
    const outsideStylesheet = join(moduleFolder, "outside-secret.css");
    await writeFile(outsideStylesheet, "body { font-size: 99px; }\n", "utf8");
    await symlink(outsideStylesheet, join(reportDirectory, "leak.css"));
    await writeFile(
      reportPath,
      [
        "<!doctype html>",
        '<html><head><link rel="stylesheet" href="report.css">',
        '<link rel="stylesheet" href="leak.css"></head>',
        '<body><h1>Rust document report</h1>',
        '<script>let parentAccess = "allowed";',
        'try { parent.document.body.dataset.htmlDocumentEscape = "bad"; }',
        'catch { parentAccess = "blocked"; }',
        'document.body.dataset.parentAccess = parentAccess;',
        'document.body.dataset.script = "ready";</script></body></html>',
      ].join(""),
      "utf8",
    );
    await writeFile(
      join(reportDirectory, "report.css"),
      "body { background: rgb(12, 34, 56); color: white; }\n",
      "utf8",
    );
    const projects = await getProjects(request);
    const project = projects.find((row) => row.slug === "CDN");
    expect(project).toBeTruthy();
    await expect.poll(async () =>
      (await refreshTaskDocuments(
        request,
        workItem.id,
        project!.id,
        moduleRow.id,
      )).map((row) => row.relPath)
    ).toContain("REPORT.html");

    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const assetResponse = page.waitForResponse((response) =>
      response.url().endsWith("/report.css") && response.ok()
    );
    const escapedAssetResponse = page.waitForResponse((response) =>
      response.url().endsWith("/leak.css")
    );
    await page.getByRole("tablist", { name: "Workspace tabs" })
      .getByRole("tab", { name: "REPORT" }).click();
    const response = await assetResponse;
    expect(response.headers()["content-type"]).toContain("text/css");
    expect((await escapedAssetResponse).status()).toBe(404);

    const frame = page.frameLocator('[data-testid="workspace-doc-frame"]');
    await expect(frame.getByRole("heading", { name: "Rust document report" }))
      .toBeVisible();
    await expect(frame.locator("body")).toHaveAttribute("data-script", "ready");
    await expect(frame.locator("body")).toHaveAttribute(
      "data-parent-access",
      "blocked",
    );
    await expect(page.locator("body")).not.toHaveAttribute(
      "data-html-document-escape",
      "bad",
    );
    await expect.poll(() => frame.locator("body").evaluate((body) =>
      getComputedStyle(body).backgroundColor)).toBe("rgb(12, 34, 56)");
    await expect.poll(() => frame.locator("body").evaluate((body) =>
      getComputedStyle(body).fontSize)).not.toBe("99px");

    await page.reload();
    await expect(page.getByRole("tablist", { name: "Workspace tabs" })
      .getByRole("tab", { name: "REPORT" })).toBeVisible();
  });

  test("[web-scratch-01] starts a new conversation through the default launch policy", async ({
    page,
  }) => {
    await openModule(page, moduleRow.name);
    let launchVariables: Record<string, unknown> | undefined;
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.operationName !== "CreateTerminalSession") {
        await route.continue();
        return;
      }
      launchVariables = body.variables;
      const runId = "e2e-scratch-run";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            terminal_session: {
              __typename: "AgentTerminalSessions",
              agent_run_id: runId,
              module_id: body.variables.moduleId,
              scope: "instant",
              doc_rel_path: null,
              created_at: "2026-09-04T12:00:00Z",
              agent_run: {
                __typename: "AgentRuns",
                id: runId,
                agent: "codex",
                launch_state: null,
                launch_model: null,
              },
            },
          },
        }),
      });
    });
    await page
      .getByRole("treeitem", { name: "New conversation" })
      .click();

    await expect.poll(() => launchVariables).toMatchObject({ kind: "instant" });
    expect(launchVariables).not.toHaveProperty("provider");
    expect(launchVariables).not.toHaveProperty("model");
    expect(launchVariables).not.toHaveProperty("reasoning");
    expect(launchVariables).not.toHaveProperty("prompt");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.unroute("**/graphql");
  });
});
