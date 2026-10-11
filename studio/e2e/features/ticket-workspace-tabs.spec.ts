import { TaskTerminalSessionsDocument } from "../../src/features/agents/terminal/generated/terminalSessions.documents";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { openFeatureModule as openModule } from "../work-items-migration-support";
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
import { featureSuite } from "./featureSuite";
import { expect, test } from "@playwright/test";
import {
  createModule,
  graphql,
  createProject,
  createWorkItem,
  captureLegacyProductApiRequests,
  getProjects,
  getWorkflowCatalog,
  openWorkItem,
  refreshTaskDocuments,
  selectModuleForProfile,
} from "../support";

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

featureSuite("ticket-workspace-tabs", () => {
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
    await promisify(execFile)("git", ["init", "-b", "main", moduleFolder]);
    await writeFile(join(moduleFolder, "README.md"), "Workspace terminal fixture\n");
    await promisify(execFile)("git", ["-C", moduleFolder, "add", "README.md"]);
    await promisify(execFile)("git", ["-C", moduleFolder, "-c", "user.name=Ticketry E2E", "-c", "user.email=e2e@ticketry.invalid", "commit", "-m", "Workspace fixture"]);

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

  test.describe("historical workspace order journeys", () => {
    test.describe.configure({ mode: "serial" });
  test("reorders workspace tabs and restores their order for the work item", { tag: "@case-ticket-tabs-reorder" }, async ({
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

  test("keeps different persisted workspace-tab orders isolated by work item", { tag: "@case-ticket-tabs-order-isolation" }, async ({
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

  test("closes and reopens a document in its saved workspace position", { tag: "@case-ticket-tabs-close-reopen" }, async ({
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

    await page.getByTestId("dormant-tabs-trigger").click();
    const reopen = page.getByRole("menuitem", { name: "Reopen DESIGN" });
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

  test("cycles workspace tabs in visible order with keyboard shortcuts", { tag: "@case-ticket-tabs-keyboard" }, async ({
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


  });

  test("dismisses dormant tabs without reopening and restores the remembered document", { tag: "@case-ticket-tabs-dormant-dismiss" }, async ({ page }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await tabs.getByRole("tab", { name: "NOTES" }).click();
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "NOTES" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("q");
    await expect(tabs.getByRole("tab", { name: "NOTES" })).toHaveCount(0);
    const trigger = page.getByTestId("dormant-tabs-trigger");
    await trigger.click();
    const reopen = page.getByRole("menuitem", { name: "Reopen NOTES" });
    await expect(reopen).toBeFocused();
    await reopen.press("Escape");
    await expect(reopen).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(tabs.getByRole("tab", { name: "NOTES" })).toHaveCount(0);
    await trigger.click();
    await tabs.getByRole("tab", { name: "Details", exact: true }).click();
    await expect(reopen).toHaveCount(0);
    await trigger.click();
    await page.getByRole("menuitem", { name: "Reopen NOTES" }).press("Enter");
    await expect(tabs.getByRole("tab", { name: "NOTES" })).toHaveAttribute("aria-selected", "true");
    await expect(trigger).toHaveCount(0);
  });

  test("refused workspace order rolls back and a retry survives reload", { tag: "@case-ticket-tabs-order-refusal" }, async ({ page }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    const labels = () => tabs.getByRole("tab").evaluateAll(rows => rows.map(row => row.getAttribute("aria-label")));
    const initial = await labels();
    const source = tabs.getByRole("tab", { name: initial[initial.length - 1]!, exact: true });
    const sourceBounds = await source.boundingBox();
    expect(sourceBounds).toBeTruthy();
    await page.mouse.move(sourceBounds!.x + sourceBounds!.width / 2, sourceBounds!.y + sourceBounds!.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBounds!.x - 40, sourceBounds!.y + sourceBounds!.height / 2, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect.poll(labels).toEqual(initial);
    const target = tabs.getByRole("tab", { name: initial[0]!, exact: true });
    const bounds = await target.boundingBox();
    expect(bounds).toBeTruthy();
    const refuse = async (route: import("@playwright/test").Route) => {
      if (route.request().postDataJSON()?.operationName !== "UpdateWorkTrackerWorkspaceTabOrder") return route.continue();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Workspace order refusal" }] }) });
    };
    await page.route("**/graphql", refuse);
    await source.dragTo(target, { targetPosition: { x: 2, y: bounds!.height / 2 } });
    await expect(page.getByText(/Workspace tabs could not be reordered:/)).toBeVisible();
    await expect.poll(labels).toEqual(initial);
    await page.unroute("**/graphql", refuse);
    await page.reload();
    await expect.poll(labels).toEqual(initial);
    await source.dragTo(target, { targetPosition: { x: 2, y: bounds!.height / 2 } });
    const expected = [initial[initial.length - 1], ...initial.slice(0, -1)];
    await expect.poll(labels).toEqual(expected);
    await page.reload();
    await expect.poll(labels).toEqual(expected);
  });

  test("retains a real shell across tab switches and rolls back refused closure", { tag: "@case-ticket-tabs-shell" }, async ({ page, request }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await page.getByRole("button", { name: "Issue actions" }).click();
    const created = page.waitForResponse(response => response.url().endsWith("/graphql") && response.request().postDataJSON()?.operationName === "CreateWorkItemShell");
    await page.getByRole("menuitem", { name: "Open terminal", exact: true }).click();
    const envelope = await (await created).json();
    expect(envelope.errors, JSON.stringify(envelope)).toBeUndefined();
    const sessions = await graphql(request, TaskTerminalSessionsDocument, { taskId: workItem.id, limit: 100 });
    expect(sessions.terminal_sessions.sessions.map(row => row.agent_run_id)).toContain(envelope.data.terminal_session.agent_run_id);
    await page.reload();
    const terminal = tabs.getByRole("tab", { name: /shell|terminal/i }).last();
    await expect(terminal).toBeVisible();
    const terminalName = await terminal.getAttribute("aria-label");
    await terminal.click();
    await expect(terminal).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("terminal-host-wrapper").filter({ visible: true })).toBeVisible();
    await tabs.getByRole("tab", { name: "Details", exact: true }).click();
    await terminal.click();
    await expect(terminal).toHaveAttribute("aria-selected", "true");
    const labels = await tabs.getByRole("tab").evaluateAll(rows => rows.map(row => row.getAttribute("aria-label")));
    const previous = labels[labels.indexOf(terminalName) - 1];
    expect(previous).toBeTruthy();
    await page.keyboard.press("Meta+ArrowLeft");
    await expect(tabs.getByRole("tab", { name: previous!, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Meta+ArrowRight");
    await expect(terminal).toHaveAttribute("aria-selected", "true");
    const details = tabs.getByRole("tab", { name: "Details", exact: true });
    const bounds = await details.boundingBox();
    expect(bounds).toBeTruthy();
    await terminal.dragTo(details, { targetPosition: { x: 2, y: bounds!.height / 2 } });
    const expected = labels.filter(label => label !== terminalName);
    expected.splice(expected.indexOf("Details"), 0, terminalName);
    await expect.poll(() => tabs.getByRole("tab").evaluateAll(rows => rows.map(row => row.getAttribute("aria-label")))).toEqual(expected);
    await page.reload();
    await expect.poll(() => tabs.getByRole("tab").evaluateAll(rows => rows.map(row => row.getAttribute("aria-label")))).toEqual(expected);
    const restored = tabs.getByRole("tab", { name: terminalName!, exact: true });
    await expect(restored).toBeVisible();
    const refuse = async (route: import("@playwright/test").Route) => {
      if (route.request().postDataJSON()?.operationName !== "UpdateTerminalSession") return route.continue();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Shell closure refused" }] }) });
    };
    await page.route("**/graphql", refuse);
    await restored.getByRole("button", { name: /^Close / }).click();
    await expect(page.getByText(/Terminal could not be closed:/)).toBeVisible();
    await expect(restored).toBeVisible();
    await page.unroute("**/graphql", refuse);
    await restored.getByRole("button", { name: /^Close / }).click();
    await expect(restored).toHaveCount(0);
    await page.getByTestId("dormant-tabs-trigger").click();
    await expect(page.getByRole("menuitem", { name: /^Terminated / })).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(restored).toHaveCount(0);
  });

  test("failed and delayed document hydration preserves newer workspace selection", { tag: "@case-ticket-tabs-restoration-recovery" }, async ({ page }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await tabs.getByRole("tab", { name: "DESIGN", exact: true }).click();
    let failures = 0;
    const refuse = async (route: import("@playwright/test").Route) => {
      if (route.request().postDataJSON()?.operationName !== "TaskDocumentRegistry") return route.continue();
      failures++;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Document hydration refused" }] }) });
    };
    await page.route("**/graphql", refuse);
    await page.reload();
    await expect.poll(() => failures).toBeGreaterThan(0);
    const intent = await page.evaluate(() => JSON.parse(localStorage.getItem("studio.activeWorkspaceByBucket:v1") ?? "{}"));
    expect(Object.values(intent)).toContainEqual({ kind: "doc", relPath: "DESIGN.md" });
    await page.unroute("**/graphql", refuse);
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "DESIGN", exact: true })).toHaveAttribute("aria-selected", "true");
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let reads = 0;
    const delay = async (route: import("@playwright/test").Route) => {
      if (route.request().postDataJSON()?.operationName !== "TaskDocumentRegistry") return route.continue();
      reads++;
      await held;
      await route.continue();
    };
    await page.route("**/graphql", delay);
    await page.reload();
    await expect.poll(() => reads).toBeGreaterThan(0);
    await tabs.getByRole("tab", { name: "Details", exact: true }).click();
    release();
    await expect(tabs.getByRole("tab", { name: "DESIGN", exact: true })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.unroute("**/graphql", delay);
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("resumes a real provider conversation after refusal without duplicating the successor", { tag: "@case-ticket-tabs-resume" }, async ({ page }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await page.getByRole("button", { name: "＋ Agent", exact: true }).click();
    await page.getByRole("dialog", { name: "Select Agent" }).getByText("codex", { exact: true }).click();
    const terminal = tabs.getByRole("tab", { name: /codex terminal/ }).last();
    await expect(terminal).toBeVisible();
    await expect.poll(async () => {
      const files = await import("node:fs/promises").then(fs => fs.readdir(process.env.TICKETRY_E2E_PROVIDER_DIR!));
      return files.filter(file => file.endsWith(".interactive.json")).length;
    }).toBeGreaterThan(0);
    await terminal.click();
    const host = await page.getByTestId("terminal-host-wrapper").elementHandle();
    expect(host).toBeTruthy();
    await tabs.getByRole("tab", { name: "Details", exact: true }).click();
    expect(await host!.evaluate(node => node.isConnected)).toBe(true);
    await terminal.click();
    await expect(terminal).toHaveAttribute("aria-selected", "true");
    expect(await host!.evaluate(node => node.isConnected)).toBe(true);
    const labels = await tabs.getByRole("tab").evaluateAll(rows => rows.map(row => row.getAttribute("aria-label")));
    const terminalName = await terminal.getAttribute("aria-label");
    const details = tabs.getByRole("tab", { name: "Details", exact: true });
    await expect.poll(() => terminal.getAttribute("draggable")).toBe("true");
    const bounds = await details.boundingBox();
    expect(bounds).toBeTruthy();
    await terminal.dragTo(details, { targetPosition: { x: 2, y: bounds!.height / 2 } });
    const expected = labels.filter(label => label !== terminalName);
    expected.splice(expected.indexOf("Details"), 0, terminalName);
    await expect.poll(() => tabs.getByRole("tab").evaluateAll(rows => rows.map(row => row.getAttribute("aria-label")))).toEqual(expected);
    await page.reload();
    await expect.poll(() => tabs.getByRole("tab").evaluateAll(rows => rows.map(row => row.getAttribute("aria-label")))).toEqual(expected);
    const refuseClose = async (route: import("@playwright/test").Route) => {
      if (route.request().postDataJSON()?.operationName !== "UpdateTerminalSession") return route.continue();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Provider terminal closure refused" }] }) });
    };
    await page.route("**/graphql", refuseClose);
    await terminal.getByRole("button", { name: /^Close / }).click();
    await expect(page.getByText(/Terminal could not be closed:/)).toBeVisible();
    await expect(terminal).toBeVisible();
    await page.unroute("**/graphql", refuseClose);
    await terminal.getByRole("button", { name: /^Close / }).click();
    await expect(terminal).toHaveCount(0);
    await page.getByTestId("dormant-tabs-trigger").click();
    const resume = page.getByRole("menuitem", { name: /^Resume .*codex/ }).last();
    await expect(resume).toBeVisible();
    const refuse = async (route: import("@playwright/test").Route) => {
      if (route.request().postDataJSON()?.operationName !== "ResumeTerminalSession") return route.continue();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Conversation resume refused" }] }) });
    };
    await page.route("**/graphql", refuse);
    await resume.click();
    await expect(page.getByText("Could not resume session", { exact: true })).toBeVisible();
    await expect(resume).toBeEnabled();
    await expect(tabs.getByRole("tab", { name: /codex terminal/ })).toHaveCount(0);
    await page.unroute("**/graphql", refuse);
    let requests = 0;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const delay = async (route: import("@playwright/test").Route) => {
      if (route.request().postDataJSON()?.operationName !== "ResumeTerminalSession") return route.continue();
      requests++;
      await held;
      await route.continue();
    };
    await page.route("**/graphql", delay);
    await resume.click();
    await expect.poll(() => requests).toBe(1);
    await expect(resume).toBeDisabled();
    await tabs.getByRole("tab", { name: "Details", exact: true }).click();
    release();
    await expect(tabs.getByRole("tab", { name: /codex terminal/ })).toHaveCount(1);
    await expect(tabs.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");
    expect(requests).toBe(1);
    await expect.poll(async () => {
      const fs = await import("node:fs/promises");
      const files = (await fs.readdir(process.env.TICKETRY_E2E_PROVIDER_DIR!)).filter(file => file.endsWith(".interactive.json"));
      return files.length;
    }).toBe(2);
    const fs = await import("node:fs/promises");
    const files = (await fs.readdir(process.env.TICKETRY_E2E_PROVIDER_DIR!)).filter(file => file.endsWith(".interactive.json"));
    const providers = await Promise.all(files.map(async file => JSON.parse(await fs.readFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, file), "utf8"))));
    expect(new Set(providers.map(provider => provider.sessionId)).size).toBe(1);
    expect(providers.some(provider => provider.args.includes("resume"))).toBe(true);
    await page.unroute("**/graphql", delay);
    await page.reload();
    await expect(tabs.getByRole("tab", { name: /codex terminal/ })).toHaveCount(1);
    await tabs.getByRole("tab", { name: /codex terminal/ }).getByRole("button", { name: /^Close / }).click();
  });

  test("keeps rendered document and Details viewers mounted across tab switches", { tag: "@case-ticket-tabs-retained-surfaces" }, async ({ page }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await tabs.getByRole("tab", { name: "Details", exact: true }).click();
    const details = await page.getByTestId("workspace-details-surface").elementHandle();
    expect(details).toBeTruthy();
    await tabs.getByRole("tab", { name: "DESIGN", exact: true }).click();
    const editor = page.getByTestId("rich-markdown-editor-shell").filter({ visible: true });
    const document = await editor.elementHandle();
    expect(document).toBeTruthy();
    await tabs.getByRole("tab", { name: "Details", exact: true }).click();
    expect(await document!.evaluate(node => node.isConnected)).toBe(true);
    await expect.poll(() => document!.isVisible()).toBe(false);
    await tabs.getByRole("tab", { name: "DESIGN", exact: true }).click();
    expect(await details!.evaluate(node => node.isConnected)).toBe(true);
    expect(await document!.evaluate(node => node.isConnected)).toBe(true);
    await expect(editor).toBeVisible();
    await tabs.getByRole("tab", { name: "Details", exact: true }).click();
    await expect(page.getByTestId("workspace-details-surface")).toBeVisible();
  });

  test("authoritatively missing remembered document restores Details", { tag: "@case-ticket-tabs-missing-document" }, async ({ page }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, isolationWorkItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await tabs.getByRole("tab", { name: "DESIGN", exact: true }).click();
    await unlink(join(moduleFolder, "spec", `documents-module--${moduleRow.id.slice(0, 8)}`, `T${isolationWorkItem.sequence_id}--workspace-tab-isolation-task`, "DESIGN.md"));
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "DESIGN", exact: true })).toHaveCount(0);
    await expect(tabs.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("empty module has no selected ticket or dormant tabs", { tag: "@case-ticket-tabs-empty" }, async ({ page, request }) => {
    const projects = await getProjects(request);
    const project = projects.find(row => row.slug === "CDN")!;
    const catalog = await getWorkflowCatalog(request, project.id);
    const empty = await createModule(request, project.id, {
      name: "Empty workspace tabs module", issue_type_id: catalog.issue_types.nodes.find(row => row.name === "Module")!.id,
    });
    await selectModuleForProfile(request, project.id, empty.id, moduleFolder);
    await openModule(page, empty.name);
    await expect(page.getByRole("status")).toContainText("0 of 0 stories");
    await expect(page.getByRole("treeitem", { name: /^T-/ })).toHaveCount(0);
    await expect(page.getByRole("tablist", { name: "Workspace tabs" })).toHaveCount(0);
    await expect(page.getByTestId("dormant-tabs-trigger")).toHaveCount(0);
  });

  test("highlights workspace tabs before activation and engages bodies with keyboard", { tag: "@case-ticket-tabs-edit-view" }, async ({ page }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    const labels = await tabs.getByRole("tab").evaluateAll(rows => rows.map(row => row.getAttribute("aria-label")));
    await tabs.getByRole("tab", { name: labels[0]!, exact: true }).click();
    await tabs.focus();
    await page.keyboard.press("ArrowRight");
    const highlighted = tabs.getByRole("tab", { name: labels[1]!, exact: true });
    await expect(highlighted).toHaveAttribute("data-highlighted", "true");
    await expect(tabs.getByRole("tab", { name: labels[0]!, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(highlighted).toHaveAttribute("aria-selected", "true");
    const body = page.locator('[data-navigation-zone="active-tab-body"]');
    await expect(body).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(body).not.toBeFocused();
    await page.keyboard.press("Meta+Escape");
    await expect(body).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(tabs).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(body).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator('[data-navigation-zone="stories"]')).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(tabs).toBeFocused();
    await tabs.getByRole("tab", { name: "DESIGN", exact: true }).click();
    await page.keyboard.press("Meta+w");
    await expect(tabs.getByRole("tab", { name: "DESIGN", exact: true })).toHaveCount(0);
    await page.getByTestId("dormant-tabs-trigger").click();
    await page.getByRole("menuitem", { name: "Reopen DESIGN", exact: true }).click();
    await expect(tabs.getByRole("tab", { name: "DESIGN", exact: true })).toHaveAttribute("aria-selected", "true");
  });
});
