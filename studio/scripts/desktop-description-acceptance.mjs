/**
 * CODING-1528 — proving Story description editing inside the real macOS
 * WKWebView.
 *
 * The browser suite covers Save and Cancel in Chromium. WebKit is where the
 * rich editor's own selection and focus behaviour differs, so this scenario
 * types through the editor's real input path (key events into the
 * contenteditable, not a scripted value), saves, switches Stories, reloads the
 * webview, and requires both Stories to show their authoritative descriptions
 * — the text the server returned, not a surviving local draft.
 *
 * Runs inside the existing desktop acceptance session; it owns no process.
 */
import { captureIdea, click, openExistingStory } from "./desktop-studio-ui.mjs";

const EDITED = "WKWebView keeps this saved description authoritative.";
const UNTOUCHED = "This second Story description must stay its own.";

async function openEditor(browser) {
  await click(await browser.$('[data-testid="issue-description"]'));
  const editor = await browser.$('[data-testid="description-editor"]');
  await editor.waitForDisplayed({ timeout: 20_000 });
  const surface = await browser.$(
    '[data-testid="rich-markdown-editor-shell"] [contenteditable="true"]',
  );
  await surface.waitForDisplayed({
    timeout: 30_000,
    timeoutMsg: "the rich Markdown editor did not mount in WKWebView",
  });
  return surface;
}

/** Types `text` through real key events and clicks the editor's own Save. */
async function typeAndSave(browser, text) {
  const surface = await openEditor(browser);
  const existing = (await surface.getText()).trim();
  if (existing !== "") {
    throw new Error(`the editor opened holding foreign text: ${existing}`);
  }
  await surface.click();
  await browser.keys(text);
  if (!(await surface.getText()).includes(text)) {
    throw new Error("the rich editor did not receive typed keystrokes in WKWebView");
  }
  await click(await (await browser.$('[data-testid="description-editor"]')).$("aria/Save"));
}

async function expectDescription(browser, taskId, expected, forbidden) {
  await openExistingStory(browser, taskId);
  const description = await browser.$('[data-testid="issue-description"]');
  await description.waitUntil(async () => (await description.getText()).includes(expected), {
    interval: 200,
    timeout: 30_000,
    timeoutMsg: `Story ${taskId} did not show its authoritative description "${expected}"`,
  });
  if ((await description.getText()).includes(forbidden)) {
    throw new Error(`Story ${taskId} showed the other Story's description`);
  }
}

/**
 * Requires an onboarded session already showing the Stories pane of a module,
 * and an existing Story to edit. Leaves a second Story behind in Ideas.
 */
export async function proveDescriptionSaveAndStorySwitch(browser, editedTaskId) {
  const otherTaskId = await captureIdea(browser, "Description switch companion");

  await openExistingStory(browser, editedTaskId);
  await typeAndSave(browser, EDITED);
  await expectDescription(browser, editedTaskId, EDITED, UNTOUCHED);

  // Switching Stories tears the editor down; the next one must start from the
  // newly selected Story's saved description rather than the previous draft.
  await openExistingStory(browser, otherTaskId);
  await typeAndSave(browser, UNTOUCHED);
  await expectDescription(browser, otherTaskId, UNTOUCHED, EDITED);

  await browser.refresh();
  await expectDescription(browser, editedTaskId, EDITED, UNTOUCHED);
  await expectDescription(browser, otherTaskId, UNTOUCHED, EDITED);
}
