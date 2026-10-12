import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  buildDesktopAcceptanceApplication,
  requireTmux,
  runDesktopInstallationScenario,
} from "./desktop-installation.mjs";
import { proveDescriptionSaveAndStorySwitch } from "./desktop-description-acceptance.mjs";
import { verifyLiveMcpRecovery } from "./desktop-mcp-recovery-acceptance.mjs";
import { prepareStageSkillWorkspace, proveStageSkillLaunch } from "./desktop-stage-skill-acceptance.mjs";
import {
  assertNativeRendererOwnsTheRun,
  captureIdea,
  click,
  expectResumableRun,
  onboardCodexWithModule,
  openExistingStory,
} from "./desktop-studio-ui.mjs";

/**
 * The single **Run item** journey: one scenario over a fresh isolated desktop
 * installation (see `desktop-installation.mjs`) with the disposable
 * `desktop-acceptance-provider.mjs` as its approved `codex` executable.
 */
const providerScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "desktop-acceptance-provider.mjs");
const providerEvidence = [
  "provider-error.log",
  "provider-hooks.log",
  "provider-mcp.log",
  "provider-prompt.log",
  "provider-started.json",
  "recovery-orderly.json",
  "recovery-sigkill.json",
];

async function createStoryThroughStudio(browser, workspaceDirectory) {
  await onboardCodexWithModule(browser, { workspaceDirectory });

  const taskId = await captureIdea(browser, "Prove desktop agent execution");
  await openExistingStory(browser, taskId);
  return {
    launch: await browser.$("aria/Run item"),
    taskId,
  };
}

async function waitForState(browser, state) {
  const picker = await browser.$('[data-testid="state-picker"]');
  await picker.waitUntil(async () => (await picker.getText()).includes(state), {
    timeout: 30_000,
    timeoutMsg: `ticket did not visibly move to ${state}`,
  });
}

