import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { getModules, graphql, selectModuleForProfile, type ModuleRow } from "../support";
import { ModuleShellSessionsDocument } from "../../src/features/agents/terminal/generated/terminalSessions.documents";
import { SCRATCH_RUN_TASK_ID } from "../../src/features/agents/types";
import {
  clearModuleLinkEventually,
  countRequests,
  expectSavedPanelPreference,
  hideEveryModuleTab,
  liveShells,
  openFolderCommand,
  openShellModule,
  refuseOperation,
  removeFolders,
  restoreModuleTabs,
  shellModule,
  terminateShells,
  typeInShell,
} from "../module-terminal-panel-support";
import { featureSuite } from "./featureSuite";

featureSuite("module-terminal-panel", () => {
  let modules: ModuleRow[] = [];
  let folders: string[] = [];

  async function linkedModule(request: APIRequestContext, label: string) {
    const created = await shellModule(request, label);
    modules.push(created.module);
    folders.push(created.folder);
    return created;
  }

  test.afterEach(async ({ request }) => {
    try {
      await terminateShells(request, modules);
    } finally {
      await removeFolders(folders);
      modules = [];
      folders = [];
    }
  });

  test("closes a shell while it is still starting and leaves the empty strip", { tag: "@case-module-shell-close-while-starting" }, async ({ page, request }) => {
    // CODING-2751 — Close is offered as soon as the shell tab exists, before
    // its prompt renders. Closing then must end the shell, not refuse it.
    const { module } = await linkedModule(request, "closing");
    await openShellModule(page, module.name);
    await page.getByTestId("footer-terminal-toggle").click();
    const panel = page.getByTestId("terminal-panel");
    const close = panel.getByRole("button", { name: "Close shell 1" });
    await expect(close).toBeEnabled();
    const terminated = page.waitForResponse((response) =>
      response.url().endsWith("/graphql") && response.request().postDataJSON()?.operationName === "UpdateTerminalSession");
    await close.click();
    const termination = await (await terminated).json();
    expect(termination.errors, JSON.stringify(termination.errors)).toBeUndefined();

    await expect(panel.getByRole("tab", { name: "Shell 1" })).toHaveCount(0);
    await expect(panel.getByTestId("terminal-panel-no-shells")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    // Rust records termination only after it proves the tmux session absent.
    const live = await graphql(request, ModuleShellSessionsDocument, { moduleId: module.id, scratchTaskId: SCRATCH_RUN_TASK_ID, limit: 100 });
    expect(live.terminal_sessions.sessions).toEqual([]);
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("opens, hides, restores, and closes a Rust-backed module shell", { tag: "@case-module-shell-open-hide-restore" }, async ({ page, request }) => {
    const { module, folder } = await linkedModule(request, "primary");
    const { module: secondModule } = await linkedModule(request, "navigation");
    await openShellModule(page, module.name);
    const footerToggle = page.getByTestId("footer-terminal-toggle");
    await expect(footerToggle).toHaveAttribute("aria-label", "Open terminal panel");
    await footerToggle.click();

    const panel = page.getByTestId("terminal-panel");
    await expect(panel).toBeVisible();
    await expect(footerToggle).toHaveAttribute("aria-label", "Minimize terminal panel");
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();

    // CODING-1487 — browser development renders with xterm over the WebSocket
    // terminal adapter, so one host element both takes keystrokes and holds
    // the rendered rows.
    const terminal = panel.getByTestId("terminal-host");
    await expect(terminal).toBeVisible();
    await typeInShell(page, terminal, "pwd");
    await expect(terminal).toContainText(folder);
    await typeInShell(page, terminal, "printf '\\124\\111\\103\\113\\105\\124\\122\\131\\137\\120\\124\\131\\137\\117\\113\\012'");
    await expect(terminal).toContainText("TICKETRY_PTY_OK");

    // Leave terminal typing mode before exercising the WebView-owned grip.
    await page.keyboard.press("Meta+Escape");
    const resizeGrip = panel.getByRole("separator", { name: "Resize the terminal panel" });
    const ordinaryHeight = Number(await resizeGrip.getAttribute("aria-valuenow"));
    await resizeGrip.focus();
    await expect(resizeGrip).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(resizeGrip).toHaveAttribute("aria-valuenow", String(ordinaryHeight + 24));
    await page.waitForTimeout(650);
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(resizeGrip).toHaveAttribute("aria-valuenow", String(ordinaryHeight + 24));
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await expect(panel.getByTestId("terminal-host")).toContainText("TICKETRY_PTY_OK");

    await panel.getByRole("button", { name: "Maximize terminal panel" }).click();
    await expect(panel.getByRole("button", { name: "Restore terminal panel size" })).toBeVisible();
    const maximizedHeight = Number(await resizeGrip.getAttribute("aria-valuenow"));
    expect(maximizedHeight).toBeGreaterThan(ordinaryHeight + 24);
    await page.waitForTimeout(650);
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "Restore terminal panel size" })).toBeVisible();
    await expect(resizeGrip).toHaveAttribute("aria-valuenow", String(maximizedHeight));
    await panel.getByRole("button", { name: "Restore terminal panel size" }).click();
    await expect(resizeGrip).toHaveAttribute("aria-valuenow", String(ordinaryHeight + 24));

    await page.getByRole("tab", { name: secondModule.name, exact: true }).last().click();
    await expect(panel).toHaveCount(0);
    await expect(footerToggle).toHaveAttribute("aria-label", "Open terminal panel");
    await page.getByRole("tab", { name: module.name, exact: true }).last().click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();

    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
    await expect(panel).toHaveCount(0);
    await expect(footerToggle).toHaveAttribute("aria-label", "Open terminal panel");

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

  test("creates, selects, restores, caps, and closes Rust-backed shells", { tag: "@case-module-shell-tabs-cap" }, async ({ page, request }) => {
    const { module } = await linkedModule(request, "tabs");
    await openShellModule(page, module.name);
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
    await expect(newShell).toHaveAttribute("title", "A module can hold 4 shells.");

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
    await expect(newShell).toBeEnabled();
    await expect.poll(async () => (await liveShells(request, module.id)).length).toBe(3);
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
  });

  test("recovers a refused module shell after its folder link is removed", { tag: "@case-module-shell-folder-refusal" }, async ({ page, request }) => {
    const { module, folder } = await linkedModule(request, "refused");
    await openShellModule(page, module.name);
    await clearModuleLinkEventually(request, module.id);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    const recovery = panel.getByTestId("terminal-panel-folder-required");
    await expect(recovery).toHaveAttribute("data-refusal-reason", "module_folder_unusable");
    await expect(recovery).toContainText("This module has no usable folder.");

    const folderInput = recovery.getByRole("textbox", { name: "Module folder for the terminal panel" });
    await folderInput.fill("relative/path");
    await expect(folderInput).toHaveAttribute("aria-invalid", "true");
    await expect(recovery.getByRole("button", { name: "Use this folder" })).toBeDisabled();

    await folderInput.fill(join(folder, "missing-module-folder"));
    await recovery.getByRole("button", { name: "Use this folder" }).click();
    await expect(recovery.getByRole("alert")).toContainText("Could not save the module folder. Retry to continue.");
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toHaveCount(0);
    expect(await liveShells(request, module.id)).toEqual([]);

    await folderInput.fill(folder);
    await recovery.getByRole("button", { name: "Use this folder" }).click();

    await expect(recovery).toHaveCount(0);
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await panel.getByRole("button", { name: "Close shell 1" }).click();
    await expect(panel.getByTestId("terminal-panel-no-shells")).toBeVisible();
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
  });

  test("surfaces a failed Rust shell exit status", { tag: "@case-module-shell-failed-exit" }, async ({ page, request }) => {
    // Exits reach the panel through the run projection: a pushed completion
    // frame or, failing that, backend reconciliation, which can take seconds.
    test.setTimeout(90_000);
    const { module } = await linkedModule(request, "failed");
    await openShellModule(page, module.name);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    const terminal = panel.getByTestId("terminal-host");
    await expect(terminal).toBeVisible();
    await typeInShell(page, terminal, "exit 7");

    const dead = panel.getByTestId("terminal-panel-dead-shell");
    await expect(dead).toHaveAttribute("data-exit-code", "7", { timeout: 45_000 });
    await expect(dead).toContainText("Shell exited with code 7.");
    await expect(panel.getByTestId("terminal-panel-tab")).toHaveAttribute("data-dead", "true");
    await expect(panel.getByRole("tab", { name: "Shell 1 · exit 7" })).toBeVisible();
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
  });

  test("persists the keyboard-selected module folder and launches a shell there", { tag: "@case-module-shell-keyboard-folder" }, async ({ page, request }) => {
    const { module, folder } = await linkedModule(request, "keyboard-folder");
    const { folder: alternateFolder } = await linkedModule(request, "alternate-folder");
    await openShellModule(page, module.name);

    let dialog = await openFolderCommand(page);
    let folderInput = dialog.getByPlaceholder("Local folder (optional)");
    await expect(folderInput).toHaveValue(folder);
    await folderInput.fill(alternateFolder);
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    await page.reload();
    dialog = await openFolderCommand(page);
    folderInput = dialog.getByPlaceholder("Local folder (optional)");
    await expect(folderInput).toHaveValue(alternateFolder);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    const terminal = panel.getByTestId("terminal-host");
    await expect(terminal).toBeVisible();
    await typeInShell(page, terminal, "pwd");
    await expect(terminal).toContainText(alternateFolder);
    await panel.getByRole("button", { name: "Close shell 1" }).click();
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();

    dialog = await openFolderCommand(page);
    folderInput = dialog.getByPlaceholder("Local folder (optional)");
    await folderInput.fill(folder);
    await dialog.getByRole("button", { name: "Save" }).click();
    await page.reload();
    dialog = await openFolderCommand(page);
    await expect(dialog.getByPlaceholder("Local folder (optional)")).toHaveValue(folder);
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });

  test("removes a cleanly exited shell and selects its surviving neighbour", { tag: "@case-module-shell-clean-exit" }, async ({ page, request }) => {
    // Exits reach the panel through the run projection: a pushed completion
    // frame or, failing that, backend reconciliation, which can take seconds.
    test.setTimeout(90_000);
    const { module } = await linkedModule(request, "clean-exit");
    await openShellModule(page, module.name);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await panel.getByRole("button", { name: "New shell" }).click();
    await expect(panel.getByRole("tab", { name: "Shell 2" })).toHaveAttribute("aria-selected", "true");
    const [firstRun, secondRun] = await panel.getByTestId("terminal-panel-tab").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-run-id")));

    await typeInShell(page, panel.getByTestId("terminal-host"), "exit 0");
    await expect(panel.locator(`[data-run-id="${secondRun}"]`)).toHaveCount(0, { timeout: 45_000 });
    await expect(panel.getByTestId("terminal-panel-dead-shell")).toHaveCount(0);
    await expect(panel.getByTestId("terminal-panel-tab")).toHaveCount(1);
    await expect(panel.locator(`[data-run-id="${firstRun}"]`)).toHaveAttribute("data-active", "true");
    await expect.poll(() => liveShells(request, module.id)).toEqual([firstRun]);

    await typeInShell(page, panel.getByTestId("terminal-host"), "exit 0");
    await expect(panel.getByTestId("terminal-panel-tab")).toHaveCount(0, { timeout: 45_000 });
    await expect(panel.getByTestId("terminal-panel-no-shells")).toHaveText("No shells in this module. Use + to start one.");
    await page.reload();
    await expect(panel).toBeVisible();
    // A reopened module with no surviving shell starts a fresh one.
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    const [freshRun] = await liveShells(request, module.id);
    expect([firstRun, secondRun]).not.toContain(freshRun);
  });

  test("restarts a failed shell in its slot after a refused restart", { tag: "@case-module-shell-restart-recovery" }, async ({ page, request }) => {
    // Exits reach the panel through the run projection: a pushed completion
    // frame or, failing that, backend reconciliation, which can take seconds.
    test.setTimeout(90_000);
    const { module } = await linkedModule(request, "restart");
    await openShellModule(page, module.name);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    const deadRun = await panel.getByTestId("terminal-panel-tab").getAttribute("data-run-id");
    await typeInShell(page, panel.getByTestId("terminal-host"), "exit 3");
    const dead = panel.getByTestId("terminal-panel-dead-shell");
    await expect(dead).toHaveAttribute("data-exit-code", "3", { timeout: 45_000 });

    const refusal = refuseOperation("CreateModuleShell", "Shell restart refused by the e2e network boundary");
    await page.route("**/graphql", refusal.handler);
    await dead.getByRole("button", { name: "Restart shell" }).click();
    await expect(page.getByText(/Shell could not be restarted:/)).toBeVisible();
    expect(refusal.refusals()).toBeGreaterThan(0);
    await expect(dead).toBeVisible();
    await expect(panel.getByTestId("terminal-panel-tab")).toHaveAttribute("data-run-id", deadRun!);
    await expect(panel.getByRole("tab", { name: "Shell 1 · exit 3" })).toBeVisible();
    await page.unroute("**/graphql", refusal.handler);

    await dead.getByRole("button", { name: "Restart shell" }).click();
    await expect(dead).toHaveCount(0, { timeout: 20_000 });
    const tab = panel.getByTestId("terminal-panel-tab");
    await expect(tab).toHaveCount(1);
    await expect(tab).toHaveAttribute("data-dead", "false");
    await expect(tab).not.toHaveAttribute("data-run-id", deadRun!);
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toHaveAttribute("aria-selected", "true");
    const restartedRun = await tab.getAttribute("data-run-id");
    await typeInShell(page, panel.getByTestId("terminal-host"), "echo RESTARTED_SHELL_OK");
    await expect(panel.getByTestId("terminal-host")).toContainText("RESTARTED_SHELL_OK");
    expect(await liveShells(request, module.id)).toEqual([restartedRun]);

    // A dead tab is dismissed locally; it has no durable session to end.
    await typeInShell(page, panel.getByTestId("terminal-host"), "exit 4");
    await expect(panel.getByTestId("terminal-panel-dead-shell")).toHaveAttribute("data-exit-code", "4", { timeout: 45_000 });
    const terminations = countRequests(page, "UpdateTerminalSession");
    await panel.getByRole("button", { name: "Close shell 1" }).click();
    await expect(panel.getByTestId("terminal-panel-no-shells")).toBeVisible();
    expect(terminations()).toBe(0);
  });

  test("shows a launch failure and starts the shell on Try again", { tag: "@case-module-shell-launch-failure" }, async ({ page, request }) => {
    const { module } = await linkedModule(request, "launch-failure");
    await openShellModule(page, module.name);
    const refusal = refuseOperation("CreateModuleShell", "Shell launch refused by the e2e network boundary");
    await page.route("**/graphql", refusal.handler);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    const failure = panel.getByTestId("terminal-panel-failure");
    await expect(failure).toContainText("Could not start a shell:");
    await expect(failure).toContainText("Shell launch refused by the e2e network boundary");
    await expect(panel.getByRole("button", { name: "Minimize terminal panel" })).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toHaveCount(0);
    expect(await liveShells(request, module.id)).toEqual([]);

    await page.unroute("**/graphql", refusal.handler);
    await failure.getByRole("button", { name: "Try again" }).click();
    await expect(failure).toHaveCount(0);
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await expect.poll(async () => (await liveShells(request, module.id)).length).toBe(1);
  });

  test("keeps a shell whose close is refused and closes it on retry", { tag: "@case-module-shell-close-refusal" }, async ({ page, request }) => {
    const { module } = await linkedModule(request, "close-refusal");
    await openShellModule(page, module.name);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await panel.getByRole("button", { name: "New shell" }).click();
    await expect(panel.getByRole("tab", { name: "Shell 2" })).toHaveAttribute("aria-selected", "true");
    const runs = await panel.getByTestId("terminal-panel-tab").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-run-id")));

    const refusal = refuseOperation("UpdateTerminalSession", "Shell close refused by the e2e network boundary");
    await page.route("**/graphql", refusal.handler);
    await panel.getByRole("button", { name: "Close shell 2" }).click();
    await expect(page.getByText(/Shell could not be closed:/)).toBeVisible();
    await expect(panel.getByRole("tab", { name: "Shell 2" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => panel.getByTestId("terminal-panel-tab").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-run-id")))).toEqual(runs);
    expect((await liveShells(request, module.id)).sort()).toEqual([...runs].sort());
    await page.unroute("**/graphql", refusal.handler);

    await panel.getByRole("button", { name: "Close shell 2" }).click();
    await expect(panel.getByRole("tab", { name: "Shell 2" })).toHaveCount(0);
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => liveShells(request, module.id)).toEqual([runs[0]]);
  });

  test("rediscovers surviving shells and the active tab after reload without duplicates", { tag: "@case-module-shell-rediscovery" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const { module } = await linkedModule(request, "rediscovery");
    await openShellModule(page, module.name);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    // Shell 1 must be fully running before Shell 2 exists, so creation order is unambiguous.
    await typeInShell(page, panel.getByTestId("terminal-host"), "echo FIRST_SHELL_READY");
    await expect(panel.getByTestId("terminal-host")).toContainText("FIRST_SHELL_READY");
    await page.keyboard.press("Meta+Escape");
    await panel.getByRole("button", { name: "New shell" }).click();
    await expect(panel.getByRole("tab", { name: "Shell 2" })).toHaveAttribute("aria-selected", "true");
    await typeInShell(page, panel.getByTestId("terminal-host"), "echo SURVIVING_SHELL_MARKER");
    await expect(panel.getByTestId("terminal-host")).toContainText("SURVIVING_SHELL_MARKER");
    const runs = await panel.getByTestId("terminal-panel-tab").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-run-id")));

    // A failed rediscovery must not mint a duplicate beside surviving shells.
    await page.keyboard.press("Meta+Escape");
    await expectSavedPanelPreference(page, "studio.terminalPanelActiveShell:v1", module.id, runs[1]);
    const refusal = refuseOperation("ModuleShellSessions", "Shell discovery refused by the e2e network boundary");
    await page.route("**/graphql", refusal.handler);
    const launches = countRequests(page, "CreateModuleShell");
    await page.reload();
    await expect(panel).toBeVisible();
    await expect.poll(refusal.refusals).toBeGreaterThan(0);
    await expect(panel.getByTestId("terminal-panel-pending")).toBeVisible();
    await expect(panel.getByTestId("terminal-panel-tab")).toHaveCount(0);
    expect(launches()).toBe(0);
    expect((await liveShells(request, module.id)).sort()).toEqual([...runs].sort());

    // The next open rediscovers the same shells in creation order, each keeping
    // its Shell N label, and the remembered active tab.
    await page.unroute("**/graphql", refusal.handler);
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const rediscovered = () => panel.getByTestId("terminal-panel-tab").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-run-id")));
    await expect.poll(rediscovered).toEqual(runs);
    await expect(panel.locator(`[data-run-id="${runs[0]}"]`).getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await expect(panel.locator(`[data-run-id="${runs[1]}"]`).getByRole("tab", { name: "Shell 2" })).toBeVisible();
    await expect(panel.locator(`[data-run-id="${runs[1]}"]`)).toHaveAttribute("data-active", "true");
    await expect(panel.getByTestId("terminal-host")).toContainText("SURVIVING_SHELL_MARKER");
    expect(launches()).toBe(0);

    await panel.locator(`[data-run-id="${runs[0]}"]`).getByRole("tab").click();
    await expectSavedPanelPreference(page, "studio.terminalPanelActiveShell:v1", module.id, runs[0]);
    await expectSavedPanelPreference(page, "studio.terminalPanelOpen:v1", module.id, true);
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(panel.locator(`[data-run-id="${runs[0]}"]`)).toHaveAttribute("data-active", "true");
    await expect.poll(rediscovered).toEqual(runs);
    await expect(panel.locator(`[data-run-id="${runs[0]}"]`).getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await expect(panel.getByTestId("terminal-host")).toContainText("FIRST_SHELL_READY");
    expect(launches()).toBe(0);
  });

  test("resizes by pointer, leaves maximized mode and keeps shells across minimize", { tag: "@case-module-panel-furniture" }, async ({ page, request }) => {
    const { module } = await linkedModule(request, "furniture");
    await openShellModule(page, module.name);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    const run = await panel.getByTestId("terminal-panel-tab").getAttribute("data-run-id");
    const grip = panel.getByRole("separator", { name: "Resize the terminal panel" });
    const before = Number(await grip.getAttribute("aria-valuenow"));
    const box = (await grip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => Number(await grip.getAttribute("aria-valuenow"))).toBeGreaterThan(before + 40);
    const dragged = Number(await grip.getAttribute("aria-valuenow"));
    await page.keyboard.press("Meta+Escape");
    await grip.focus();
    await page.keyboard.press("ArrowDown");
    await expect(grip).toHaveAttribute("aria-valuenow", String(dragged - 24));

    await panel.getByRole("button", { name: "Maximize terminal panel" }).click();
    await expect(panel.getByRole("button", { name: "Restore terminal panel size" })).toBeVisible();
    const maximized = Number(await grip.getAttribute("aria-valuenow"));
    const maxBox = (await grip.boundingBox())!;
    await page.mouse.move(maxBox.x + maxBox.width / 2, maxBox.y + maxBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(maxBox.x + maxBox.width / 2, maxBox.y + maxBox.height / 2 + 80, { steps: 6 });
    await page.mouse.up();
    await expect(panel.getByRole("button", { name: "Maximize terminal panel" })).toBeVisible();
    await expect.poll(async () => Number(await grip.getAttribute("aria-valuenow"))).toBeLessThan(maximized);
    const resized = Number(await grip.getAttribute("aria-valuenow"));

    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();
    await expect(panel).toHaveCount(0);
    expect(await liveShells(request, module.id)).toEqual([run]);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    await expect(panel.getByTestId("terminal-panel-tab")).toHaveAttribute("data-run-id", run!);
    await expect(grip).toHaveAttribute("aria-valuenow", String(resized));
    await page.waitForTimeout(650);
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(grip).toHaveAttribute("aria-valuenow", String(resized));
    await expect(panel.getByRole("button", { name: "Maximize terminal panel" })).toBeVisible();
  });

  test("toggles the panel with the chord while typing and disables it without a module", { tag: "@case-module-panel-toggle-entry" }, async ({ page, request }) => {
    const { module, projectId } = await linkedModule(request, "toggle-entry");
    await openShellModule(page, module.name);
    const footerToggle = page.getByTestId("footer-terminal-toggle");
    await page.keyboard.press("Control+Backquote");
    const panel = page.getByTestId("terminal-panel");
    await expect(panel).toBeVisible();
    await expect(footerToggle).toHaveAccessibleName("Minimize terminal panel");
    const terminal = panel.getByTestId("terminal-host");
    await typeInShell(page, terminal, "echo CHORD_WHILE_TYPING");
    await expect(terminal).toContainText("CHORD_WHILE_TYPING");
    // The capture chord still reaches the panel while xterm owns typing.
    await page.keyboard.press("Control+Backquote");
    await expect(panel).toHaveCount(0);
    await expect(footerToggle).toHaveAccessibleName("Open terminal panel");
    await footerToggle.click();
    await expect(panel.getByTestId("terminal-host")).toContainText("CHORD_WHILE_TYPING");
    await panel.getByRole("button", { name: "Minimize terminal panel" }).click();

    const hidden = await hideEveryModuleTab(page, request, projectId);
    expect(hidden).toContain(module.name);
    try {
      await expect(page.getByTestId("empty-module-workspace")).toBeVisible();
      await expect(footerToggle).toBeDisabled();
      await expect(footerToggle).toHaveAccessibleName("Select a module to open a terminal panel");
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("Control+Backquote");
      await expect(panel).toHaveCount(0);
    } finally {
      await restoreModuleTabs(page, hidden);
    }
    await page.getByRole("tab", { name: module.name, exact: true }).last().click();
    await expect(footerToggle).toBeEnabled();
    await expect(footerToggle).toHaveAccessibleName("Open terminal panel");
    expect((await getModules(request, projectId)).map((row) => row.name)).toContain(module.name);
  });

  test("keeps a vanished folder's shell refusal across reload and starts in the relinked folder", { tag: "@case-module-shell-folder-persistence" }, async ({ page, request }) => {
    const { module, folder, projectId } = await linkedModule(request, "folder-persistence");
    const relinked = await mkdtemp(join(tmpdir(), "ticketry-module-terminal-relinked-"));
    folders.push(relinked);
    await removeFolders([folder]);
    await openShellModule(page, module.name);
    await page.getByRole("button", { name: "Open terminal panel" }).click();
    const panel = page.getByTestId("terminal-panel");
    const recovery = panel.getByTestId("terminal-panel-folder-required");
    await expect(recovery).toHaveAttribute("data-refusal-reason", "module_folder_unusable");
    await expectSavedPanelPreference(page, "studio.terminalPanelOpen:v1", module.id, true);
    await page.reload();
    // The refusal is recomputed by a fresh launch attempt, not remembered locally.
    await expect(recovery).toHaveAttribute("data-refusal-reason", "module_folder_unusable");
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toHaveCount(0);
    expect(await liveShells(request, module.id)).toEqual([]);
    // A link written outside the panel is honoured by the panel's next attempt.
    await selectModuleForProfile(request, projectId, module.id, relinked);
    await page.reload();
    await expect(panel.getByRole("tab", { name: "Shell 1" })).toBeVisible();
    await typeInShell(page, panel.getByTestId("terminal-host"), "pwd");
    await expect(panel.getByTestId("terminal-host")).toContainText(relinked);
  });
});
