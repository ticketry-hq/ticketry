import { assertNativeRendererOwnsTheRun, click, openExistingStory } from "../desktop-studio-ui.mjs";

/**
 * The visible subtree-run controls in a branch item's Details region, driven
 * over the desktop WebDriver session. The press under test always goes
 * through these controls.
 */
const DETAILS = '//section[@role="region" and @aria-label="Details"]';
const detailsButton = (name) => `${DETAILS}//button[@aria-label="${name}"]`;
const OPEN_SUBTREE_RUN = detailsButton("Open subtree run");

// textContent, not getText: the name stays readable while Details is hidden.
async function openWorkItemName(browser) {
  return await (await browser.$('[data-testid="issue-name"]')).getProperty("textContent").catch(() => "") ?? "";
}

export async function pressRunSubtreeSerially(browser) {
  await pressSubtreeControl(browser, { name: "Run subtree serially", started: "Serial subtree run started." });
}

/** Core's parallel press: every eligible direct child at once. */
export async function pressRunSubtree(browser) {
  await pressSubtreeControl(browser, { name: "Run subtree", started: "Subtree run started." });
}

async function pressSubtreeControl(browser, { name, started }) {
  const control = await browser.$(detailsButton(name));
  await control.waitForEnabled({ timeout: 20_000, timeoutMsg: `${name} is not enabled on the campaign root` });
  await recordRenderedToasts(browser);
  await click(control);
  // Toasts last four seconds and a press that launches several children keeps
  // the app busy, so read the toasts the page recorded as they rendered.
  let seen = [];
  await browser.waitUntil(async () => {
    seen = await browser.execute(() => window.__subtreeAcceptanceToasts ?? []);
    return seen.some((text) => text.includes("ubtree"));
  }, { timeout: 30_000, interval: 250, timeoutMsg: `no subtree run toast appeared after pressing ${name}` })
    .catch((error) => { throw new Error(`${error.message}; toasts seen: ${JSON.stringify(seen)}`); });
  // A prefix match: "Subtree run started." must not match "Serial subtree run started.".
  const text = seen.find((candidate) => candidate.includes("ubtree"));
  if (!text.startsWith(started)) throw new Error(`${name} did not start the campaign: ${text}`);
}

/** Records the text of every toast the page renders from now on. */
async function recordRenderedToasts(browser) {
  await browser.execute(() => {
    window.__subtreeAcceptanceToastObserver?.disconnect();
    window.__subtreeAcceptanceToasts = [];
    const host = document.querySelector('[data-testid="toast-host"]') ?? document.body;
    const record = (node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const toasts = node.matches('[data-testid^="toast-"]:not([data-testid="toast-host"])')
        ? [node]
        : [...node.querySelectorAll('[data-testid^="toast-"]:not([data-testid="toast-host"])')];
      for (const toast of toasts) window.__subtreeAcceptanceToasts.push(toast.textContent.trim());
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) mutation.addedNodes.forEach(record);
    });
    observer.observe(host, { childList: true, subtree: true });
    window.__subtreeAcceptanceToastObserver = observer;
  });
}

/** The active-campaign affordance: **Open subtree run** beside a lifecycle badge. */
export async function waitForOpenSubtreeRun(browser) {
  await (await browser.$(OPEN_SUBTREE_RUN)).waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: "Open subtree run did not appear while a child was live",
  });
  const badge = await browser.$(`${OPEN_SUBTREE_RUN}/preceding-sibling::span[@aria-label]`);
  await badge.waitForDisplayed({ timeout: 30_000, timeoutMsg: "Open subtree run has no lifecycle badge" });
  return await badge.getAttribute("aria-label");
}

/**
 * Presses **Open subtree run** and requires the live child's terminal to be
 * the focused workspace, drawn by the native libghostty host.
 */
export async function focusSubtreeRunTerminal(browser, child) {
  await click(await browser.$(OPEN_SUBTREE_RUN));
  await browser.waitUntil(async () =>
    (await openWorkItemName(browser)).includes(child.name), {
    timeout: 30_000,
    timeoutMsg: `Open subtree run did not focus ${child.name}`,
  });
  const terminalTab = await browser.$(`//*[@role="tab" and contains(@aria-label,"codex terminal") and @aria-selected="true"]`);
  await terminalTab.waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: `Open subtree run did not select ${child.name}'s agent terminal`,
  });
  await assertNativeRendererOwnsTheRun(browser);
}

/**
 * Restored controls: no campaign affordance and the edition's presses offered
 * again (serial everywhere, plus parallel **Run subtree** in core).
 */
export async function waitForRestoredControls(browser, { controls = ["Run subtree serially"] } = {}) {
  const offered = async (name) => await (await browser.$(detailsButton(name))).isDisplayed().catch(() => false);
  await browser.waitUntil(async () =>
    !await (await browser.$(OPEN_SUBTREE_RUN)).isDisplayed().catch(() => false)
      && (await Promise.all(controls.map(offered))).every(Boolean), {
    timeout: 30_000,
    timeoutMsg: `the subtree controls (${controls.join(", ")}) were not restored after the campaign`,
  });
}

/** The Pocock edition offers no parallel **Run subtree** in Details. */
export async function assertParallelControlAbsent(browser) {
  await (await browser.$(detailsButton("Run subtree serially"))).waitForDisplayed({ timeout: 20_000 });
  if (await (await browser.$(detailsButton("Run subtree"))).isExisting()) {
    throw new Error("the parallel Run subtree control is present in the Pocock Details region");
  }
}

/** Opens a child from the root's Details and requires its visible state. */
export async function expectVisibleChildState(browser, { root, child, state }) {
  await openExistingStory(browser, root.id);
  await click(await browser.$(`//*[@data-testid="child-issues"]//button[.//span[normalize-space()="${child.name}"]]`));
  await browser.waitUntil(async () =>
    (await openWorkItemName(browser)).includes(child.name), {
    timeout: 20_000,
    timeoutMsg: `${child.name} did not open from the campaign root`,
  });
  const picker = await browser.$(`${DETAILS}//*[@data-testid="state-picker"]`);
  await picker.waitUntil(async () => (await picker.getText()).includes(state), {
    timeout: 30_000,
    timeoutMsg: `${child.name} did not visibly show ${state}`,
  });
  await openExistingStory(browser, root.id);
}
