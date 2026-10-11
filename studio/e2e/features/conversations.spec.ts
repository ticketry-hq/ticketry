import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { featureSuite } from "./featureSuite";
import { completedConversations, conversationRows, createConversationModule, fixtureConversation, observeConversationLaunch, releaseConversation, removeConversationModule } from "../conversation-support";

featureSuite("conversations", { isolation: "case" }, () => {
  let context: Awaited<ReturnType<typeof createConversationModule>>;
  test.beforeEach(async ({ request, page }) => {
    context = await createConversationModule(request);
    await page.goto("/");
    const tab = page.getByRole("tab", { name: context.module.name, exact: true });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("treeitem", { name: /^New conversation/ })).toBeVisible();
  });
  test.afterEach(async () => {
    if (context) await removeConversationModule(context.folder);
  });

  test("[web-scratch-01] starts a new conversation through the default launch policy", { tag: "@case-web-scratch-01" }, async ({ page, request }) => {
    test.setTimeout(60_000);
    const { runId, variables: launchVariables } = await observeConversationLaunch(page, () => page.getByRole("treeitem", { name: /^New conversation/ }).click());
    expect(launchVariables).toMatchObject({ kind: "instant" });
    expect(launchVariables).not.toHaveProperty("provider");
    expect(launchVariables).not.toHaveProperty("model");
    expect(launchVariables).not.toHaveProperty("reasoning");
    expect(launchVariables).not.toHaveProperty("prompt");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => conversationRows(request, context.project.id, context.module.id)).toEqual(expect.arrayContaining([expect.objectContaining({ agent_run_id: runId })]));
    await expect.poll(() => fixtureConversation(runId)).toMatchObject({ runId });
    await expect(page.getByTestId("terminal-host-wrapper")).toBeVisible();
    await page.reload();
    await expect(page.locator("[data-conversation-rename]")).toBeVisible();
    await releaseConversation(runId);
    await expect.poll(() => completedConversations(request, context.project.id, context.module.id), { timeout: 25_000 }).toEqual(expect.arrayContaining([expect.objectContaining({ agent_run_id: runId, ended_at: expect.any(String) })]));
    await page.reload();
    await expect(page.getByRole("button", { name: "1 ended today", exact: true })).toBeVisible();
  });

  test("starts a default conversation through the instant keyboard action", { tag: "@case-conversation-instant-keyboard" }, async ({ page, request }) => {
    await page.getByRole("button", { name: "Collapse Conversations", exact: true }).focus();
    const keyboard = await observeConversationLaunch(page, () => page.keyboard.press("Meta+i"));
    expect(keyboard.variables).toMatchObject({ kind: "instant" });
    expect(keyboard.variables).not.toHaveProperty("provider");
    expect(keyboard.variables).not.toHaveProperty("prompt");
    await expect.poll(() => conversationRows(request, context.project.id, context.module.id)).toEqual(expect.arrayContaining([expect.objectContaining({ agent_run_id: keyboard.runId })]));
    await releaseConversation(keyboard.runId);
  });

  test("keeps a cancelled composer draft and rejects an empty first message", { tag: "@case-conversation-composer-cancel" }, async ({ page, request }) => {
    expect(await conversationRows(request, context.project.id, context.module.id)).toEqual([]);
    await page.getByRole("button", { name: "Start a conversation with a prompt", exact: true }).click();
    const input = page.getByRole("textbox", { name: "First message for the new conversation" });
    await expect(input).toBeFocused();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
    await input.fill("   ");
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
    await input.fill("Retained draft");
    await input.press("Enter");
    await expect(input).toHaveValue("Retained draft\n");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    await page.keyboard.press("Meta+Shift+i");
    await expect(input).toHaveValue("Retained draft\n");
    expect(await conversationRows(request, context.project.id, context.module.id)).toEqual([]);
    await input.press("Escape");
  });

  test("submits a trimmed composer message with an explicit activated provider", { tag: "@case-conversation-composer-launch" }, async ({ page, request }) => {
    await page.keyboard.press("Meta+Shift+i");
    const input = page.getByRole("textbox", { name: "First message for the new conversation" });
    await input.fill("  Fixture conversation prompt  ");
    await page.getByRole("combobox", { name: "Agent for the new conversation" }).selectOption("codex");
    const { runId, variables } = await observeConversationLaunch(page, () => input.press("Control+Enter"));
    expect(variables).toMatchObject({ kind: "instant", prompt: "Fixture conversation prompt", provider: "codex" });
    await expect(input).toHaveCount(0);
    await expect.poll(() => conversationRows(request, context.project.id, context.module.id)).toEqual(expect.arrayContaining([expect.objectContaining({ agent_run_id: runId })]));
    await page.getByRole("button", { name: "Start a conversation with a prompt", exact: true }).click();
    await expect(input).toHaveValue("");
    await input.press("Escape");
    await releaseConversation(runId);
  });

  test("recovers a failed conversation launch without inventing a successful run", { tag: "@case-conversation-launch-recovery" }, async ({ page, request }) => {
    let refused = false;
    await page.route("**/graphql", async route => {
      if (!refused && route.request().postDataJSON()?.operationName === "CreateTerminalSession") {
        refused = true;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Fixture launch boundary unavailable" }] }) });
      } else await route.continue();
    });
    await page.getByRole("treeitem", { name: /^New conversation/ }).click();
    await expect(page.getByText("Conversation did not start", { exact: true })).toBeVisible();
    expect(await conversationRows(request, context.project.id, context.module.id)).toEqual([]);
    await page.getByRole("dialog", { name: "Conversation did not start" }).getByRole("button", { name: "Close", exact: true }).click();
    await page.unroute("**/graphql");
    await page.getByRole("button", { name: "Start a conversation with a prompt", exact: true }).click();
    const input = page.getByRole("textbox", { name: "First message for the new conversation" });
    await input.fill("Retry composer launch");
    refused = false;
    await page.route("**/graphql", async route => {
      if (!refused && route.request().postDataJSON()?.operationName === "CreateTerminalSession") {
        refused = true;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Fixture composer boundary unavailable" }] }) });
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Conversation did not start" })).toBeVisible();
    expect(await conversationRows(request, context.project.id, context.module.id)).toEqual([]);
    await page.getByRole("dialog", { name: "Conversation did not start" }).getByRole("button", { name: "Close", exact: true }).click();
    await page.unroute("**/graphql");
    await page.getByRole("button", { name: "Start a conversation with a prompt", exact: true }).click();
    await input.fill("Recovered composer launch");
    const { runId } = await observeConversationLaunch(page, () => page.getByRole("button", { name: "Start", exact: true }).click());
    await expect.poll(() => conversationRows(request, context.project.id, context.module.id)).toEqual(expect.arrayContaining([expect.objectContaining({ agent_run_id: runId })]));
    await releaseConversation(runId);
  });

  test("renames a concrete conversation with cancel, blank validation and failed-write retry", { tag: "@case-conversation-rename-recovery" }, async ({ page, request }) => {
    const { runId } = await observeConversationLaunch(page, () => page.getByRole("treeitem", { name: /^New conversation/ }).click());
    await expect.poll(() => fixtureConversation(runId)).toMatchObject({ runId });
    const rename = page.locator("[data-conversation-rename]");
    await expect(rename).toBeVisible();
    await expect(rename).toHaveText("Fixture conversation title");
    const original = await rename.innerText();
    await rename.click();
    const input = page.getByRole("textbox", { name: "Conversation title", exact: true });
    await input.fill("Cancelled rename");
    await input.press("Escape");
    await expect(rename).toHaveText(original);
    await rename.click();
    await input.fill("  ");
    await input.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("A conversation title is required.");
    let refused = false;
    await page.route("**/graphql", async route => {
      if (!refused && route.request().postDataJSON()?.operationName === "UpdateInstantConversationTitle") {
        refused = true;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Fixture rename boundary unavailable" }] }) });
      } else await route.continue();
    });
    await input.fill("  Saved conversation  ");
    await input.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Fixture rename boundary unavailable");
    await expect(input).toHaveValue("  Saved conversation  ");
    await page.unroute("**/graphql");
    await input.press("Enter");
    await expect(rename).toHaveText("Saved conversation");
    await expect.poll(() => conversationRows(request, context.project.id, context.module.id)).toEqual(expect.arrayContaining([expect.objectContaining({ agent_run_id: runId, user_title: "Saved conversation", title: "Saved conversation" })]));
    await page.reload();
    await expect(page.getByRole("treeitem", { name: /Saved conversation/ })).toBeVisible();
    await releaseConversation(runId);
  });
  test("refreshes provider titles and selects the terminal belonging to each conversation", { tag: "@case-conversation-title-terminal" }, async ({ page, request }) => {
    await writeFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, "title-control.json"), JSON.stringify({ title: null }));
    let titleRefused = false;
    await page.route("**/graphql", async route => {
      if (route.request().postDataJSON()?.operationName === "InstantRunTicketTitle") {
        titleRefused = true;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "Fixture title read unavailable" }] }) });
      } else await route.continue();
    });
    const first = await observeConversationLaunch(page, () => page.getByRole("treeitem", { name: /^New conversation/ }).click());
    await expect.poll(() => fixtureConversation(first.runId)).toMatchObject({ runId: first.runId });
    await expect.poll(() => titleRefused).toBe(true);
    const firstRow = page.locator(`[data-task-id="__instant_run__:${first.runId}"]`);
    await expect(firstRow).toContainText("Untitled instant chat");
    await page.unroute("**/graphql");
    await page.reload();
    await firstRow.click();
    await expect(firstRow).toContainText("Untitled instant chat");
    await writeFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, "title-control.json"), JSON.stringify({ title: "Fixture conversation title" }));
    const second = await observeConversationLaunch(page, () => page.getByRole("treeitem", { name: /^New conversation/ }).click());
    await expect(page.locator(`[data-terminal-run-id="${second.runId}"]`)).toBeVisible();
    await firstRow.click();
    await expect(firstRow).toHaveAttribute("aria-selected", "true");
    await expect(firstRow).toContainText("Fixture conversation title");
    await expect(page.locator(`[data-terminal-run-id="${first.runId}"]`)).toBeVisible();
    await expect(page.locator(`[data-terminal-run-id="${second.runId}"]`)).toBeHidden();
    await page.locator("[data-conversation-rename]").click();
    await page.getByRole("textbox", { name: "Conversation title", exact: true }).fill("Manual title wins");
    await page.getByRole("textbox", { name: "Conversation title", exact: true }).press("Enter");
    await expect(firstRow).toContainText("Manual title wins");
    await page.locator(`[data-task-id="__instant_run__:${second.runId}"]`).click();
    await firstRow.click();
    await expect(firstRow).toContainText("Manual title wins");
    await page.reload();
    await expect(firstRow).toContainText("Manual title wins");
    await firstRow.click();
    await expect(page.locator(`[data-terminal-run-id="${first.runId}"]`)).toBeVisible();
    await expect.poll(() => conversationRows(request, context.project.id, context.module.id)).toEqual(expect.arrayContaining([expect.objectContaining({ agent_run_id: first.runId, user_title: "Manual title wins" })]));
    await releaseConversation(first.runId);
    await releaseConversation(second.runId);
  });

});
