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
  graphql,
  getWorkItem,
  createModule,
  createProject,
  createWorkItem,
  captureLegacyProductApiRequests,
  getProjects,
  getWorkflowCatalog,
  openWorkItem,
  refreshTaskDocuments,
  selectModuleForProfile,
} from "../support";

import { TaskDocumentRegistryDocument } from "../../src/features/documents/generated/documentRegistry.documents";
import { UpdateWorkTrackerWorkItemDetailsDocument } from "../../src/features/work-items/generated/workItems.documents";
import { openFeatureModule as openModule } from "../work-items-migration-support";
import { featureSuite } from "./featureSuite";

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

featureSuite("descriptions-and-documents", () => {
  let legacyProductApiRequests: string[] = [];
  let moduleFolder = "";
  let designPath = "";
  let moduleRow!: ModuleRow;
  let workItem!: WorkItemRow;
  let isolationWorkItem!: WorkItemRow;
  let descriptionA!: WorkItemRow;
  let descriptionB!: WorkItemRow;
  let projectId = "";
  let storyTypeId = "";

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
    projectId = project.id;
    const issueTypes = (await getWorkflowCatalog(request, project.id))
      .issue_types.nodes;
    const moduleType = issueTypes.find((row) => row.name === "Module");
    const storyType = issueTypes.find((row) => row.name === "Story");
    expect(moduleType, "the seeded module issue type").toBeTruthy();
    expect(storyType, "the seeded Story issue type").toBeTruthy();
    storyTypeId = storyType!.id;

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

    descriptionA = await createWorkItem(request, project.id, {
      name: "Tab through a rich description", parent_id: moduleRow.id,
      issue_type_id: storyType!.id, description: "A plain description paragraph",
    });
    descriptionB = await createWorkItem(request, project.id, {
      name: "Description isolation second story", parent_id: moduleRow.id,
      issue_type_id: storyType!.id, description: "",
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

  test("[overhaul-web-11] discovers, preserves, and saves a task document across tab switches", { tag: "@case-overhaul-web-11" }, async ({
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

    const editor = page.getByTestId("document-editor-scroll-region").getByTestId("rich-markdown-editor-shell")
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
    await expect(page.getByTestId("document-editor-scroll-region").getByTestId("rich-markdown-editor-shell")
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
        .getByTestId("document-editor-scroll-region").getByTestId("rich-markdown-editor-shell")
        .getByRole("textbox", { name: "editable markdown" }),
    ).toContainText("Unsaved Playwright document draft");

    const reloadedEditor = page.getByTestId("document-editor-scroll-region").getByTestId("rich-markdown-editor-shell")
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

  test("compares, reloads, and explicitly overwrites external document changes", { tag: "@case-documents-conflict-recovery" }, async ({
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

    const editor = page.getByTestId("document-editor-scroll-region").getByTestId("rich-markdown-editor-shell")
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
    await expect(page.getByTestId("document-editor-scroll-region").getByTestId("rich-markdown-editor-shell")
      .filter({ visible: true }))
      .toContainText("Local overwrite wins");
  });

  test("converges external document creation and deletion through the Rust registry", { tag: "@case-documents-registry-convergence" }, async ({
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
    await expect(page.getByTestId("document-editor-scroll-region").getByTestId("rich-markdown-editor-shell")
      .filter({ visible: true }))
      .toContainText("Discovered by Rust registry convergence.");

    await workspaceTabs.getByRole("tab", { name: "Details" }).click();
    await unlink(livePath);
    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await expect(liveTab).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Reopen LIVE" }))
      .toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Workspace tabs" })
      .getByRole("tab", { name: "LIVE" })).toHaveCount(0);
  });

  test("serves an HTML document with a sibling asset through the Rust document route", { tag: "@case-documents-html-assets" }, async ({
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

  test("Tab leaves prose in the rich Details description (desktop)", { tag: "@case-documents-rich-tab-desktop" }, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openModule(page, moduleRow.name);
    await page.getByRole("treeitem", { name: new RegExp(descriptionA.name) }).click();
    const editor = page.getByTestId("issue-description")
      .locator('.mdxeditor-root-contenteditable [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => {
      const focused = document.activeElement;
      return focused instanceof HTMLElement
        && focused !== document.body
        && !focused.closest('[data-testid="issue-description"]');
    })).toBe(true);
  });

  test("Tab leaves prose in the rich Details description (narrow)", { tag: "@case-documents-rich-tab-narrow" }, async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 520 });
    await openModule(page, moduleRow.name);
    await page.getByRole("treeitem", { name: new RegExp(descriptionA.name) }).click();
    const editor = page.getByTestId("issue-description")
      .locator('.mdxeditor-root-contenteditable [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => {
      const focused = document.activeElement;
      return focused instanceof HTMLElement
        && focused !== document.body
        && !focused.closest('[data-testid="issue-description"]');
    })).toBe(true);
  });

  test("retains refused description writes and retries with isolated durable drafts", { tag: "@case-documents-description-recovery" }, async ({ page, request }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, descriptionB.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    const description = page.getByTestId("issue-description").filter({ visible: true });
    const editable = description.getByRole("textbox", { name: "editable markdown" });
    await expect(editable).toBeVisible();
    await expect(editable).toHaveText("");
    let refused = 0;
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.operationName === "UpdateWorkTrackerWorkItemDetails" && body.variables.id.replaceAll("-", "") === descriptionB.id.replaceAll("-", "")) {
        refused += 1;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Description write refused at boundary" }] }) });
      } else await route.continue();
    });
    await editable.fill("Story B refused draft survives");
    await expect(description).toContainText("Description not saved:");
    expect(refused).toBeGreaterThan(0);
    expect((await getWorkItem(request, descriptionB.id)).description).toBe("");
    await expect(editable).toContainText("Story B refused draft survives");
    await page.unroute("**/graphql");
    await editable.fill("Story B durable distinct description");
    await tabs.getByRole("tab", { name: "Details" }).click();
    await expect.poll(async () => (await getWorkItem(request, descriptionB.id)).description)
      .toContain("Story B durable distinct description");
    await openWorkItem(page, descriptionA.name);
    const first = page.getByTestId("issue-description").filter({ visible: true })
      .getByRole("textbox", { name: "editable markdown" });
    await first.fill("Story A durable independent description");
    await openWorkItem(page, descriptionB.name);
    await expect.poll(async () => (await getWorkItem(request, descriptionA.id)).description)
      .toContain("Story A durable independent description");
    await expect(editable).toContainText("Story B durable distinct description");
    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, descriptionA.name);
    await expect(first).toContainText("Story A durable independent description");
    await expect(first).not.toContainText("Story B durable distinct description");
    await openWorkItem(page, descriptionB.name);
    await expect(editable).toContainText("Story B durable distinct description");
    await expect(editable).not.toContainText("Story A durable independent description");
  });

  test("refreshes clean descriptions and offers dirty keep or load choices", { tag: "@case-documents-description-external" }, async ({ page, request }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, descriptionA.name);
    const description = page.getByTestId("issue-description").filter({ visible: true });
    const editable = description.getByRole("textbox", { name: "editable markdown" });
    const update = async (text: string) => graphql(request, UpdateWorkTrackerWorkItemDetailsDocument, {
      id: descriptionA.id, description: text,
    });
    await update("Clean server refresh appears");
    await expect(editable).toContainText("Clean server refresh appears");
    await page.route("**/graphql", async (route) => {
      if (route.request().postDataJSON()?.operationName === "UpdateWorkTrackerWorkItemDetails") await route.abort();
      else await route.continue();
    });
    await editable.fill("Dirty local keep choice");
    await update("External server baseline one");
    const notice = page.getByTestId("description-external-change").filter({ visible: true });
    await expect(notice).toBeVisible();
    await expect(editable).toContainText("Dirty local keep choice");
    await notice.getByRole("button", { name: "Keep my draft" }).click();
    await expect(notice).toHaveCount(0);
    await page.unroute("**/graphql");
    await editable.fill("Dirty local keep choice durable");
    await expect.poll(async () => (await getWorkItem(request, descriptionA.id)).description)
      .toContain("Dirty local keep choice durable");
    await page.route("**/graphql", async (route) => {
      if (route.request().postDataJSON()?.operationName === "UpdateWorkTrackerWorkItemDetails") await route.abort();
      else await route.continue();
    });
    await editable.fill("Dirty local discard choice");
    await update("External server version loaded");
    await expect(notice).toBeVisible();
    await notice.getByRole("button", { name: "Load the server version" }).click();
    await expect(editable).toContainText("External server version loaded");
    await expect(editable).not.toContainText("Dirty local discard choice");
    await page.unroute("**/graphql");
    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, descriptionA.name);
    await expect(editable).toContainText("External server version loaded");
    expect((await getWorkItem(request, descriptionA.id)).description).toBe("External server version loaded");
  });

  test("rolls back refused document saves then persists through periodic autosave", { tag: "@case-documents-save-recovery" }, async ({ page }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: "DESIGN" }).click();
    const editable = page.getByTestId("document-editor-scroll-region").getByTestId("rich-markdown-editor-shell").filter({ visible: true })
      .getByRole("textbox", { name: "editable markdown" });
    const actions = page.getByTestId("document-editor-action-row").filter({ visible: true });
    const original = await readFile(designPath, "utf8");
    await page.route("**/graphql", async (route) => {
      if (route.request().postDataJSON()?.operationName === "SaveDesignDocument") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Document save refused" }] }) });
      } else await route.continue();
    });
    await editable.fill("Document retry draft remains intact");
    await actions.getByRole("button", { name: "Save document" }).click();
    await expect(actions).toContainText("Save failed");
    await expect(editable).toContainText("Document retry draft remains intact");
    expect(await readFile(designPath, "utf8")).toBe(original);
    await page.unroute("**/graphql");
    await expect.poll(() => readFile(designPath, "utf8"), { timeout: 20_000 })
      .toContain("Document retry draft remains intact");
    await expect(actions.getByRole("button", { name: "Save document" })).toBeDisabled();
    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: "DESIGN" }).click();
    await expect(editable).toContainText("Document retry draft remains intact");
  });

  test("recovers document load and registry refresh failures without deleting known tabs", { tag: "@case-documents-registry-recovery" }, async ({ page, request }) => {
    await page.route("**/documents/**/NOTES.md", (route) => route.abort());
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await expect(tabs.getByRole("tab", { name: "NOTES" })).toBeVisible();
    await tabs.getByRole("tab", { name: "NOTES" }).click();
    await expect(page.getByRole("alert")).toContainText("Unable to load this document.");
    await page.unroute("**/documents/**/NOTES.md");
    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await tabs.getByRole("tab", { name: "NOTES" }).click();
    await expect(page.getByTestId("document-editor-scroll-region").getByTestId("rich-markdown-editor-shell").filter({ visible: true }))
      .toContainText("Second document body.");
    let refreshFailures = 0;
    await page.route("**/graphql", async (route) => {
      if (route.request().postDataJSON()?.operationName === "RefreshTaskDocumentRegistry") {
        refreshFailures += 1;
        await route.abort();
      } else await route.continue();
    });
    await openWorkItem(page, descriptionB.name);
    await openWorkItem(page, workItem.name);
    await expect.poll(() => refreshFailures).toBeGreaterThan(0);
    const registry = await graphql(request, TaskDocumentRegistryDocument, { taskId: workItem.id });
    expect(registry.document_registry.nodes.map((row) => row.relPath)).toContain("NOTES.md");
    await expect(tabs.getByRole("tab", { name: "NOTES" })).toBeVisible();
    await page.unroute("**/graphql");
    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await expect(tabs.getByRole("tab", { name: "NOTES" })).toBeVisible();
  });

  test("preserves malformed description source and saves repaired Markdown", { tag: "@case-documents-description-fallback" }, async ({ page, request }) => {
    const broken = "Preserve malformed Markdown source\n\n<Component";
    const subject = await createWorkItem(request, projectId, {
      name: "Malformed description fallback fixture", parent_id: moduleRow.id,
      issue_type_id: storyTypeId, description: broken,
    });
    await openModule(page, moduleRow.name);
    await openWorkItem(page, subject.name);
    const description = page.getByTestId("issue-description").filter({ visible: true });
    await expect(description).toContainText("Rich editing is unavailable for this description.");
    const source = description.getByRole("textbox", { name: "Ticket description source" });
    await expect(source).toHaveValue(broken);
    await source.fill("# Repaired Markdown\n\n**Durable repaired text**");
    await expect.poll(async () => (await getWorkItem(request, subject.id)).description)
      .toContain("**Durable repaired text**");
    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, subject.name);
    const editable = description.getByRole("textbox", { name: "editable markdown" });
    await expect(editable.getByRole("heading", { name: "Repaired Markdown" })).toBeVisible();
    await expect(editable.locator("strong")).toHaveText("Durable repaired text");
    await editable.focus();
    await description.locator('[aria-label="Source mode"]').click();
    await expect(description.locator(".cm-editor")).toContainText("**Durable repaired text**");
    await description.locator('[aria-label="Rich text"]').click();
    await expect(editable.locator("strong")).toHaveText("Durable repaired text");
  });

  test("serializes description writes and preserves edits typed during an in-flight save", { tag: "@case-documents-description-serialization" }, async ({ page, request }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, descriptionA.name);
    const editable = page.getByTestId("issue-description").filter({ visible: true })
      .getByRole("textbox", { name: "editable markdown" });
    const baseline = (await getWorkItem(request, descriptionA.id)).description;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const writes: string[] = [];
    let active = 0;
    let maxActive = 0;
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.operationName !== "UpdateWorkTrackerWorkItemDetails"
        || body.variables.id.replaceAll("-", "") !== descriptionA.id.replaceAll("-", "")) {
        await route.continue();
        return;
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      writes.push(body.variables.description);
      if (writes.length === 1) await gate;
      await route.continue();
      active -= 1;
    });
    try {
      await editable.fill("First description save held at network boundary");
      await expect.poll(() => writes.length).toBe(1);
      await editable.fill("Latest description edit while first write is pending");
      expect((await getWorkItem(request, descriptionA.id)).description).toBe(baseline);
      await openWorkItem(page, descriptionB.name);
      release();
      await expect.poll(async () => (await getWorkItem(request, descriptionA.id)).description)
        .toContain("Latest description edit while first write is pending");
      expect(writes).toHaveLength(2);
      expect(writes[0]).toContain("First description save held at network boundary");
      expect(writes[1]).toContain("Latest description edit while first write is pending");
      expect(maxActive).toBe(1);
      await openWorkItem(page, descriptionA.name);
      await expect(editable).toContainText("Latest description edit while first write is pending");
    } finally {
      release();
      await page.unroute("**/graphql");
    }
  });

  test("edits empty documents and repairs unsupported Markdown through source fallback", { tag: "@case-documents-empty-source" }, async ({ page, request }) => {
    const emptyPath = join(dirname(designPath), "EMPTY.md");
    const malformedPath = join(dirname(designPath), "MALFORMED.md");
    const broken = "# Unsupported document\n\n<Component />";
    await writeFile(emptyPath, "", "utf8");
    await writeFile(malformedPath, broken, "utf8");
    await refreshTaskDocuments(request, workItem.id, projectId, moduleRow.id);
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await tabs.getByRole("tab", { name: "Details" }).click();
    const tabCount = await tabs.getByRole("tab").count();
    for (let step = 0; step < tabCount; step += 1) {
      await page.keyboard.press("Meta+ArrowRight");
      if (await tabs.getByRole("tab", { name: "EMPTY" }).getAttribute("aria-selected") === "true") break;
    }
    await expect(tabs.getByRole("tab", { name: "EMPTY" })).toHaveAttribute("aria-selected", "true");
    const editor = page.getByTestId("document-editor-scroll-region").filter({ visible: true });
    const editable = editor.getByRole("textbox", { name: "editable markdown" });
    const actions = page.getByTestId("document-editor-action-row").filter({ visible: true });
    await expect(editable).toHaveText("");
    await expect(actions.getByRole("button", { name: "Save document" })).toBeDisabled();
    await editable.fill("Discard this empty-document draft");
    await actions.getByRole("button", { name: "Cancel editing" }).click();
    expect(await readFile(emptyPath, "utf8")).toBe("");
    await page.getByRole("button", { name: "Edit document", exact: true }).click();
    await expect(editable).toHaveText("");
    await editable.fill("Persisted formerly empty document");
    await actions.getByRole("button", { name: "Save document" }).click();
    await expect.poll(() => readFile(emptyPath, "utf8"))
      .toContain("Persisted formerly empty document");
    const registry = await graphql(request, TaskDocumentRegistryDocument, { taskId: workItem.id });
    const emptyRow = registry.document_registry.nodes.find((row) => row.relPath === "EMPTY.md");
    expect(emptyRow).toBeTruthy();
    const served = await request.get(`/documents/${emptyRow!.id}/EMPTY.md`);
    expect(served.ok()).toBe(true);
    expect(await served.text()).toContain("Persisted formerly empty document");
    expect(served.headers()["etag"]).toContain(emptyRow!.contentDigest);
    await tabs.getByRole("tab", { name: "MALFORMED" }).click();
    await expect(editor).toContainText("Rich editing is unavailable for this document.");
    const source = editor.getByRole("textbox", { name: "Document source" });
    await expect(source).toHaveValue(broken);
    await source.fill("# Repaired document\n\nSaved through source fallback");
    await actions.getByRole("button", { name: "Save document" }).click();
    await expect.poll(() => readFile(malformedPath, "utf8"))
      .toContain("Saved through source fallback");
    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    await tabs.getByRole("tab", { name: "MALFORMED" }).click();
    await expect(editable.getByRole("heading", { name: "Repaired document" })).toBeVisible();
    await expect(editable).toContainText("Saved through source fallback");
    await tabs.getByRole("tab", { name: "EMPTY" }).click();
    await expect(editable).toContainText("Persisted formerly empty document");
  });

  test("opens empty HTML and recovers a refused HTML load through keyboard navigation", { tag: "@case-documents-html-recovery" }, async ({ page, request }) => {
    await writeFile(join(dirname(designPath), "EMPTY-HTML.html"), "", "utf8");
    await writeFile(join(dirname(designPath), "RECOVERY-HTML.html"),
      "<!doctype html><html><body><h1>Canonical HTML recovery</h1><script>document.body.dataset.ready = 'real-document';</script></body></html>", "utf8");
    const registry = await refreshTaskDocuments(request, workItem.id, projectId, moduleRow.id);
    expect(registry.map((row) => row.relPath)).toContain("EMPTY-HTML.html");
    expect(registry.map((row) => row.relPath)).toContain("RECOVERY-HTML.html");
    let failures = 0;
    await page.route("**/documents/**/RECOVERY-HTML.html", async (route) => {
      failures += 1;
      await route.fulfill({ status: 503, contentType: "text/html", body: "<h1>Main HTML load refused</h1>" });
    });
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await tabs.getByRole("tab", { name: "EMPTY-HTML", exact: true }).click();
    const visibleFrame = page.getByTestId("workspace-doc-frame").filter({ visible: true });
    await expect(visibleFrame).toHaveAttribute("sandbox", "allow-scripts");
    await expect(visibleFrame).toHaveAttribute("title", "EMPTY-HTML");
    const frame = page.frameLocator('[data-testid="workspace-doc-frame"]:visible');
    await expect(frame.locator("body")).toHaveText("");
    await expect(frame.getByRole("heading")).toHaveCount(0);
    const tabCount = await tabs.getByRole("tab").count();
    for (let step = 0; step < tabCount; step += 1) {
      await page.keyboard.press("Meta+ArrowRight");
      if (await tabs.getByRole("tab", { name: "RECOVERY-HTML", exact: true }).getAttribute("aria-selected") === "true") break;
    }
    await expect(tabs.getByRole("tab", { name: "RECOVERY-HTML", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => failures).toBeGreaterThan(0);
    await expect(visibleFrame).toHaveAttribute("title", "RECOVERY-HTML");
    await expect(frame.getByRole("heading", { name: "Main HTML load refused" })).toBeVisible();
    await expect(frame.getByRole("heading", { name: "Canonical HTML recovery" })).toHaveCount(0);
    await expect(visibleFrame).toHaveAttribute("sandbox", "allow-scripts");
    await page.unroute("**/documents/**/RECOVERY-HTML.html");
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "RECOVERY-HTML", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(frame.getByRole("heading", { name: "Canonical HTML recovery" })).toBeVisible();
    await expect(frame.locator("body")).toHaveAttribute("data-ready", "real-document");
    await expect(frame.getByRole("heading", { name: "Main HTML load refused" })).toHaveCount(0);
    await expect(visibleFrame).toHaveAttribute("sandbox", "allow-scripts");
  });

});
