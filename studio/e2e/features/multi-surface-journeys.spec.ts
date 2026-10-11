import { expect, test, type Page, type Route } from "@playwright/test";
import { featureSuite } from "./featureSuite";
import { getModules, getWorkflowCatalog, getWorkItem, getWorkItems, graphql, openWorkItem } from "../support";
import { refuseNext } from "../module-manager-support";
import { TaskResumableTerminalSessionsDocument } from "../../src/features/agents/terminal/generated/terminalSessions.documents";
import { WorkItemEndedRunsDocument } from "../../src/features/agents/terminal/generated/workItemRunRestoration.documents";
import { agentStatus, prepareAgentProvider, waitForAgent, waitForAgentExit } from "../agent-lifecycle-support";
import { observeConversationLaunch } from "../conversation-support";
import {
  advanceProvider, chooseSprint, expectSprint, countOperations, holdProvider, journeyFixture, liveTaskSessions, moduleTab, moduleTabs,
  openManager, processAlive, providerEvidence, releaseProvider, sprintTrigger, storyNamed,
} from "../multi-surface-journeys-support";

const workspaceTabs = (page: Page) => page.getByRole("tablist", { name: "Workspace tabs" });
const codexTerminal = (page: Page) => workspaceTabs(page).getByRole("tab", { name: /codex terminal/ });
const descriptionEditor = (page: Page) => page.getByTestId("issue-description").filter({ visible: true })
  .getByRole("textbox", { name: "editable markdown" });
const activeChip = '[title="Agent is actively working"]';
// The fixture prints Codex's composer marker once its real tmux pane is ready.
const composerMarker = "› Ask Codex";

async function captureStory(page: Page, name: string) {
  const entry = page.getByRole("textbox", { name: "Capture an idea" });
  await entry.fill(name);
  await entry.press("Enter");
  await expect(page.getByRole("treeitem", { name: new RegExp(name) })).toBeVisible();
  await expect(entry).toHaveValue("");
}

