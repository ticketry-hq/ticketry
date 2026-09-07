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
    return await (await browser.$('[data-testid="issue-name"]'))
      .isDisplayed()
      .catch(() => false);
  }, {
    interval: 250,
    timeout: 30_000,
    timeoutMsg: `Story ${taskId} did not open in the details surface`,
  });
}
