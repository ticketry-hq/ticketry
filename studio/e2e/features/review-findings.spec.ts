import { openFeatureModule as openModule } from "../work-items-migration-support";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { callSocketMcpTool } from "../../scripts/mcp-socket-client.mjs";
import { featureSuite } from "./featureSuite";
import { createModule, createWorkItem, getProjects, getWorkflowCatalog, getWorkItem, openWorkItem, selectModuleForProfile } from "../support";
const names = { module: "Review findings feature module", parent: "Review findings feature Story" };
const fixture = {} as { folder: string; project: { id: string }; module: { id: string }; parent: { id: string } };
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
  name: string,
  arguments_: Record<string, unknown>,
): Promise<TResult> {
  const dataDirectory = process.env.TICKETRY_E2E_DATA_DIR;
  if (!dataDirectory) throw new Error("E2E data directory was not configured");
  const result = await callSocketMcpTool(dataDirectory, name, arguments_) as {
    structuredContent?: TResult;
  };
  expect(result.structuredContent, JSON.stringify(result)).toBeTruthy();
  return result.structuredContent!;
}

featureSuite("review-findings", () => {
  test.beforeAll(async ({ request }) => {
    fixture.folder = await mkdtemp(join(tmpdir(), "ticketry-findings-feature-"));
    fixture.project = (await getProjects(request)).find(row => row.slug === "CDN")!;
    const catalog = await getWorkflowCatalog(request, fixture.project.id);
    const moduleType = catalog.issue_types.nodes.find(row => row.name === "Module")!;
    const storyType = catalog.issue_types.nodes.find(row => row.name === "Story")!;
    const module = await createModule(request, fixture.project.id, { name: names.module, issue_type_id: moduleType.id });
    fixture.module = module;
    await selectModuleForProfile(request, fixture.project.id, module.id, fixture.folder);
  });
  test.beforeEach(async ({ request }, testInfo) => {
    names.parent = `Review findings Story ${testInfo.title}`;
    const catalog = await getWorkflowCatalog(request, fixture.project.id);
    fixture.parent = await createWorkItem(request, fixture.project.id, {
      name: names.parent, parent_id: fixture.module.id,
      issue_type_id: catalog.issue_types.nodes.find(row => row.name === "Story")!.id,
    });
  });
  test.afterAll(async () => { if (fixture.folder) await rm(fixture.folder, { recursive: true, force: true }); });
  test("rejects malformed and out-of-phase MCP review findings without creating children", { tag: "@case-review-findings-refusal" }, async ({
    page,
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
    }>("create_review_finding", {
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
    }>("create_review_finding", {
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

  test("streams an MCP review finding into the visible Story", { tag: "@case-review-findings-stream" }, async ({
    page, request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.parent);
    for (const state of ["Grill", "Spec", "Tickets", "Implement", "Review"]) {
      await selectState(page, state);
    }

    // Start the assertion from a settled Review snapshot and an accepted
    // subscription, rather than racing its five preceding transition events.
    let statusCaughtUp = false;
    page.on("console", async (message) => {
      const values = await Promise.all(
        message.args().map((argument) => argument.jsonValue()),
      );
      const trace = values[1];
      if (
        values[0] === "[launch-discovery]"
        && typeof trace === "object"
        && trace !== null
        && "event" in trace
        && trace.event === "caught-up"
      ) statusCaughtUp = true;
    });
    const subscribed = page.waitForResponse((response) =>
      response.url().endsWith("/graphql/subscribe") && response.ok()
    );
    await page.reload();
    await subscribed;
    await expect.poll(() => statusCaughtUp).toBe(true);
    await expect(page.getByTestId("status-row")).toContainText("Review");

    const result = await callMcpTool<{ ok?: boolean; task_id?: string }>(
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
    const refused = async (route: import("@playwright/test").Route) => {
      if (route.request().postDataJSON()?.operationName !== "TransitionWorkTrackerWorkItem") return route.continue();
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Finding cancellation refused at network boundary" }] }) });
    };
    await page.route("**/graphql", refused);
    await restoredParent.getByTestId("finding-cancel").click();
    await expect(page.getByText("Finding cancellation refused at network boundary", { exact: false })).toBeVisible();
    await expect(restoredParent.getByTestId("finding-state")).toHaveText("Implement");
    await expect(restoredParent.getByTestId("findings-queued-count")).toHaveText("1 fix queued");
    expect((await getWorkItem(request, result.task_id!)).state_id).toBe((await getWorkflowCatalog(request, fixture.project.id)).states.nodes.find(row => row.name === "Implement")!.id);
    await page.unroute("**/graphql", refused);
    await restoredParent.getByTestId("finding-cancel").click();
    await expect(restoredParent.getByTestId("finding-state"))
      .toHaveText("Cancelled");
    await expect(restoredParent.getByTestId("findings-queued-count"))
      .toHaveText("0 fixes queued");
    await expect(restoredParent.getByTestId("finding-cancel")).toHaveCount(0);
    expect((await getWorkItem(request, result.task_id!)).state_id).toBe((await getWorkflowCatalog(request, fixture.project.id)).states.nodes.find(row => row.name === "Cancelled")!.id);
    await page.reload();
    await expect(page.getByTestId("findings-panel").getByTestId("finding-state")).toHaveText("Cancelled");
    await expect(page.getByTestId("findings-queued-count")).toHaveText("0 fixes queued");
  });


  test("omits malformed locations while opening findings by keyboard", { tag: "@case-review-findings-location-empty" }, async ({ page, request }) => {
    const catalog = await getWorkflowCatalog(request, fixture.project.id);
    const parent = await createWorkItem(request, fixture.project.id, {
      name: "Review location empty Story", parent_id: fixture.module.id,
      issue_type_id: catalog.issue_types.nodes.find(row => row.name === "Story")!.id,
    });
    await openModule(page, names.module);
    await openWorkItem(page, parent.name);
    for (const state of ["Grill", "Spec", "Tickets", "Implement", "Review"]) await selectState(page, state);
    const finding = await createWorkItem(request, fixture.project.id, {
      name: "Malformed location finding", parent_id: parent.id,
      issue_type_id: catalog.issue_types.nodes.find(row => row.name === "Implementation")!.id,
      description: "Path: src/finding.rs\nLines: invalid-range",
    });
    await openModule(page, names.module);
    await openWorkItem(page, parent.name);
    const row = page.getByTestId("finding-row").filter({ hasText: finding.name });
    await expect(row.getByTestId("finding-location")).toHaveCount(0);
    await expect(page.getByTestId("findings-queued-count")).toHaveText("1 fix queued");
    await row.getByRole("button").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("issue-name")).toContainText(finding.name);
    await expect(page.getByTestId("issue-description")).toContainText("Lines: invalid-range");
    await page.reload();
    await expect(page.getByTestId("issue-description")).toContainText("Lines: invalid-range");
    await openWorkItem(page, parent.name);
    await expect(page.getByTestId("finding-location")).toHaveCount(0);
  });
});
