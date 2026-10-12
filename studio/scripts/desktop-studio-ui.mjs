/**
 * Driving Ticketry's visible Studio UI over an established desktop WebDriver
 * session.
 *
 * Extracted from the agent acceptance driver so more than one desktop
 * acceptance scenario can reach the same Stories surface without copying its
 * selectors. Session and process lifetime stay in
 * `desktop-webdriver-session.mjs`.
 */

export async function click(element) {
  await element.waitForDisplayed({ timeout: 20_000 });
  await element.click();
}

/** Creates a root Story through the visible idea capture and returns its persisted id. */
export async function captureIdea(browser, name) {
  const idea = await browser.$("aria/Capture an idea");
  await idea.waitForDisplayed({ timeout: 20_000 });
  await idea.setValue(name);
  await browser.keys("Enter");
  const selector =
    `//li[@role="treeitem"][.//*[@data-task-name="true" and normalize-space()="${name}"]]`;
  let taskId;
  await browser.waitUntil(async () => {
    const story = await browser.$(selector);
    if (!await story.isDisplayed().catch(() => false)) return false;
    const candidate = await story.getAttribute("data-task-id");
    if (!candidate || candidate.startsWith("optimistic:")) return false;
    taskId = candidate;
    return true;
  }, {
    interval: 100,
    timeout: 20_000,
    timeoutMsg: `the Story "${name}" did not receive its persisted identity`,
  });
  return taskId;
}

export async function openExistingStory(browser, taskId) {
  await browser.waitUntil(async () => {
    const story = await browser.$(`[data-task-id="${taskId}"]`);
    if (!await story.isDisplayed().catch(() => false)) return false;
    await story.click().catch(() => {});
    const issueName = await browser.$('[data-testid="issue-name"]');
    if (await issueName.isDisplayed().catch(() => false)) return true;
    // A restart restores the Story's last workspace tab, which can be its
    // terminal rather than Details.
    await (await browser.$('[role="tab"][aria-label="Details"]')).click().catch(() => {});
    return await issueName.waitForDisplayed({ timeout: 2_000 }).catch(() => false);
  }, {
    interval: 250,
    timeout: 30_000,
    timeoutMsg: `Story ${taskId} did not open in the details surface`,
  });
}

/** Requires a completed run in the current UI's collapsed dormant-tabs menu. */
export async function expectResumableRun(browser, label) {
  const menu = await browser.$('[data-testid="dormant-tabs-trigger"]');
  await click(menu);
  await (await browser.$(`aria/Resume ${label}`)).waitForDisplayed({ timeout: 30_000 });
  await click(menu);
}

/**
 * First-run onboarding choosing Codex, then a module created and its folder
 * trusted through the visible Module Manager, and the guided tour skipped.
 */
export async function onboardCodexWithModule(browser, { workspaceDirectory, moduleName = "Acceptance Module" }) {
  await onboardCodexAndCreateModule(browser, { workspaceDirectory, moduleName });
  await click(await browser.$('[data-testid="onboarding-skip-tour"]'));
}

/**
 * Ends the guided tour after its first-module step without expecting Story
 * capture: **Finish tour** when the tour ends there (a project with no Story
 * type), otherwise **Skip tour** from the Story step.
 */
export async function endGuidedTourAfterFirstModule(browser) {
  let control;
  await browser.waitUntil(async () => {
    for (const selector of ['[data-testid="onboarding-finish"]', '[data-testid="onboarding-skip-tour"]']) {
      const candidate = await browser.$(selector);
      if (await candidate.isDisplayed().catch(() => false)) {
        control = candidate;
        return true;
      }
    }
    return false;
  }, { timeout: 20_000, timeoutMsg: "the guided tour offered neither Finish tour nor Skip tour after the first module" });
  await control.click();
  await control.waitForDisplayed({ reverse: true, timeout: 20_000, timeoutMsg: "the guided tour did not close" });
}

/**
 * First-run onboarding choosing Codex, then a module created and its folder
 * trusted through the visible Module Manager. The guided tour stays open.
 */
export async function onboardCodexAndCreateModule(browser, { workspaceDirectory, moduleName = "Acceptance Module" }) {
  const welcome = await browser.$('[data-testid="onboarding-welcome"]');
  await welcome.waitForDisplayed({ timeout: 60_000 });

  await click(await browser.$("aria/I use codex"));
  await click(await browser.$("aria/Get started"));

  await click(await browser.$("aria/Open Module Manager"));
  await click(await browser.$("[data-module-manager-new]"));
  await click(await browser.$("aria/Next"));
  await click(await browser.$("aria/Got it"));
  await (await browser.$("aria/Module name")).setValue(moduleName);
  await (await browser.$("aria/Module folder")).setValue(workspaceDirectory);
  const createModule = await browser.$("aria/Create module");
  await createModule.waitForEnabled({ timeout: 20_000 });
  // Use the folder field's supported keyboard submission route.
  await browser.keys("Enter");
  await click(await browser.$("aria/Trust folder"));
}

/**
 * CODING-1486 — a packaged desktop build renders its terminals with embedded
 * native libghostty, with no build flag, URL parameter, or stored setting.
 *
 * This checks the running artifact rather than a source constant: the native
 * host must be mounted and no fallback notice may be showing. It also proves
 * the run's bytes are not crossing into the WebView: a native run mounts no
 * streamed viewer, so the compatibility renderer's xterm screen must not exist
 * alongside it.
 */
export async function assertNativeRendererOwnsTheRun(browser) {
  const nativeHost = await browser.$('[data-testid="native-terminal-host"]');
  await nativeHost.waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: "the packaged build did not mount the native libghostty host",
  });
  for (const [selector, complaint] of [
    ['[data-testid="native-terminal-fallback-notice"]', "the packaged build reported a native renderer failure"],
    ['[data-testid="terminal-host"]', "a streamed xterm viewer is attached alongside the native viewer"],
  ]) {
    if (await (await browser.$(selector)).isExisting().catch(() => false)) {
      throw new Error(complaint);
    }
  }
}