/** A lost run keeps no live viewer; its history is offered once through the dormant Resume menu. */
async function expectLostSessionResumable(page: Page) {
  await expect(codexTerminal(page)).toHaveCount(0);
  await expect(workspaceTabs(page).getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("dormant-tabs-trigger").click();
  await expect(page.getByRole("menuitem", { name: /^Resume .*codex/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: /^Resume .*codex/ })).toHaveCount(0);
}

async function showDetails(page: Page) {
  await workspaceTabs(page).getByRole("tab", { name: "Details", exact: true }).click();
  await expect(page.getByTestId("workspace-details-surface")).toBeVisible();
}

featureSuite("multi-surface-journeys", { isolation: "case" }, () => {
  test("creates a module and Story, runs it through Implement, Review and Done, then reloads", { tag: "@case-journey-create-run-reload" }, async ({ page, request }) => {
    test.setTimeout(150_000);
    const f = await journeyFixture(request, "run");
    try {
      const moduleName = `${f.prefix} module`;
      const storyName = `${f.prefix} Story`;
      await page.goto("/");
      const manager = await openManager(page);
      await manager.getByRole("button", { name: "New module", exact: true }).first().click();
      const form = manager.getByRole("form", { name: "Create module", exact: true });
      await form.getByRole("textbox", { name: "Module name", exact: true }).fill(moduleName);
      await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(f.folder);
      await form.getByRole("button", { name: "Create module", exact: true }).click();
      await expect(manager).toHaveCount(0);
      await expect(moduleTab(page, moduleName)).toHaveAttribute("aria-selected", "true");
      await captureStory(page, storyName);
      const story = await storyNamed(request, f.project.id, storyName);
      const module = (await getModules(request, f.project.id)).find((row) => row.name === moduleName)!;
      expect(story.parent_id).toBe(module.id);
      await openWorkItem(page, storyName);
      await showDetails(page);

      await holdProvider(["Implement", "Review", "Done"]);
      const launch = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Run item", exact: true }).click());
      await waitForAgent(request, f.project.id, story.id);
      const row = page.getByRole("treeitem", { name: new RegExp(storyName) });
      await expect(row.getByTestId("agent-state-badge")).toHaveAttribute("data-state", "active");
      await expect(moduleTab(page, moduleName).locator(activeChip)).toBeVisible();
      await codexTerminal(page).last().click();
      const provider = await providerEvidence(launch.runId);
      await expect(page.getByTestId("terminal-host").filter({ visible: true })).toContainText(composerMarker);
      expect((await liveTaskSessions(request, story.id)).map((session) => session.agent_run_id)).toEqual([launch.runId]);

      await showDetails(page);
      await releaseProvider(launch.runId);
      const picker = page.getByTestId("state-picker");
      for (const state of ["Implement", "Review", "Done"]) {
        await advanceProvider(launch.runId, state);
        await expect(picker).toContainText(state);
        await expect.poll(async () => (await getWorkItem(request, story.id)).state_id).toBe(f.stateNamed(state).id);
      }
      await waitForAgentExit(request, story.id, launch.runId);
      await expect(row.getByTestId("agent-state-badge")).toHaveCount(0);
      await expect(moduleTab(page, moduleName).locator(activeChip)).toHaveCount(0);
      expect((await agentStatus(request, f.project.id)).agent_run_holdings.filter((run) => run.task_id === story.id)).toEqual([]);

      await page.reload();
      await expect(moduleTab(page, moduleName)).toHaveAttribute("aria-selected", "true");
      await openWorkItem(page, storyName);
      await showDetails(page);
      await expect(page.getByTestId("state-picker")).toContainText("Done");
      await expect(row.getByTestId("agent-state-badge")).toHaveCount(0);
      const resumable = (await graphql(request, TaskResumableTerminalSessionsDocument, { taskId: story.id })).resumable_sessions;
      expect(resumable.find((session) => session.agent_run_id === launch.runId)?.ended_at).toBeTruthy();
    } finally { await f.cleanup(); }
  });

  test("recovers module and Story creation from cancel, blank input and refused writes without launching a run", { tag: "@case-journey-create-recovery" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const f = await journeyFixture(request, "recover");
    try {
      const start = await f.linkedModule(`${f.prefix} start`);
      const moduleName = `${f.prefix} module`;
      const storyName = `${f.prefix} Story`;
      const launches = countOperations(page, "CreateTerminalSession");
      await page.goto("/");
      await moduleTab(page, start.name).click();

      // The top picker's creation entry cancels without creating anything.
      await page.getByRole("button", { name: "Open module picker", exact: true }).click();
      await page.getByRole("dialog", { name: "Module picker", exact: true }).getByRole("option", { name: "Create new module", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add Module", exact: true });
      await dialog.getByPlaceholder("Module name").fill(moduleName);
      await dialog.getByRole("textbox", { name: "Module folder", exact: true }).fill(f.folder);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(moduleTab(page, start.name)).toHaveAttribute("aria-selected", "true");
      expect((await getModules(request, f.project.id)).filter((row) => row.name === moduleName)).toHaveLength(0);

      // A refused folder write keeps the one created module for a retry.
      const manager = await openManager(page);
      await manager.getByRole("button", { name: "New module", exact: true }).first().click();
      const form = manager.getByRole("form", { name: "Create module", exact: true });
      await expect(form.getByRole("button", { name: "Create module", exact: true })).toBeDisabled();
      await form.getByRole("textbox", { name: "Module name", exact: true }).fill(moduleName);
      await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(f.folder);
      const restoreLink = await refuseNext(page, "SetModuleLink");
      await form.getByRole("button", { name: "Create module", exact: true }).click();
      await expect(form.getByRole("alert")).toHaveText("Module created, but its folder could not be saved. Retry to save the folder.");
      await restoreLink();
      const created = (await getModules(request, f.project.id)).filter((row) => row.name === moduleName);
      expect(created).toHaveLength(1);
      await form.getByRole("button", { name: "Save folder", exact: true }).click();
      await expect(manager).toHaveCount(0);
      await expect(moduleTab(page, moduleName)).toHaveAttribute("aria-selected", "true");

      // Blank capture creates nothing; a refused capture keeps its draft.
      const entry = page.getByRole("textbox", { name: "Capture an idea" });
      await entry.fill("   ");
      await entry.press("Enter");
      await entry.fill(storyName);
      const restoreStory = await refuseNext(page, "CreateWorkTrackerWorkItem");
      await entry.press("Enter");
      await expect(page.getByText(/Story could not be created:/)).toBeVisible();
      await expect(entry).toHaveValue(storyName);
      expect((await getWorkItems(request, f.project.id)).filter((row) => row.name === storyName)).toHaveLength(0);
      await restoreStory();
      await entry.press("Enter");
      await expect(page.getByRole("treeitem", { name: new RegExp(storyName) })).toBeVisible();
      await expect(entry).toHaveValue("");
      const story = await storyNamed(request, f.project.id, storyName);
      expect(story.parent_id).toBe(created[0]!.id);
      expect((await getWorkItems(request, f.project.id)).filter((row) => row.parent_id === created[0]!.id).map((row) => row.name)).toEqual([storyName]);

      // Neither recovery launches an agent for the new Story.
      expect(launches()).toBe(0);
      expect((await agentStatus(request, f.project.id)).agent_run_holdings.filter((run) => run.task_id === story.id)).toEqual([]);
      await page.reload();
      await expect(moduleTab(page, moduleName)).toHaveAttribute("aria-selected", "true");
      await expect(moduleTab(page, moduleName)).toHaveCount(1);
      await openWorkItem(page, storyName);
      await expect(codexTerminal(page)).toHaveCount(0);
      expect((await getModules(request, f.project.id)).filter((row) => row.name === moduleName).map((row) => row.id)).toEqual([created[0]!.id]);
      expect(await liveTaskSessions(request, story.id)).toEqual([]);
    } finally { await f.cleanup(); }
  });

  test("closes and restores sprint-filtered module tabs through the strip, picker and Module Manager", { tag: "@case-journey-sprint-close-restore" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const f = await journeyFixture(request, "sprint");
    try {
      const sprint = await f.sprint(`${f.prefix} sprint`);
      const alpha = await f.linkedModule(`${f.prefix} Alpha`);
      const beta = await f.linkedModule(`${f.prefix} Beta`);
      const outside = await f.linkedModule(`${f.prefix} Outside`);
      const stories = [
        await f.story(`${f.prefix} Alpha Story`, alpha.id, sprint.id),
        await f.story(`${f.prefix} Beta Story`, beta.id, sprint.id),
        await f.story(`${f.prefix} Outside Story`, outside.id),
      ];
      const before = await getWorkflowCatalog(request, f.project.id);
      const ranks = Object.fromEntries(before.modules.nodes.map((row) => [row.id, row.rank]));
      await page.goto("/");
      await moduleTab(page, outside.name).click();
      await moduleTab(page, alpha.name).click();
      // The excluded module starts hidden so its later restoration must clear the filter.
      await moduleTabs(page).getByRole("button", { name: `Hide ${outside.name} tab`, exact: true }).click();
      await expect(moduleTab(page, outside.name)).toHaveCount(0);

      await chooseSprint(page, sprint.name);
      await expect(moduleTab(page, alpha.name)).toBeVisible();
      await expect(moduleTab(page, beta.name)).toBeVisible();
      await moduleTab(page, alpha.name).click();
      await expect(moduleTab(page, alpha.name)).toHaveAttribute("aria-selected", "true");
      await moduleTabs(page).getByRole("button", { name: `Hide ${alpha.name} tab`, exact: true }).click();
      await expect(moduleTab(page, alpha.name)).toHaveCount(0);
      await expect(moduleTab(page, beta.name)).toHaveAttribute("aria-selected", "true");
      await expectSprint(page, sprint.name);

      await page.reload();
      await expect(moduleTab(page, alpha.name)).toHaveCount(0);
      await expect(moduleTab(page, outside.name)).toHaveCount(0);
      await chooseSprint(page, sprint.name);
      await expect(moduleTab(page, alpha.name)).toHaveCount(0);
      await page.getByRole("button", { name: "Open module picker" }).click();
      await page.getByRole("dialog", { name: "Module picker" }).getByRole("option", { name: `Restore ${alpha.name} module tab`, exact: true }).click();
      await expect(moduleTab(page, alpha.name)).toHaveAttribute("aria-selected", "true");
      await expectSprint(page, sprint.name);

      const manager = await openManager(page);
      await manager.getByRole("region", { name: "Open", exact: true }).getByRole("button", { name: `Close ${beta.name} tab`, exact: true }).click();
      const hidden = manager.getByRole("region", { name: "Hidden", exact: true });
      await expect(hidden.getByRole("button", { name: `Restore ${beta.name}`, exact: true })).toBeVisible();
      await expect(moduleTab(page, beta.name)).toHaveCount(0);
      await hidden.getByRole("button", { name: `Restore ${beta.name}`, exact: true }).click();
      await expect(moduleTab(page, beta.name)).toBeVisible();
      await expect(manager).toBeVisible();
      await expect(moduleTab(page, alpha.name)).toHaveAttribute("aria-selected", "true");
      // The Stories list, and its sprint chooser, return once the Manager closes.
      await manager.getByRole("button", { name: "Close Module Manager", exact: true }).click();
      await expectSprint(page, sprint.name);

      // Last matching tabs hidden is a recovery state, not deletion.
      await moduleTabs(page).getByRole("button", { name: `Hide ${alpha.name} tab`, exact: true }).click();
      await moduleTabs(page).getByRole("button", { name: `Hide ${beta.name} tab`, exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "All matching module tabs are hidden." })).toBeVisible();
      await page.getByRole("button", { name: "Open module picker" }).click();
      await page.getByRole("dialog", { name: "Module picker" }).getByRole("option", { name: `Restore ${alpha.name} module tab`, exact: true }).click();
      await expect(moduleTab(page, alpha.name)).toHaveAttribute("aria-selected", "true");
      await expectSprint(page, sprint.name);

      // Restoring a module outside the sprint clears the filter explicitly.
      await page.getByRole("button", { name: "Open module picker" }).click();
      await page.getByRole("dialog", { name: "Module picker" }).getByRole("option", { name: `Restore ${outside.name} module tab`, exact: true }).click();
      await expect(moduleTab(page, outside.name)).toHaveAttribute("aria-selected", "true");
      await expect(sprintTrigger(page)).toHaveAccessibleName("Sprint: All sprints");

      await page.reload();
      await expect(moduleTab(page, alpha.name)).toBeVisible();
      await expect(moduleTab(page, outside.name)).toBeVisible();
      await expect(moduleTab(page, beta.name)).toHaveCount(0);
      const after = await getWorkflowCatalog(request, f.project.id);
      const hiddenState = Object.fromEntries(after.module_presentations.nodes.map((row) => [row.module_id, row.tab_hidden]));
      expect([hiddenState[alpha.id], hiddenState[beta.id], hiddenState[outside.id]]).toEqual([false, true, false]);
      // Closing changes presentation only: each module keeps its canonical rank and stays unarchived.
      for (const module of [alpha, beta, outside]) {
        const row = after.modules.nodes.find((candidate) => candidate.id === module.id);
        expect([row?.rank, row?.is_archived]).toEqual([ranks[module.id], false]);
      }
      for (const story of stories) expect((await getWorkItem(request, story.id)).parent_id).toBe(story.parent_id);
    } finally { await f.cleanup(); }
  });

  test("keeps two captured Stories' descriptions separate across switching and reload", { tag: "@case-journey-description-isolation" }, async ({ page, request }) => {
    const f = await journeyFixture(request, "describe");
    try {
      const module = await f.linkedModule(`${f.prefix} module`);
      const nameA = `${f.prefix} Story A`;
      const nameB = `${f.prefix} Story B`;
      const textA = `Alpha only ${f.prefix}`;
      const textB = `Beta only ${f.prefix}`;
      await page.goto("/");
      await moduleTab(page, module.name).click();
      await captureStory(page, nameA);
      const a = await storyNamed(request, f.project.id, nameA);
      await openWorkItem(page, nameA);
      await showDetails(page);
      // Capture B once A is open: back-to-back captures can drop the second (CODING-2868).
      await captureStory(page, nameB);
      const b = await storyNamed(request, f.project.id, nameB);
      await openWorkItem(page, nameA);
      await descriptionEditor(page).fill(textA);
      await descriptionEditor(page).blur();
      await expect.poll(async () => (await getWorkItem(request, a.id)).description).toContain(textA);
      await openWorkItem(page, nameB);
      await expect(descriptionEditor(page)).not.toContainText(textA);
      await descriptionEditor(page).fill(textB);
      await descriptionEditor(page).blur();
      await expect.poll(async () => (await getWorkItem(request, b.id)).description).toContain(textB);
      await openWorkItem(page, nameA);
      await expect(descriptionEditor(page)).toContainText(textA);
      await expect(descriptionEditor(page)).not.toContainText(textB);
      const [savedA, savedB] = [await getWorkItem(request, a.id), await getWorkItem(request, b.id)];
      expect([savedA.description, savedB.description].map((text) => [String(text).includes(textA), String(text).includes(textB)])).toEqual([[true, false], [false, true]]);

      await page.reload();
      await moduleTab(page, module.name).click();
      await openWorkItem(page, nameA);
      await expect(descriptionEditor(page)).toContainText(textA);
      await expect(descriptionEditor(page)).not.toContainText(textB);
      await openWorkItem(page, nameB);
      await expect(descriptionEditor(page)).toContainText(textB);
      await expect(descriptionEditor(page)).not.toContainText(textA);
    } finally { await f.cleanup(); }
  });

  test("keeps a live agent terminal through Module Manager takeover and reload", { tag: "@case-journey-terminal-manager-reload" }, async ({ page, request }) => {
    test.setTimeout(120_000);
    const f = await journeyFixture(request, "terminal");
    let runId: string | undefined;
    try {
      const module = await f.linkedModule(`${f.prefix} module`);
      const story = await f.story(`${f.prefix} Story`, module.id);
      await holdProvider();
      const launches = countOperations(page, "CreateTerminalSession");
      await page.goto("/");
      await moduleTab(page, module.name).click();
      await openWorkItem(page, story.name);
      const launch = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Run item", exact: true }).click());
      await waitForAgent(request, f.project.id, story.id);
      runId = launch.runId;
      const provider = await providerEvidence(launch.runId);
      await codexTerminal(page).last().click();
      const host = page.getByTestId("terminal-host").filter({ visible: true });
      await expect(host).toContainText(composerMarker);
      const viewer = await page.getByTestId("terminal-host-wrapper").filter({ visible: true }).elementHandle();

      const manager = await openManager(page);
      await expect(page.getByTestId("terminal-host").filter({ visible: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(manager).toHaveCount(0);
      await expect(codexTerminal(page)).toHaveCount(1);
      await expect(codexTerminal(page)).toHaveAttribute("aria-selected", "true");
      await expect(host).toContainText(composerMarker);
      await page.keyboard.press("Meta+Shift+M");
      await expect(manager).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(manager).toHaveCount(0);
      await expect(host).toContainText(composerMarker);
      // Takeover hides the retained viewer; it never detaches and rebuilds it.
      expect(await viewer!.evaluate((node) => node.isConnected)).toBe(true);
      expect(launches()).toBe(1);
      expect(processAlive(provider.pid)).toBe(true);
      expect((await agentStatus(request, f.project.id)).agent_run_holdings.filter((run) => run.task_id === story.id).map((run) => run.agent_run_id)).toEqual([launch.runId]);

      await page.reload();
      await moduleTab(page, module.name).click();
      await openWorkItem(page, story.name);
      await codexTerminal(page).last().click();
      await expect(host).toContainText(composerMarker);
      expect(launches()).toBe(1);
      expect(processAlive(provider.pid)).toBe(true);
      const live = (await liveTaskSessions(request, story.id)).find((session) => session.agent_run_id === launch.runId);
      expect(live).toBeTruthy();
      await releaseProvider(launch.runId);
      await waitForAgentExit(request, story.id, launch.runId);
    } finally { if (runId) await releaseProvider(runId); await f.cleanup(); }
  });

  test("keeps the sprint filter through cancelled, refused and empty sprint-filtered tab navigation", { tag: "@case-journey-sprint-recovery" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const f = await journeyFixture(request, "sprint recovery");
    try {
      const sprint = await f.sprint(`${f.prefix} sprint`);
      const empty = await f.sprint(`${f.prefix} empty`);
      const alpha = await f.linkedModule(`${f.prefix} Alpha`);
      const beta = await f.linkedModule(`${f.prefix} Beta`);
      await f.story(`${f.prefix} Alpha Story`, alpha.id, sprint.id);
      await f.story(`${f.prefix} Beta Story`, beta.id, sprint.id);
      const before = await getWorkflowCatalog(request, f.project.id);
      const ranks = Object.fromEntries(before.modules.nodes.map((row) => [row.id, row.rank]));
      await page.goto("/");
      await moduleTab(page, alpha.name).click();
      await chooseSprint(page, sprint.name);
      await moduleTab(page, alpha.name).click();
      await expect(moduleTab(page, alpha.name)).toHaveAttribute("aria-selected", "true");

      // Dismissing the chooser keeps the active sprint.
      await sprintTrigger(page).click();
      await expect(page.getByRole("dialog", { name: "Choose sprint" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Choose sprint" })).toHaveCount(0);
      await expectSprint(page, sprint.name);

      // A refused Hide rolls back inside the sprint; the retry hides it.
      const restoreHide = await refuseNext(page, "UpdateWorkTrackerModulePresentation");
      await moduleTabs(page).getByRole("button", { name: `Hide ${alpha.name} tab`, exact: true }).click();
      await expect(page.getByText(/^Module tab could not be hidden:/)).toBeVisible();
      await restoreHide();
      await expect(moduleTab(page, alpha.name)).toHaveAttribute("aria-selected", "true");
      await expectSprint(page, sprint.name);
      await moduleTabs(page).getByRole("button", { name: `Hide ${alpha.name} tab`, exact: true }).click();
      await expect(moduleTab(page, alpha.name)).toHaveCount(0);
      await expect(moduleTab(page, beta.name)).toHaveAttribute("aria-selected", "true");
      await expectSprint(page, sprint.name);

      // Dismissing the picker restores nothing.
      const pickerButton = page.getByRole("button", { name: "Open module picker" });
      const picker = page.getByRole("dialog", { name: "Module picker" });
      await pickerButton.click();
      await expect(picker.getByRole("option", { name: `Restore ${alpha.name} module tab`, exact: true })).toBeVisible();
      await pickerButton.click();
      await expect(picker).toHaveCount(0);
      await expect(moduleTab(page, alpha.name)).toHaveCount(0);

      // A refused Restore keeps the tab hidden and the filter active; the retry restores it.
      const restoreShow = await refuseNext(page, "UpdateWorkTrackerModulePresentation");
      await pickerButton.click();
      await picker.getByRole("option", { name: `Restore ${alpha.name} module tab`, exact: true }).click();
      await expect(page.getByText(/^Module tab could not be restored:/)).toBeVisible();
      await restoreShow();
      await expect(moduleTab(page, alpha.name)).toHaveCount(0);
      await expectSprint(page, sprint.name);
      await pickerButton.click();
      await picker.getByRole("option", { name: `Restore ${alpha.name} module tab`, exact: true }).click();
      await expect(moduleTab(page, alpha.name)).toHaveAttribute("aria-selected", "true");
      await expectSprint(page, sprint.name);

      // A sprint without Stories is empty, not hidden.
      await chooseSprint(page, empty.name);
      await expect(page.getByRole("status").filter({ hasText: "No modules have stories in this sprint." })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "All matching module tabs are hidden." })).toHaveCount(0);
      await expect(moduleTabs(page).locator('[role="tab"][data-module-id]')).toHaveCount(0);
      await chooseSprint(page, sprint.name);
      await moduleTabs(page).getByRole("button", { name: `Hide ${alpha.name} tab`, exact: true }).click();
      await moduleTabs(page).getByRole("button", { name: `Hide ${beta.name} tab`, exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "All matching module tabs are hidden." })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "No modules have stories in this sprint." })).toHaveCount(0);

      await page.reload();
      await expect(moduleTab(page, alpha.name)).toHaveCount(0);
      await expect(moduleTab(page, beta.name)).toHaveCount(0);
      const after = await getWorkflowCatalog(request, f.project.id);
      for (const module of [alpha, beta]) {
        const presentation = after.module_presentations.nodes.find((row) => row.module_id === module.id);
        const row = after.modules.nodes.find((candidate) => candidate.id === module.id);
        expect([presentation?.tab_hidden, row?.rank, row?.is_archived]).toEqual([true, ranks[module.id], false]);
      }
    } finally { await f.cleanup(); }
  });

  test("keeps refused and delayed description writes on their own Story while another Story is open", { tag: "@case-journey-description-write-isolation" }, async ({ page, request }) => {
    test.setTimeout(60_000);
    const f = await journeyFixture(request, "describe writes");
    try {
      const module = await f.linkedModule(`${f.prefix} module`);
      const a = await f.story(`${f.prefix} Story A`, module.id);
      const b = await f.story(`${f.prefix} Story B`, module.id);
      const textA = `Alpha refused ${f.prefix}`;
      const retriedA = `Alpha retried ${f.prefix}`;
      const textB = `Beta delayed ${f.prefix}`;
      const compact = (id: string) => id.replaceAll("-", "");
      const writes: { id: string; description: string }[] = [];
      page.on("request", (sent) => {
        const body = sent.url().endsWith("/graphql") ? sent.postDataJSON() : null;
        if (body?.operationName === "UpdateWorkTrackerWorkItemDetails") writes.push({ id: compact(String(body.variables.id)), description: JSON.stringify(body.variables) });
      });
      let releaseB!: () => void;
      const heldB = new Promise<void>((resolve) => { releaseB = resolve; });
      const boundary = async (route: Route) => {
        const body = route.request().postDataJSON();
        if (body?.operationName !== "UpdateWorkTrackerWorkItemDetails") return route.fallback();
        if (compact(String(body.variables.id)) === compact(a.id)) {
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Description write refused at boundary" }] }) });
        }
        await heldB;
        return route.fallback();
      };
      await page.route("**/graphql", boundary);
      await page.goto("/");
      await moduleTab(page, module.name).click();
      await openWorkItem(page, a.name);
      await showDetails(page);

      // A's refused write keeps its draft on A only.
      await descriptionEditor(page).fill(textA);
      await descriptionEditor(page).blur();
      await expect(page.getByTestId("issue-description").filter({ visible: true })).toContainText("Description not saved:");
      expect((await getWorkItem(request, a.id)).description).toBe("");
      await openWorkItem(page, b.name);
      await expect(descriptionEditor(page)).toHaveText("");

      // B's delayed write is still B's after A is reopened.
      await descriptionEditor(page).fill(textB);
      await descriptionEditor(page).blur();
      await expect.poll(() => writes.some((write) => write.id === compact(b.id))).toBe(true);
      await openWorkItem(page, a.name);
      await expect(descriptionEditor(page)).toContainText(textA);
      await expect(descriptionEditor(page)).not.toContainText(textB);
      releaseB();
      await expect.poll(async () => (await getWorkItem(request, b.id)).description).toContain(textB);
      expect((await getWorkItem(request, a.id)).description).toBe("");

      // Once the boundary accepts again, A's retry saves on A.
      await page.unroute("**/graphql", boundary);
      await descriptionEditor(page).fill(retriedA);
      await descriptionEditor(page).blur();
      await expect.poll(async () => (await getWorkItem(request, a.id)).description).toContain(retriedA);
      const [savedA, savedB] = [String((await getWorkItem(request, a.id)).description), String((await getWorkItem(request, b.id)).description)];
      expect([savedA.includes(textB), savedB.includes(textA), savedB.includes(retriedA)]).toEqual([false, false, false]);
      expect(writes.filter((write) => write.id === compact(b.id)).some((write) => write.description.includes(textA) || write.description.includes(retriedA))).toBe(false);
      expect(writes.filter((write) => write.id === compact(a.id)).some((write) => write.description.includes(textB))).toBe(false);

      await page.reload();
      await moduleTab(page, module.name).click();
      await openWorkItem(page, a.name);
      await showDetails(page);
      await expect(descriptionEditor(page)).toContainText(retriedA);
      await expect(descriptionEditor(page)).not.toContainText(textB);
      await openWorkItem(page, b.name);
      await expect(descriptionEditor(page)).toContainText(textB);
      await expect(descriptionEditor(page)).not.toContainText(textA);
    } finally { await f.cleanup(); }
  });

  test("shows a session lost during Module Manager takeover as ended without relaunching it", { tag: "@case-journey-terminal-session-loss" }, async ({ page, request }) => {
    test.setTimeout(120_000);
    const f = await journeyFixture(request, "terminal loss");
    let runId: string | undefined;
    try {
      const module = await f.linkedModule(`${f.prefix} module`);
      const story = await f.story(`${f.prefix} Story`, module.id);
      await prepareAgentProvider("failure");
      const launches = countOperations(page, "CreateTerminalSession");
      await page.goto("/");
      await moduleTab(page, module.name).click();
      await openWorkItem(page, story.name);
      const launch = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Run item", exact: true }).click());
      runId = launch.runId;
      await waitForAgent(request, f.project.id, story.id);
      const provider = await providerEvidence(launch.runId);
      await codexTerminal(page).last().click();
      await expect(page.getByTestId("terminal-host").filter({ visible: true })).toContainText(composerMarker);

      // The provider fails while Module Manager owns the workspace.
      const manager = await openManager(page);
      await releaseProvider(launch.runId);
      await waitForAgentExit(request, story.id, launch.runId);
      expect(processAlive(provider.pid)).toBe(false);
      await page.keyboard.press("Escape");
      await expect(manager).toHaveCount(0);
      // The lost session leaves no live terminal tab; it is offered only as resumable history.
      await expectLostSessionResumable(page);
      const row = page.getByRole("treeitem", { name: new RegExp(story.name) });
      await expect(row.getByTestId("agent-state-badge")).toHaveCount(0);
      await expect(moduleTab(page, module.name).locator(activeChip)).toHaveCount(0);
      expect(launches()).toBe(1);
      expect((await agentStatus(request, f.project.id)).agent_run_holdings.filter((run) => run.task_id === story.id)).toEqual([]);

      // Reload rebuilds the failed run from its ended record and never relaunches it.
      await page.reload();
      await moduleTab(page, module.name).click();
      await openWorkItem(page, story.name);
      await expectLostSessionResumable(page);
      await expect(row.getByTestId("agent-state-badge")).toHaveCount(0);
      await expect(moduleTab(page, module.name).locator(activeChip)).toHaveCount(0);
      expect(launches()).toBe(1);
      expect((await agentStatus(request, f.project.id)).agent_run_holdings.filter((run) => run.task_id === story.id)).toEqual([]);
      const history = await graphql(request, WorkItemEndedRunsDocument, { issueId: story.id, issueType: "task", scopes: ["task"], limit: 50 });
      const ended = history.work_item.nodes[0]?.ended_runs.nodes.find((run) => run.agent_run_id === launch.runId);
      expect([ended?.status, ended?.exit_code, Boolean(ended?.ended_at)]).toEqual(["exited", 23, true]);
    } finally { if (runId) await releaseProvider(runId); await f.cleanup(); }
  });
});
