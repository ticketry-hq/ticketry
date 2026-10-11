import { expect, test } from "@playwright/test";
import { featureSuite } from "./featureSuite";
import {
  captureLegacyProductApiRequests,
  configureCodexDefault,
  getProviderCatalog,
  graphql,
} from "../support";
import { LoadInstantLaunchSettingDocument } from "../../src/features/settings/generated/instantLaunch.documents";
import {
  cleanupWorkItemsFixture,
  names,
  openFeatureModule as openModule,
  seedProject,
} from "../work-items-migration-support";
import { failGraphqlOperation } from "../graphql-failure-injection";
import { openSettings, readPersistedModelSettings } from "../settings-support";

const CHANGED_PROVIDER = "claude";
const CHANGED_MODEL = "opus";
const CHANGED_REASONING = "high";
const onOff = (active: boolean) => active ? "On" : "Off";

featureSuite("settings", { isolation: "case" }, () => {
  let legacyProductApiRequests: string[] = [];

  test.beforeAll(async ({ request }) => {
    await seedProject(request);
    await configureCodexDefault(request);
  });
  test.afterAll(cleanupWorkItemsFixture);

  test.beforeEach(async ({ page }) => {
    legacyProductApiRequests = captureLegacyProductApiRequests(page);
  });

  test.afterEach(async () => {
    expect(legacyProductApiRequests).toEqual([]);
  });

  test("persists a Models settings change into the state database", { tag: "@case-settings-models-database" }, async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Open Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Studio settings" });
    await expect(dialog.getByRole("region", { name: "Model configuration" }))
      .toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Agent/provider" }))
      .toHaveValue("codex");

    await dialog.getByRole("checkbox", { name: `Activate ${CHANGED_PROVIDER}` })
      .setChecked(true);
    // Choosing a provider clears the dependent model and reasoning fields, so the
    // three controls have to be set in that order.
    await dialog.getByRole("combobox", { name: "Agent/provider" })
      .selectOption(CHANGED_PROVIDER);
    // Model is now a catalog select rather than a free-text datalist input.
    await dialog.getByRole("combobox", { name: "Model" })
      .selectOption(CHANGED_MODEL);
    await dialog.getByRole("combobox", { name: "Reasoning" })
      .selectOption(CHANGED_REASONING);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("Model configuration saved.");

    const persisted = readPersistedModelSettings({
      provider: CHANGED_PROVIDER,
      model: CHANGED_MODEL,
      reasoning: CHANGED_REASONING,
    });
    expect(persisted.mismatches).toEqual([]);
    expect(persisted.global_default).toEqual({
      provider: CHANGED_PROVIDER,
      profile: null,
      model: CHANGED_MODEL,
      reasoning: CHANGED_REASONING,
    });

    // The stored row is what a fresh client reads back.
    await page.reload();
    await page.getByRole("button", { name: "Open Settings" }).click();
    await expect(dialog.getByRole("combobox", { name: "Agent/provider" }))
      .toHaveValue(CHANGED_PROVIDER);
    await expect(dialog.getByRole("combobox", { name: "Model" }))
      .toHaveValue(CHANGED_MODEL);
    await expect(dialog.getByRole("combobox", { name: "Reasoning" }))
      .toHaveValue(CHANGED_REASONING);
    await dialog.getByRole("button", { name: "Close dialog" }).click();
  });

  test("loads and edits every Settings section without stale endpoints", { tag: "@case-settings-every-section" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    let dialog = await openSettings(page);
    await expect(dialog.getByRole("heading", { name: "Models" })).toBeVisible();
    await expect(dialog.getByText("HTTP 404", { exact: false })).toHaveCount(0);
    await expect(dialog.getByRole("region", { name: "Model configuration" }))
      .toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "Activate codex" }))
      .toBeChecked();
    await expect(dialog.getByRole("combobox", { name: "Agent/provider" }))
      .toHaveValue("codex");
    // An input backed by a datalist exposes the ARIA combobox role.
    await expect(dialog.getByRole("combobox", { name: "Model" }))
      .toHaveValue("gpt-5.4");
    await expect(dialog.getByRole("combobox", { name: "Reasoning" }))
      .toHaveValue("medium");

    const claude = dialog.getByRole("checkbox", { name: "Activate claude" });
    const claudeWasActive = await claude.isChecked();
    await claude.setChecked(!claudeWasActive);
    await expect(dialog.getByText("1 unsaved change", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(claude).toBeChecked({ checked: claudeWasActive });
    await claude.setChecked(!claudeWasActive);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("Model configuration saved.");

    await dialog.getByRole("tab", { name: "Keyboard shortcuts" }).click();
    await expect(dialog.getByRole("heading", { name: "Keyboard shortcuts" }))
      .toBeVisible();
    await dialog.getByRole("button", { name: "Close dialog" }).click();

    dialog = await openSettings(page);
    await dialog.getByRole("tab", { name: "Models" }).click();
    await expect(dialog.getByRole("checkbox", { name: "Activate claude" }))
      .toBeChecked({ checked: !claudeWasActive });
    await dialog.getByRole("checkbox", { name: "Activate claude" })
      .setChecked(claudeWasActive);
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("Model configuration saved.");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
  });
  test("opens Settings from the footer and keymap, switches every section and closes by button, Escape and backdrop", { tag: "@case-settings-sections-entry-and-close" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    const opener = page.getByRole("button", { name: "Open Settings" });
    const dialog = page.getByRole("dialog", { name: "Studio settings" });
    const sections = dialog.getByRole("tablist", { name: "Settings sections" });
    const focusInside = () => dialog.evaluate((element) =>
      element.contains(document.activeElement));

    await opener.click();
    await expect(dialog).toBeVisible();
    await expect(sections.getByRole("tab", { name: "Models" }))
      .toHaveAttribute("aria-selected", "true");
    for (const section of ["Conversations", "Keyboard shortcuts", "App updates", "Models"]) {
      await sections.getByRole("tab", { name: section }).click();
      await expect(sections.getByRole("tab", { name: section }))
        .toHaveAttribute("aria-selected", "true");
      await expect(dialog.getByRole("heading", { name: section, exact: true }))
        .toBeVisible();
      if (section === "App updates") {
        await expect(dialog.getByText("Updates are managed by the desktop app."))
          .toBeVisible();
      }
    }
    // Tab focus stays inside the modal in both directions.
    expect(await focusInside()).toBe(true);
    for (const key of ["Shift+Tab", "Shift+Tab", "Tab", "Tab", "Tab"]) {
      await page.keyboard.press(key);
      expect(await focusInside()).toBe(true);
    }

    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    // The default `settings` binding is E outside an editable field.
    await page.keyboard.press("e");
    await expect(dialog).toBeVisible();
    await expect(sections.getByRole("tab", { name: "Models" }))
      .toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("e");
    await expect(page.getByRole("dialog", { name: "Studio settings" })).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    await opener.click();
    await sections.getByRole("tab", { name: "Keyboard shortcuts" }).click();
    // The backdrop is the overlay outside the centred card.
    await page.mouse.click(4, 4);
    await expect(dialog).toHaveCount(0);

    // The section choice is not remembered; Settings reopens on Models.
    await opener.click();
    await expect(sections.getByRole("tab", { name: "Models" }))
      .toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByRole("region", { name: "Model configuration" }))
      .toBeVisible();
  });

  test("refuses deactivating the launch default provider until the default is repointed", { tag: "@case-settings-default-provider-guard" }, async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    const dialog = await openSettings(page);
    const codex = dialog.getByRole("checkbox", { name: "Activate codex" });
    const claude = dialog.getByRole("checkbox", { name: "Activate claude" });
    const provider = dialog.getByRole("combobox", { name: "Agent/provider" });
    await expect(provider).toHaveValue("codex");

    await codex.click();
    await expect(dialog).toContainText(
      "Repoint the launch default before deactivating codex.",
    );
    await expect(codex).toBeChecked();
    await expect(dialog.getByText("No unsaved changes", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await claude.setChecked(true);
    await provider.selectOption("claude");
    await codex.setChecked(false);
    await expect(codex).not.toBeChecked();
    await expect(dialog).not.toContainText("Repoint the launch default");
    await expect(dialog.getByRole("button", { name: "Save changes" })).toBeEnabled();

    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(codex).toBeChecked();
    await expect(provider).toHaveValue("codex");
    await expect(dialog.getByText("No unsaved changes", { exact: true })).toBeVisible();

    const stored = await getProviderCatalog(request);
    expect(stored.global_default?.provider).toBe("codex");
    expect(stored.configurable_providers.find((row) => row.slug === "codex")?.activated)
      .toBe(true);
  });

  test("registers, selects and removes a Codex profile name and saves the default", { tag: "@case-settings-codex-profiles" }, async ({
    page,
    request,
  }) => {
    const profileName = "e2e-work";
    await openModule(page, names.module);
    let dialog = await openSettings(page);
    const removeButtons = () => dialog.getByRole("button", { name: /^Remove Codex profile / });
    const newProfile = dialog.getByRole("textbox", { name: "New Codex profile" });
    const add = dialog.getByRole("button", { name: "Add", exact: true });

    await expect(removeButtons()).toHaveCount(0);
    await expect(add).toBeDisabled();
    await newProfile.fill(profileName);
    await add.click();
    await newProfile.fill(` ${profileName} `);
    await add.click();
    await expect(removeButtons()).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: `Remove Codex profile ${profileName}` }))
      .toBeVisible();

    await dialog.getByRole("combobox", { name: "Codex profile" }).selectOption(profileName);
    await expect(dialog.getByRole("combobox", { name: "Model" })).toBeDisabled();
    await expect(dialog.getByRole("combobox", { name: "Reasoning" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("Model configuration saved.");
    let stored = await getProviderCatalog(request);
    expect(stored.codex_profiles).toEqual([profileName]);
    expect(stored.global_default).toMatchObject({ provider: "codex", profile: profileName });

    await page.reload();
    dialog = await openSettings(page);
    await expect(dialog.getByRole("combobox", { name: "Codex profile" })).toHaveValue(profileName);
    await expect(dialog.getByRole("combobox", { name: "Model" })).toBeDisabled();

    await dialog.getByRole("button", { name: `Remove Codex profile ${profileName}` }).click();
    await expect(removeButtons()).toHaveCount(0);
    await expect(dialog.getByRole("combobox", { name: "Codex profile" })).toHaveValue("");
    await expect(dialog.getByRole("combobox", { name: "Model" })).toBeEnabled();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("Model configuration saved.");
    stored = await getProviderCatalog(request);
    expect(stored.codex_profiles).toEqual([]);
    expect(stored.global_default?.profile ?? null).toBeNull();
  });

  test("records pending Models changes in the ledger and commits them after a failed save is retried", { tag: "@case-settings-change-ledger" }, async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    let dialog = await openSettings(page);
    const ledger = dialog.getByRole("log", { name: "Applied changes" });
    const entries = ledger.getByRole("listitem");
    await expect(ledger).toHaveText("No changes yet.");

    const gemini = dialog.getByRole("checkbox", { name: "Activate gemini" });
    const geminiWasActive = await gemini.isChecked();
    await gemini.setChecked(!geminiWasActive);
    const summary = `gemini activation changed from ${onOff(geminiWasActive)} to ${onOff(!geminiWasActive)}`;
    const entry = entries.filter({ hasText: summary });
    await expect(entry).toHaveAttribute("data-tone", "pending");
    await expect(entry.locator("time")).toHaveText("--:--");

    // Models stays mounted while hidden, so its draft survives rail navigation.
    await dialog.getByRole("tab", { name: "Conversations" }).click();
    await dialog.getByRole("tab", { name: "Models" }).click();
    await expect(gemini).toBeChecked({ checked: !geminiWasActive });
    await expect(dialog.getByText("1 unsaved change", { exact: true })).toBeVisible();
    await expect(entry).toHaveAttribute("data-tone", "pending");

    const release = await failGraphqlOperation(page, "UpdateProviderCatalog");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog.getByRole("button", { name: "Save changes" })).toBeEnabled();
    await expect(dialog).not.toContainText("Model configuration saved.");
    await expect(dialog.getByText("1 unsaved change", { exact: true })).toBeVisible();
    await expect(gemini).toBeChecked({ checked: !geminiWasActive });
    await expect(entry).toHaveAttribute("data-tone", "pending");
    expect((await getProviderCatalog(request)).configurable_providers
      .find((row) => row.slug === "gemini")?.activated).toBe(geminiWasActive);

    await release();
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(dialog).toContainText("Model configuration saved.");
    await expect(dialog.getByText("No unsaved changes", { exact: true })).toBeVisible();
    await expect(entry).toHaveAttribute("data-tone", "applied");
    await expect(entry.locator("time")).toHaveText(/^\d{2}:\d{2}$/);

    // Only the three newest entries are shown.
    const claude = dialog.getByRole("checkbox", { name: "Activate claude" });
    await claude.setChecked(!(await claude.isChecked()));
    for (const profile of ["e2e-ledger-a", "e2e-ledger-b"]) {
      await dialog.getByRole("textbox", { name: "New Codex profile" }).fill(profile);
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
    }
    await expect(ledger.locator('li[data-tone="pending"]')).toHaveCount(3);
    await expect(entries).toHaveCount(3);
    await expect(entry).toHaveCount(0);

    // Discard drops pending entries and leaves the applied one.
    await dialog.getByRole("button", { name: "Discard" }).click();
    await expect(entries).toHaveCount(1);
    await expect(entry).toHaveAttribute("data-tone", "applied");

    // The narrow modal layout hides the ledger.
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(ledger).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(ledger).toBeVisible();

    // The ledger is modal-local: a remount starts empty while the save persists.
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    dialog = await openSettings(page);
    await expect(dialog.getByRole("log", { name: "Applied changes" }))
      .toHaveText("No changes yet.");
    await page.reload();
    dialog = await openSettings(page);
    await expect(dialog.getByRole("checkbox", { name: "Activate gemini" }))
      .toBeChecked({ checked: !geminiWasActive });
    await expect(dialog.getByRole("log", { name: "Applied changes" }))
      .toHaveText("No changes yet.");
    expect((await getProviderCatalog(request)).configurable_providers
      .find((row) => row.slug === "gemini")?.activated).toBe(!geminiWasActive);
  });

  test("saves, discards, clears and reloads the conversation starter prompt", { tag: "@case-settings-conversation-prompt" }, async ({
    page,
    request,
  }) => {
    const savedPrompt = "Keep changes limited to the selected module.";
    const storedPrompt = async () => {
      const value = (await graphql(request, LoadInstantLaunchSettingDocument, {}))
        .instant_launch_setting?.value as { initial_prompt?: string } | null;
      return value?.initial_prompt ?? "";
    };
    const openConversations = async () => {
      const dialog = await openSettings(page);
      await dialog.getByRole("tab", { name: "Conversations" }).click();
      const prompt = dialog.getByRole("textbox", { name: "Conversation starter prompt" });
      await expect(prompt).toBeEnabled();
      return { dialog, prompt };
    };

    await openModule(page, names.module);
    let { dialog, prompt } = await openConversations();
    const save = dialog.getByRole("button", { name: "Save conversation settings" });
    const discard = dialog.getByRole("button", { name: "Discard" });
    await expect(prompt).toHaveValue("");
    await expect(dialog.getByText("0 / 8,000", { exact: true })).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(discard).toBeDisabled();

    await prompt.fill("A draft to throw away");
    await discard.click();
    await expect(prompt).toHaveValue("");
    await expect(save).toBeDisabled();

    await prompt.fill(savedPrompt);
    await save.click();
    await expect(dialog).toContainText("Conversation settings saved.");
    await expect(save).toBeDisabled();
    await expect.poll(storedPrompt).toBe(savedPrompt);

    // The prompt is capped at 8,000 characters.
    await prompt.fill("x".repeat(8_001));
    await expect(dialog.getByText("8,000 / 8,000", { exact: true })).toBeVisible();
    expect((await prompt.inputValue()).length).toBe(8_000);

    // Closing is not a save: the unsaved draft is dropped.
    await prompt.fill("An unsaved draft");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    ({ dialog, prompt } = await openConversations());
    await expect(prompt).toHaveValue(savedPrompt);
    expect(await storedPrompt()).toBe(savedPrompt);

    await page.reload();
    ({ dialog, prompt } = await openConversations());
    await expect(prompt).toHaveValue(savedPrompt);

    await prompt.fill("");
    await dialog.getByRole("button", { name: "Save conversation settings" }).click();
    await expect(dialog).toContainText("Conversation settings saved.");
    await expect.poll(storedPrompt).toBe("");
    await page.reload();
    ({ dialog, prompt } = await openConversations());
    await expect(prompt).toHaveValue("");
  });

  test("reports a failed conversation settings read and keeps a failed save for retry", { tag: "@case-settings-conversation-failures" }, async ({
    page,
    request,
  }) => {
    const retried = "Prompt saved on the second attempt.";
    await openModule(page, names.module);
    const releaseRead = await failGraphqlOperation(page, "LoadInstantLaunchSetting");
    const dialog = await openSettings(page);
    await dialog.getByRole("tab", { name: "Conversations" }).click();
    await expect(dialog).toContainText("Conversation settings could not be loaded.");

    await releaseRead();
    // The panel mounts per visit, so returning to it reads again.
    await dialog.getByRole("tab", { name: "Models" }).click();
    await dialog.getByRole("tab", { name: "Conversations" }).click();
    const prompt = dialog.getByRole("textbox", { name: "Conversation starter prompt" });
    await expect(prompt).toBeEnabled();
    await expect(dialog).not.toContainText("could not be loaded");

    await prompt.fill(retried);
    const releaseSave = await failGraphqlOperation(page, "UpdateInstantLaunchSetting");
    const save = dialog.getByRole("button", { name: "Save conversation settings" });
    await save.click();
    await expect(dialog).toContainText("Conversation settings could not be saved.");
    await expect(prompt).toHaveValue(retried);
    await expect(save).toBeEnabled();

    await releaseSave();
    await save.click();
    await expect(dialog).toContainText("Conversation settings saved.");
    const stored = (await graphql(request, LoadInstantLaunchSettingDocument, {}))
      .instant_launch_setting?.value as { initial_prompt?: string } | null;
    expect(stored?.initial_prompt).toBe(retried);
  });

  test("edits the starter prompt from the Conversations section header", { tag: "@case-settings-conversation-header-entry" }, async ({
    page,
  }) => {
    const headerPrompt = "Prompt written from the Conversations header.";
    await openModule(page, names.module);
    await page.getByRole("button", { name: "Configure Conversations", exact: true }).click();
    const panel = page.getByRole("region", { name: "Conversation configuration" });
    await expect(panel).toBeVisible();
    const prompt = panel.getByRole("textbox", { name: "Conversation starter prompt" });
    await expect(prompt).toBeFocused();
    await prompt.fill(headerPrompt);
    await panel.getByRole("button", { name: "Save conversation settings" }).click();
    await expect(panel).toContainText("Conversation settings saved.");
    await panel.getByRole("button", { name: "Close Conversation configuration" }).click();
    await expect(panel).toHaveCount(0);

    // The same setting backs the Settings rail, and it is not a Models change.
    const dialog = await openSettings(page);
    await expect(dialog.getByRole("log", { name: "Applied changes" }))
      .toHaveText("No changes yet.");
    await dialog.getByRole("tab", { name: "Conversations" }).click();
    await expect(dialog.getByRole("textbox", { name: "Conversation starter prompt" }))
      .toHaveValue(headerPrompt);
  });
});