async function runItemJourney(installation) {
  const { root, workspaceDirectory, dataDirectory } = installation;
  const marker = path.join(root, "provider-started.json");
  // The provider and its MCP bridge outlive Ticketry inside private tmux;
  // end them too if the journey is interrupted.
  installation.trackHelperProcesses(() => {
    if (!existsSync(marker)) return [];
    const provider = JSON.parse(readFileSync(marker, "utf8"));
    return [provider.pid, provider.bridge_pid];
  });
  if (process.argv.includes("--stage-skills")) prepareStageSkillWorkspace(workspaceDirectory);
  let browser = await installation.start();
  const story = await createStoryThroughStudio(browser, workspaceDirectory);
  await waitForState(browser, "Ideas");
  if (process.argv.includes("--stage-skills")) {
    await proveStageSkillLaunch({
      browser, root, workspaceDirectory, taskId: story.taskId,
      codexHome: installation.environment.CODEX_HOME, marker,
      inventory: () => installation.tmuxInventory(),
      capture: () => installation.tmuxCapture(),
      assertRenderer: () => assertNativeRendererOwnsTheRun(browser),
    });
    return;
  }
  // CODING-1528: prove the description seam in WebKit before any run exists.
  if (!process.argv.includes("--mcp-recovery")) {
    await proveDescriptionSaveAndStorySwitch(browser, story.taskId);
  }
  await openExistingStory(browser, story.taskId);
  story.launch = await browser.$("aria/Run item");
  writeFileSync(path.join(root, "provider-task"), `${story.taskId}\nCoding\n`);
  if (!existsSync(marker)) {
    await click(story.launch);
    const toast = await browser.$(
      '//*[@data-testid and starts-with(@data-testid,"toast-") and contains(.,"Agent run")]',
    );
    await toast.waitForDisplayed({ timeout: 20_000 });
    const launchResult = await toast.getText();
    if (!launchResult.includes("Agent run started.")) {
      throw new Error(`Run item failed through the visible UI: ${launchResult}`);
    }
  }
  const deadline = Date.now() + 20_000;
  while (!existsSync(marker) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!existsSync(marker)) {
    throw new Error("the disposable provider did not start");
  }
  const provider = JSON.parse(readFileSync(marker, "utf8"));
  if (provider.task_id !== story.taskId || provider.cwd !== workspaceDirectory) {
    throw new Error("the disposable provider did not receive Ticketry's task and CWD");
  }
  if (provider.mcp_data_directory !== dataDirectory || provider.mcp_authorization !== true) {
    throw new Error("the disposable provider did not receive Ticketry's data-directory MCP authority");
  }
  const inventory = installation.tmuxInventory();
  if (inventory.includes("<no private tmux sessions>") || !inventory.includes("|0|")) {
    throw new Error(`the disposable provider is not live in private tmux: ${inventory.trim()}`);
  }

  const activeBadge = await browser.$(
    `[data-task-id="${story.taskId}"] [data-testid="agent-state-badge"][data-state="active"]`,
  );
  await activeBadge.waitForDisplayed({ timeout: 30_000 });
  const moduleTab = await browser.$('button[role="tab"][aria-label="Acceptance Module"]');
  const moduleActivity = await moduleTab.$('[aria-label="Agent is actively working"]');
  await moduleActivity.waitForDisplayed({ timeout: 30_000 });
  const terminalTab = await browser.$("aria/Ideas codex terminal");
  await terminalTab.waitForDisplayed({ timeout: 30_000 });
  await click(terminalTab);
  await (await terminalTab.$("aria/Agent is actively working"))
    .waitForDisplayed({ timeout: 30_000 });
  if (!process.argv.includes("--mcp-recovery")) {
    await assertNativeRendererOwnsTheRun(browser);
  }

  await verifyLiveMcpRecovery({
    installation,
    afterRestart: async (restarted) => {
      browser = restarted;
      await openExistingStory(browser, story.taskId);
    },
  });

  for (const state of ["Implement", "Review", "Done"]) {
    writeFileSync(path.join(root, `advance-${state}`), "");
    await waitForState(browser, state);
  }

  writeFileSync(path.join(root, "provider-exit"), "");
  await expectResumableRun(browser, "Ideas codex terminal");
  if (process.argv.includes("--mcp-recovery")) {
    const hooks = readFileSync(path.join(root, "provider-hooks.log"), "utf8");
    for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]) {
      if (!hooks.includes(event)) throw new Error(`Missing provider hook ${event}`);
    }
    for (const mode of ["orderly", "sigkill"]) {
      const evidence = JSON.parse(readFileSync(path.join(root, `recovery-${mode}.json`), "utf8"));
      console.log(`${mode} MCP recovery passed; outage error in ${evidence.outage_ms.toFixed(2)} ms`);
    }
    console.log("Ticketry desktop MCP recovery acceptance passed (Codex fixture).");
    return;
  }
  await browser.waitUntil(async () =>
    !(await (await browser.$('button[role="tab"][aria-label="Acceptance Module"] [aria-label="Agent is actively working"]')).isDisplayed().catch(() => false)), {
    timeout: 30_000,
    timeoutMsg: "the module lifecycle badge did not clear after completion",
  });

  if (!await (await browser.$('[data-testid="terminal-panel"]'))
    .isDisplayed().catch(() => false)) {
    await click(await browser.$("aria/Open terminal panel"));
  }
  await (await browser.$("aria/Shell 1")).waitForDisplayed({ timeout: 20_000 });
  await click(await browser.$("aria/Close shell 1"));
  await browser.waitUntil(async () =>
    !await (await browser.$("aria/Shell 1")).isDisplayed().catch(() => false), {
    timeout: 20_000,
    timeoutMsg: "the closed module shell tab remained visible",
  });
  // Closing the shell replaces the panel header. Resolve the minimize
  // control afterward so WebDriver cannot silently keep a stale element and
  // leave the panel persisted open for the restart check.
  await click(await browser.$("aria/Minimize terminal panel"));
  await (await browser.$("aria/Open terminal panel"))
    .waitForDisplayed({ timeout: 20_000 });
  // Panel visibility is intentionally debounced for local persistence. Let
  // that write settle before reloading or the new webview restores it open
  // and creates a fresh shell during the restart assertion.
  await new Promise((resolve) => setTimeout(resolve, 500));

  await browser.refresh();
  await openExistingStory(browser, story.taskId);
  await waitForState(browser, "Done");
  await expectResumableRun(browser, "Ideas codex terminal");
  await installation.waitForTmuxEmpty();

  await installation.stop();
  browser = await installation.restart({ sweepMillis: 1000, waitForMcp: false });
  await openExistingStory(browser, story.taskId);
  await waitForState(browser, "Done");
  await expectResumableRun(browser, "Ideas codex terminal");

  await installation.stop();
  const hookEvidence = readFileSync(path.join(root, "provider-hooks.log"), "utf8");
  for (const event of ["SessionStart", "UserPromptSubmit", "PostToolUse", "Stop"]) {
    if (!hookEvidence.includes(event)) {
      throw new Error(`the disposable provider did not report ${event} through the hook runner`);
    }
  }
  const mcpEvidence = readFileSync(path.join(root, "provider-mcp.log"), "utf8");
  if (!mcpEvidence.includes('"ok":true')) {
    throw new Error("the disposable provider did not report through Ticketry's rotated MCP endpoint");
  }
  const finalInventory = installation.tmuxInventory();
  if (!finalInventory.includes("<no private tmux sessions>")) {
    throw new Error(`private tmux sessions leaked after completion: ${finalInventory.trim()}`);
  }
  console.log("Ticketry desktop agent acceptance passed.");
}

requireTmux();
buildDesktopAcceptanceApplication();
await runDesktopInstallationScenario({
  providerScript,
  diagnostics: { label: "desktop-agent-acceptance", evidenceFiles: providerEvidence },
}, runItemJourney);
