import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { resolveEdition } from "../../scripts/edition-build-policy.mjs";
import { CreateWorkTrackerStateDocument, CreateWorkTrackerTransitionDocument } from "../../src/features/workflows/generated/workflows.documents";
import { featureSuite } from "./featureSuite";
import { CODEX_TEST_MODEL, CODEX_TEST_REASONING, ensureCodexTestModel, getModules, getProviderCatalog, getWorkItems, getWorkspace, getWorkflowCatalog, graphql } from "../support";

/**
 * CODING-2860/2861: only Pocock provisions a task-level Story type, so only
 * Pocock tours continue to Story capture; core's tour finishes at its first
 * module.
 */
const storyTour = resolveEdition().edition === "pocock";
const moduleReady = (page: Page) => page.getByRole("dialog", { name: "Your first module is ready" });

async function failOperation(page: Page, operation: string) {
  await page.route("**/graphql", async (route) => {
    if (route.request().postDataJSON()?.operationName === operation) await route.abort("failed");
    else await route.continue();
  });
}

async function start(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("onboarding-welcome")).toBeVisible();
  await page.getByRole("button", { name: "Get started", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add your first module" })).toBeVisible();
}

async function openCreation(page: Page, chord = false) {
  // CODING-2643 replaced the Modules pane with the Module Manager.
  if (chord) await page.keyboard.press("Meta+Shift+M");
  else await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
  await page.getByRole("region", { name: "Module Manager", exact: true })
    .getByRole("button", { name: "New module", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Name the module" })).toBeVisible();
  return page.getByRole("form", { name: "Create module", exact: true });
}

async function createModule(page: Page, name: string) {
  const form = await openCreation(page);
  await form.getByRole("textbox", { name: "Module name", exact: true }).fill(name);
  await page.getByTestId("onboarding-module-name-next").click();
  await expect(page.getByRole("dialog", { name: "Choose where work runs" })).toBeVisible();
  await page.getByTestId("onboarding-module-folder-done").click();
  await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(resolve(".."));
  await form.getByRole("button", { name: "Create module", exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect(storyTour ? page.getByRole("dialog", { name: "Create your first story" }) : moduleReady(page)).toBeVisible();
}

async function captureStory(page: Page, name: string) {
  const idea = page.getByRole("textbox", { name: "Capture an idea" });
  await idea.fill(name);
  await idea.press("Enter");
  await expect(page.getByTestId("issue-name")).toContainText(name);
  await expect(page.getByRole("dialog", { name: "Your first story is ready" })).toBeVisible();
}

featureSuite("onboarding", { profile: "first-run", isolation: "case" }, () => {
  test("uses the provisioned model and completes first-run provider onboarding", { tag: "@case-onboarding-provider-completion" }, async ({ page, request }) => {
    const launches: string[] = [];
    page.on("request", (event) => {
      if (!event.url().endsWith("/graphql")) return;
      const operation = event.postDataJSON()?.operationName as string | undefined;
      if (operation && operation.match(/^(Launch|RunNow|CreateTerminalSession|CreateExecutionGraphRun)/)) launches.push(operation);
    });
    expect((await getWorkspace(request)).onboarding_required).toBe(true);
    await ensureCodexTestModel(request);
    if (storyTour) {
      const workflow = await getWorkflowCatalog(request, (await getWorkspace(request)).id);
      const storyType = workflow.issue_types.nodes.find((row) => row.name === "Story")!;
      const done = workflow.states.nodes.find((row) => row.name === "Cancelled")!;
      const custom = (await graphql(request, CreateWorkTrackerStateDocument, {
        projectId: (await getWorkspace(request)).id, name: "Onboarding guide archive", group: "completed", color: "#777777",
      })).create_state;
      await graphql(request, CreateWorkTrackerTransitionDocument, {
        issueTypeId: storyType.id, fromStateId: done.id, toStateId: custom.id,
        workflowRevision: storyType.workflow_revision, agentAllowed: true, handoff: false,
      });
    }
    await page.goto("/");
    await expect(page.getByTestId("onboarding-welcome")).toBeVisible();
    await expect(page.getByTestId("onboarding-skip-tour")).toHaveCount(0);
    const codex = page.getByRole("checkbox", { name: "I use codex" });
    await expect(codex).not.toBeChecked();
    await codex.check();
    await codex.uncheck();
    await expect(codex).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Get started" })).toBeEnabled();
    await codex.check();
    await page.getByRole("checkbox", { name: "I use claude" }).check();
    await expect(page.getByRole("button", { name: "Get started" })).toBeDisabled();
    await page.getByRole("combobox", { name: "Agent/provider" }).selectOption("codex");
    await page.getByRole("combobox", { name: "Model", exact: true }).selectOption(CODEX_TEST_MODEL);
    await page.getByRole("combobox", { name: "Reasoning" }).selectOption(CODEX_TEST_REASONING);
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByTestId("onboarding-welcome")).toHaveCount(0);
    await createModule(page, "Provider onboarding module");
    expect(await getWorkItems(request, (await getWorkspace(request)).id)).toHaveLength(0);
    const guide = page.getByRole("dialog", { name: "Story workflow guide", exact: true });
    if (storyTour) {
      await captureStory(page, "Provider onboarding captured story");
      await expect(page.getByRole("dialog", { name: "Your first story is ready" })).toContainText("launch still depends on the executable, login, profile, and backend checks");
      await page.getByTestId("onboarding-story-workflow-guide").click();
      await expect(guide).toContainText("Provider onboarding captured story");
      await expect(guide).toContainText("This Story's workflow");
      await expect(guide).toContainText("Current state");
      await guide.getByText("Stage instructions", { exact: true }).last().click();
      await expect(guide).toContainText("No agent instructions configured.");
      await expect(guide).toContainText("does not start an agent");
      await expect(guide.getByRole("button", { name: /^(Run item|Run now)$/ })).toHaveCount(0);
      await guide.getByRole("button", { name: "Close", exact: true }).click();
      await expect(page.getByTestId("onboarding-story-workflow-guide")).toBeFocused();
    }
    await page.getByTestId("onboarding-finish").click();
    await expect(page.getByTestId("onboarding-finish")).toHaveCount(0);
    const catalog = await getProviderCatalog(request);
    expect(catalog.global_default).toMatchObject({ provider: "codex", model: CODEX_TEST_MODEL, reasoning: CODEX_TEST_REASONING });
    expect(catalog.configurable_providers.filter((provider) => provider.activated).map((provider) => provider.slug).sort()).toEqual(["claude", "codex"]);
    expect((await getWorkspace(request)).onboarding_required).toBe(false);
    await page.reload();
    await expect(page.getByTestId("onboarding-welcome")).toHaveCount(0);
    if (storyTour) {
      await expect(page.getByTestId("issue-name")).toContainText("Provider onboarding captured story");
      await page.getByRole("button", { name: "Story workflow guide", exact: true }).click();
      await expect(guide).toContainText("Provider onboarding captured story");
      await page.keyboard.press("Escape");
      await expect(guide).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Story workflow guide", exact: true })).toBeFocused();
    }
    expect(launches).toEqual([]);
  });

  test("plans without providers and skips the tour without creating an example story", { tag: "@case-onboarding-zero-provider-skip" }, async ({ page, request }) => {
    await start(page);
    const catalog = await getProviderCatalog(request);
    expect(catalog.configurable_providers.filter((provider) => provider.activated)).toEqual([]);
    expect(catalog.global_default).toBeNull();
    await createModule(page, "Zero provider onboarding module");
    const project = await getWorkspace(request);
    const before = await getWorkItems(request, project.id);
    expect(before).toEqual([]);
    // Core's tour ends at its first module, which offers Finish tour and no Skip tour.
    const complete = page.getByTestId(storyTour ? "onboarding-skip-tour" : "onboarding-finish");
    if (!storyTour) await expect(page.getByTestId("onboarding-skip-tour")).toHaveCount(0);
    await failOperation(page, "AcknowledgeWorkTrackerOnboarding");
    await complete.click();
    await expect(page.getByTestId("onboarding-step-error")).toBeVisible();
    expect((await getWorkspace(request)).onboarding_required).toBe(true);
    await page.unroute("**/graphql");
    await complete.click();
    await expect(complete).toHaveCount(0);
    expect((await getWorkspace(request)).onboarding_required).toBe(false);
    await page.reload();
    await expect(page.getByTestId("onboarding-welcome")).toHaveCount(0);
    expect(await getWorkItems(request, project.id)).toEqual(before);
  });

  test("cancels module creation and restarts an interrupted tour while preserving its module", { tag: "@case-onboarding-module-cancel-reload" }, async ({ page, request }) => {
    await start(page);
    const form = await openCreation(page, true);
    const card = page.getByRole("dialog", { name: "Name the module" });
    await expect(card).toHaveAttribute("aria-modal", "false");
    await page.setViewportSize({ width: 420, height: 780 });
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(420);
    await card.focus();
    await page.keyboard.press("Escape");
    await expect(form.getByRole("textbox", { name: "Module name", exact: true })).toBeFocused();
    expect((await getWorkspace(request)).onboarding_required).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(form).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Add your first module" })).toBeVisible();
    await page.keyboard.press("Meta+Shift+M");
    await createModule(page, "Interrupted onboarding module");
    await page.reload();
    await expect(page.getByTestId("onboarding-welcome")).toBeVisible();
    expect((await getWorkspace(request)).onboarding_required).toBe(true);
    expect((await getModules(request, (await getWorkspace(request)).id)).map((module) => module.name)).toContain("Interrupted onboarding module");
  });

  test("recovers provider saves at the network boundary", { tag: "@case-onboarding-provider-recovery" }, async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByTestId("onboarding-welcome")).toBeVisible();
    await expect(page.getByRole("button", { name: "Get started" })).toBeEnabled();
    await page.getByRole("checkbox", { name: "I use codex" }).check();
    await failOperation(page, "UpdateProviderCatalog");
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("onboarding-welcome")).toBeVisible();
    await page.unroute("**/graphql");
    await page.getByRole("button", { name: "Get started" }).click();
    await expect(page.getByRole("dialog", { name: "Add your first module" })).toBeVisible();
    expect((await getProviderCatalog(request)).global_default?.provider).toBe("codex");
  });

  test("recovers module folder, story, optional guide and completion failures", { tag: "@case-onboarding-content-recovery" }, async ({ page, request }) => {
    await start(page);
    const form = await openCreation(page);
    await form.getByRole("textbox", { name: "Module name", exact: true }).fill("Recovery onboarding module");
    await page.getByTestId("onboarding-module-name-next").click();
    await page.getByTestId("onboarding-module-folder-done").click();
    await expect(form.getByRole("button", { name: "Create module", exact: true })).toBeDisabled();
    await form.getByRole("textbox", { name: "Module folder", exact: true }).fill("/ticketry-onboarding-missing-folder");
    await form.getByRole("button", { name: "Create module", exact: true }).click();
    await expect(form.getByRole("alert")).toBeVisible();
    await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(resolve(".."));
    await failOperation(page, "SetModuleLink");
    await form.getByRole("textbox", { name: "Module folder", exact: true }).press("Enter");
    await expect(form.getByRole("button", { name: "Save folder", exact: true })).toBeVisible();
    const project = await getWorkspace(request);
    expect((await getModules(request, project.id)).filter((module) => module.name === "Recovery onboarding module")).toHaveLength(1);
    await page.unroute("**/graphql");
    await form.getByRole("button", { name: "Save folder", exact: true }).click();
    await expect(form).toHaveCount(0);
    if (!storyTour) {
      // Core has no Story type: the saved folder link ends the module step.
      await expect(moduleReady(page)).toBeVisible();
      expect((await getModules(request, project.id)).filter((module) => module.name === "Recovery onboarding module")).toHaveLength(1);
      return;
    }
    await failOperation(page, "CreateWorkTrackerWorkItem");
    const idea = page.getByRole("textbox", { name: "Capture an idea" });
    await idea.fill("Recovery onboarding story");
    await idea.press("Enter");
    await expect(page.getByText(/Story could not be created:/).first()).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Create your first story" })).toBeVisible();
    await page.unroute("**/graphql");
    await captureStory(page, "Recovery onboarding story");
    await expect(page.getByRole("dialog", { name: "Your first story is ready" })).toContainText("without an agent");
    await failOperation(page, "WorkTrackerProjectOpen");
    await page.getByTestId("onboarding-story-workflow-guide").click();
    const guide = page.getByRole("dialog", { name: "Story workflow guide", exact: true });
    await expect(guide).toContainText("Workflow configuration could not load");
    await expect(guide).toContainText("does not start an agent");
    await page.unroute("**/graphql");
    await guide.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(guide.getByRole("alert")).toHaveCount(0);
    await guide.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(guide).toHaveCount(0);
    await failOperation(page, "AcknowledgeWorkTrackerOnboarding");
    await page.getByTestId("onboarding-finish").click();
    await expect(page.getByTestId("onboarding-step-error")).toBeVisible();
    await expect(page.getByTestId("issue-name")).toContainText("Recovery onboarding story");
    expect((await getWorkspace(request)).onboarding_required).toBe(true);
    await page.unroute("**/graphql");
    await page.getByTestId("onboarding-finish").click();
    await expect(page.getByTestId("onboarding-finish")).toHaveCount(0);
    expect((await getWorkspace(request)).onboarding_required).toBe(false);
    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText("Recovery onboarding story");
    expect((await getWorkItems(request, project.id)).filter((item) => item.name === "Recovery onboarding story")).toHaveLength(1);
  });

  test("finishes the tour at the first module when the project has no Story type", { tag: ["@case-onboarding-core-module-finish", "@edition-core"] }, async ({ page, request }) => {
    const project = await getWorkspace(request);
    expect(project.onboarding_required).toBe(true);
    const catalog = await getWorkflowCatalog(request, project.id);
    expect(catalog.issue_types.nodes.filter((type) => type.level === "task" && type.name === "Story")).toEqual([]);
    await start(page);
    expect((await getProviderCatalog(request)).configurable_providers.filter((provider) => provider.activated)).toEqual([]);
    await createModule(page, "Core onboarding module");
    const card = moduleReady(page);
    await expect(card).toHaveAttribute("aria-modal", "false");
    await expect(card.getByTestId("onboarding-finish")).toHaveText("Finish tour");
    await expect(page.getByTestId("onboarding-skip-tour")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Create your first story" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Your first story is ready" })).toHaveCount(0);
    await expect(page.getByTestId("onboarding-story-workflow-guide")).toHaveCount(0);
    expect((await getModules(request, project.id)).map((module) => module.name)).toContain("Core onboarding module");
    expect(await getWorkItems(request, project.id)).toEqual([]);
    expect((await getWorkspace(request)).onboarding_required).toBe(true);
    await card.getByTestId("onboarding-finish").click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("onboarding-finish")).toHaveCount(0);
    expect((await getWorkspace(request)).onboarding_required).toBe(false);
    await page.reload();
    await expect(page.getByRole("button", { name: "Open Module Manager", exact: true })).toBeVisible();
    await expect(page.getByTestId("onboarding-welcome")).toHaveCount(0);
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Add your first module" })).toHaveCount(0);
    expect(await getWorkItems(request, project.id)).toEqual([]);
  });
});
