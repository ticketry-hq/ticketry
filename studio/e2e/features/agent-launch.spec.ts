import { readFile, writeFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Locator } from "@playwright/test";
import { featureSuite } from "./featureSuite";
import { names, fixture, seedProject, cleanupWorkItemsFixture, openFeatureModule as openModule } from "../work-items-migration-support";
import { configureCodexDefault, CODEX_TEST_MODEL, CODEX_TEST_REASONING, graphql, openWorkItem, selectModuleForProfile, createWorkItem, getWorkItem, getProviderCatalog, getWorkflowCatalog } from "../support";
import { CreateWorkTrackerTransitionDocument, UpdateWorkTrackerTransitionDocument } from "../../src/features/workflows/generated/workflows.documents";
import { WorktreeStatusDocument } from "../../src/features/agents/worktrees/generated/worktreeStatus.documents";
import { UpdateProviderCatalogDocument } from "../../src/features/settings/generated/providerCatalog.documents";
import { ScratchTerminalSessionsDocument, TaskTerminalSessionsDocument } from "../../src/features/agents/terminal/generated/terminalSessions.documents";

import { openSettings, clearModuleLinkEventually, prepareLaunch, observeLaunch, completeFixture, assertTaskLaunch, configureStageSkill, stageSkillReport, installStageSkill, stageSkillTrees, fixtureLaunchEvidence } from "../agent-launch-support";

featureSuite("agent-launch", { isolation: "case" }, () => {
  test.beforeEach(() => { test.setTimeout(60_000); });
  test.beforeAll(async ({ request }) => {
    await seedProject(request); await configureCodexDefault(request);
    await writeFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR!, "agent-control.json"), JSON.stringify({ mode: "success" }));
  });
  test.afterAll(async () => { await cleanupWorkItemsFixture(); });
  test("opens and cancels keyboard launch dialogs without starting a run", { tag: "@case-launch-dialog-cancel" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);
    const workspaceTabs = page.getByRole("tablist", { name: "Workspace tabs" });
    const initialTabCount = await workspaceTabs.getByRole("tab").count();
    const focusCommandLayer = () =>
      page.getByRole("button", { name: "Open Settings" }).focus();

    await focusCommandLayer();
    await page.keyboard.press("o");
    let picker = page.getByRole("dialog", { name: "Select Agent" });
    await expect(picker).toContainText("codex");
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    const openPromptAndCancelProvider = async (
      chord: "Shift+Enter" | "n",
      promptText: string,
    ): Promise<void> => {
      await focusCommandLayer();
      await page.keyboard.press(chord);
      const prompt = page.getByRole("dialog", { name: "Prompt" });
      await expect(prompt).toBeVisible();
      const input = prompt.getByPlaceholder(
        "Type a prompt. Enter inserts a newline; Ctrl/Cmd+Enter submits.",
      );
      await expect(input).toBeFocused();
      await input.fill(promptText);
      await prompt.getByRole("button", { name: "Submit" }).click();
      await expect(prompt).toHaveCount(0);
      picker = page.getByRole("dialog", { name: "Select Agent" });
      await expect(picker).toContainText("codex");
      await page.keyboard.press("Escape");
      await expect(picker).toHaveCount(0);
    };

    await openPromptAndCancelProvider(
      "Shift+Enter",
      "Task-scoped prompt that must not launch.",
    );
    await openPromptAndCancelProvider("n", "Planning prompt that must not launch.");
    await expect(page.getByTestId("issue-name")).toContainText(names.blocker);
    await expect(workspaceTabs.getByRole("tab")).toHaveCount(initialTabCount);
  });

  test("opens the shared provider picker from the workspace launcher", { tag: "@case-launch-provider-picker" }, async ({
    page,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);

    await page.getByRole("button", { name: "＋ Agent" }).click();
    let picker = page.getByRole("dialog", { name: "Select Agent" });
    await expect(picker).toBeVisible();
    await expect(picker.getByText("codex", { exact: true })).toBeVisible();
    await expect(page.getByRole("menu", { name: "Launch agent" }))
      .toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    await page.getByRole("button", { name: "Open Settings" }).focus();
    // The explicit choose-agent command owns this picker; normal-run uses backend defaults.
    await page.keyboard.press("o");
    picker = page.getByRole("dialog", { name: "Select Agent" });
    await expect(picker).toBeVisible();
    await expect(picker.getByText("codex", { exact: true })).toBeVisible();
  });

  test("updates the live Agent Picker when Rust provider activation changes", { tag: "@case-launch-live-provider-activation" }, async ({
    page,
    request,
  }) => {
    await configureCodexDefault(request);
    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);

    const setClaudeActivation = async (active: boolean): Promise<void> => {
      const settings = await openSettings(page);
      await settings.getByRole("combobox", { name: "Agent/provider" })
        .selectOption("codex");
      await settings.getByRole("combobox", { name: "Model" })
        .selectOption(CODEX_TEST_MODEL);
      await settings.getByRole("combobox", { name: "Reasoning" })
        .selectOption(CODEX_TEST_REASONING);
      const claude = settings.getByRole("checkbox", { name: "Activate claude" });
      await claude.setChecked(active);
      await settings.getByRole("button", { name: "Save changes" }).click();
      await expect(settings).toContainText("Model configuration saved.");
      await settings.getByRole("button", { name: "Close dialog" }).click();
    };
    const openAgentPicker = async (): Promise<Locator> => {
      await page.getByRole("button", { name: "Open Settings" }).focus();
      await page.keyboard.press("o");
      const picker = page.getByRole("dialog", { name: "Select Agent" });
      await expect(picker).toBeVisible();
      await expect(picker.getByText("codex", { exact: true })).toBeVisible();
      return picker;
    };

    let settings = await openSettings(page);
    const original = await settings.getByRole("checkbox", {
      name: "Activate claude",
    }).isChecked();
    await settings.getByRole("button", { name: "Close dialog" }).click();

    await setClaudeActivation(!original);
    let picker = await openAgentPicker();
    await expect(picker.getByText("claude", { exact: true })).toHaveCount(
      original ? 0 : 1,
    );
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    await setClaudeActivation(original);
    picker = await openAgentPicker();
    await expect(picker.getByText("claude", { exact: true })).toHaveCount(
      original ? 1 : 0,
    );
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);

    await page.reload();
    settings = await openSettings(page);
    await expect(settings.getByRole("checkbox", { name: "Activate claude" }))
      .toBeChecked({ checked: original });
    await settings.getByRole("button", { name: "Close dialog" }).click();
  });

  test("refuses Run now before moving state when its module link is unavailable", { tag: "@case-launch-run-now-folder-refusal" }, async ({
    page,
    request,
  }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.runNow);
    const runNow = page.getByRole("button", { name: "Run now" });
    await expect(runNow).toBeVisible();
    await expect(page.getByTestId("status-row")).toContainText("Ideas");

    await clearModuleLinkEventually(request, fixture.module.id);

    try {
      const refused = page.waitForResponse((response) =>
        response.url().endsWith("/graphql") &&
        response.request().postDataJSON()?.operationName ===
          "RunWorkTrackerWorkItemNow"
      );
      await runNow.click();
      await refused;
      const alert = page.getByRole("alert").filter({
        hasText: "Run now could not be started",
      });
      await expect(alert).toContainText(/no local folder is linked/i);
      await expect(alert).toContainText(/existing writable module folder/i);
      await expect(page.getByTestId("status-row")).toContainText("Ideas");
      await expect(runNow).toBeEnabled();
    } finally {
      await selectModuleForProfile(
        request,
        fixture.project.id,
        fixture.module.id,
        fixture.folder,
      );
    }

    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Ideas");
    await expect(page.getByRole("button", { name: "Run now" })).toBeVisible();
  });

  test("surfaces and dismisses an agent-launch failure without leaving the workspace", { tag: "@case-launch-failure-dismissal" }, async ({
    page,
  }) => {
    await page.route("**/graphql", async (route) => {
      const body = route.request().postDataJSON();
      if (body?.operationName !== "CreateTerminalSession") {
        await route.continue();
        return;
      }
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          errors: [{ message: "forced browser launch failure" }],
        }),
      });
    });
    await openModule(page, names.module);
    await page.getByRole("treeitem", { name: new RegExp(fixture.parent.key) })
      .click();

    await page.getByRole("button", { name: "Run item" }).click();
    const alert = page.getByRole("alert").filter({
      hasText: "Agent run could not be started",
    });
    await expect(alert).toContainText("Agent run could not be started");
    await alert.getByRole("button", { name: "Dismiss" }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByTestId("issue-name"))
      .toContainText(/Complete parent(?: renamed)?/);
    await page.unroute("**/graphql");
  });


  test("launches Run item with backend policy and restores the persisted run", { tag: "@case-launch-run-item-success" }, async ({ page, request }) => {
    const item = await prepareLaunch(page, request, "Run item");
    const response = observeLaunch(page);
    await page.getByRole("button", { name: "Run item", exact: true }).click();
    const launched = await response;
    const variables = launched.request().postDataJSON().variables;
    expect(variables.kind).toBe("task");
    expect(variables).not.toHaveProperty("provider");
    expect(variables).not.toHaveProperty("prompt");
    expect((await launched.json()).errors).toBeUndefined();
    await assertTaskLaunch(page, request, item.id);
    const keyboardItem = await prepareLaunch(page, request, "normal command");
    const keyboardResponse = observeLaunch(page);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Meta+Enter");
    expect((await (await keyboardResponse).json()).errors).toBeUndefined();
    await assertTaskLaunch(page, request, keyboardItem.id);
  });
  test("launches an eligible Story through Run now without changing its identity", { tag: "@case-launch-run-now-success" }, async ({ page, request }) => {
    const item = await prepareLaunch(page, request, "Run now");
    const response = observeLaunch(page, "RunWorkTrackerWorkItemNow");
    await page.getByRole("button", { name: "Run now", exact: true }).click();
    expect((await (await response).json()).errors).toBeUndefined();
    await expect(page.getByTestId("status-row")).toContainText("Implement");
    expect((await getWorkItem(request, item.id)).id).toBe(item.id);
    await assertTaskLaunch(page, request, item.id);
    const keyboardItem = await prepareLaunch(page, request, "Run now keyboard");
    const keyboardResponse = observeLaunch(page, "RunWorkTrackerWorkItemNow");
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("r");
    expect((await (await keyboardResponse).json()).errors).toBeUndefined();
    await assertTaskLaunch(page, request, keyboardItem.id);
  });
  test("chooses an activated provider from the task Agent Picker", { tag: "@case-launch-picker-success" }, async ({ page, request }) => {
    const item = await prepareLaunch(page, request, "picker");
    await page.getByRole("button", { name: "＋ Agent" }).click();
    const response = observeLaunch(page);
    await page.getByRole("dialog", { name: "Select Agent" }).getByText("codex", { exact: true }).click();
    expect((await (await response).json()).errors).toBeUndefined();
    await assertTaskLaunch(page, request, item.id);
  });
  test("submits a multiline task prompt through the keyboard provider picker", { tag: "@case-launch-prompt-success" }, async ({ page, request }) => {
    const item = await prepareLaunch(page, request, "prompt");
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Shift+Enter");
    const dialog = page.getByRole("dialog", { name: "Prompt" });
    await dialog.getByRole("textbox").fill("First line\nSecond line");
    await dialog.getByRole("textbox").press("Control+Enter");
    const response = observeLaunch(page);
    await page.getByRole("dialog", { name: "Select Agent" }).getByText("codex", { exact: true }).click();
    const launched = await response;
    expect(launched.request().postDataJSON().variables.prompt).toBe("First line\nSecond line");
    expect((await launched.json()).errors).toBeUndefined();
    await assertTaskLaunch(page, request, item.id);
    const commandItem = await prepareLaunch(page, request, "prompt command");
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Meta+Shift+Enter");
    const commandPrompt = page.getByRole("dialog", { name: "Prompt" });
    await commandPrompt.getByRole("textbox").fill("Command prompt");
    await commandPrompt.getByRole("button", { name: "Submit" }).click();
    const commandResponse = observeLaunch(page);
    await page.getByRole("dialog", { name: "Select Agent" }).getByText("codex", { exact: true }).click();
    expect((await (await commandResponse).json()).errors).toBeUndefined();
    await assertTaskLaunch(page, request, commandItem.id);
  });
  test("starts an instant conversation through its default launch policy", { tag: "@case-launch-instant-success" }, async ({ page, request }) => {
    await openModule(page, names.module);
    const response = observeLaunch(page);
    await page.getByRole("treeitem", { name: /^New conversation/ }).click();
    const launched = await response;
    expect(launched.request().postDataJSON().variables.kind).toBe("instant");
    const envelope = await launched.json();
    expect(envelope.errors).toBeUndefined();
    await completeFixture(envelope.data.terminal_session.agent_run_id);
    await expect.poll(async () => (await graphql(request, ScratchTerminalSessionsDocument, { projectId: fixture.project.id, moduleId: fixture.module.id, limit: 25 })).terminal_sessions.sessions.length).toBeGreaterThan(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Rename conversation: Fixture conversation title" })).toBeVisible();
    expect((await graphql(request, ScratchTerminalSessionsDocument, { projectId: fixture.project.id, moduleId: fixture.module.id, limit: 25 })).terminal_sessions.sessions.map(row => row.agent_run_id)).toContain(envelope.data.terminal_session.agent_run_id);
    for (const chord of ["Meta+i", "i"]) {
      await page.getByRole("button", { name: "Open Settings" }).focus();
      const keyboardResponse = observeLaunch(page);
      await page.keyboard.press(chord);
      const keyboardEnvelope = await (await keyboardResponse).json();
      expect(keyboardEnvelope.errors).toBeUndefined();
      await completeFixture(keyboardEnvelope.data.terminal_session.agent_run_id);
    }
  });
  test("starts an instant conversation with a trimmed first message", { tag: "@case-launch-instant-prompt-success" }, async ({ page, request }) => {
    await openModule(page, names.module);
    await page.getByRole("button", { name: "Start a conversation with a prompt" }).click();
    await page.getByRole("textbox", { name: "First message for the new conversation" }).fill("  Fixture conversation  ");
    const response = observeLaunch(page);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const launched = await response;
    expect(launched.request().postDataJSON().variables.prompt).toBe("Fixture conversation");
    const envelope = await launched.json();
    expect(envelope.errors).toBeUndefined();
    await completeFixture(envelope.data.terminal_session.agent_run_id);
    await expect.poll(async () => (await graphql(request, ScratchTerminalSessionsDocument, { projectId: fixture.project.id, moduleId: fixture.module.id, limit: 25 })).terminal_sessions.sessions.length).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Meta+Shift+i");
    const keyboardMessage = page.getByRole("textbox", { name: "First message for the new conversation" });
    await keyboardMessage.fill("Keyboard fixture conversation");
    await page.getByRole("combobox", { name: "Agent for the new conversation" }).selectOption("codex");
    const keyboardResponse = observeLaunch(page);
    await keyboardMessage.press("Control+Enter");
    const keyboardEnvelope = await (await keyboardResponse).json();
    expect(keyboardEnvelope.errors).toBeUndefined();
    await completeFixture(keyboardEnvelope.data.terminal_session.agent_run_id);
  });
  test("dismisses an empty task prompt and keeps a blank conversation uncommitted", { tag: "@case-launch-empty-input" }, async ({ page }) => {
    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Shift+Enter");
    const prompt = page.getByRole("dialog", { name: "Prompt" });
    await expect(prompt.getByRole("textbox")).toHaveValue("");
    await prompt.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("dialog", { name: "Select Agent" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Shift+Enter");
    await prompt.getByRole("button", { name: "Close dialog" }).click();
    await expect(prompt).toHaveCount(0);
    await page.getByRole("button", { name: "Start a conversation with a prompt" }).click();
    await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("textbox", { name: "First message for the new conversation" })).toHaveCount(0);
  });

  test("recovers each browser launch entry after a refused network request", { tag: "@case-launch-path-recovery" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    for (const path of ["default", "picker", "prompt", "instant", "composer"] as const) {
      const item = await prepareLaunch(page, request, `recovery ${path}`);
      const trigger = async () => {
        if (path === "default") await page.getByRole("button", { name: "Run item", exact: true }).click();
        else if (path === "picker" || path === "prompt") {
          await page.getByRole("button", { name: "Open Settings" }).focus();
          await page.keyboard.press(path === "picker" ? "o" : "Shift+Enter");
          if (path === "prompt") {
            const prompt = page.getByRole("dialog", { name: "Prompt" });
            await prompt.getByRole("textbox").fill("Recovery fixture prompt");
            await prompt.getByRole("button", { name: "Submit" }).click();
          }
          await page.getByRole("dialog", { name: "Select Agent" }).getByText("codex", { exact: true }).click();
        } else if (path === "instant") await page.getByRole("treeitem", { name: /^New conversation/ }).click();
        else {
          const message = page.getByRole("textbox", { name: "First message for the new conversation" });
          if (!await message.isVisible()) await page.getByRole("button", { name: "Start a conversation with a prompt" }).click();
          await message.fill("Recovery fixture conversation");
          await page.getByRole("button", { name: "Start", exact: true }).click();
        }
      };
      await page.route("**/graphql", async route => {
        if (route.request().postDataJSON()?.operationName === "CreateTerminalSession")
          await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "forced launch recovery failure" }] }) });
        else await route.continue();
      });
      await trigger();
      if (path === "instant" || path === "composer") {
        // Conversation launches keep their own refusal notice (@case-conversation-launch-recovery).
        const notice = page.getByRole("dialog", { name: "Conversation did not start" });
        await expect(notice).toContainText("forced launch recovery failure");
        await notice.getByRole("button", { name: "Close", exact: true }).click();
        await expect(notice).toHaveCount(0);
      } else {
        const alert = page.getByRole("alert").filter({ hasText: /could not|did not start|failed/i }).last();
        await expect(alert).toContainText("forced launch recovery failure");
        await alert.getByRole("button", { name: "Dismiss" }).click();
        // A refused launch leaves no phantom terminal tab behind (CODING-2763).
        await expect(page.getByRole("tablist", { name: "Workspace tabs" }).getByRole("tab", { name: /codex.*terminal/ })).toHaveCount(0);
      }
      await page.unroute("**/graphql");
      const recovered = observeLaunch(page);
      await trigger();
      const envelope = await (await recovered).json();
      expect(envelope.errors).toBeUndefined();
      if (path === "instant" || path === "composer") {
        await completeFixture(envelope.data.terminal_session.agent_run_id);
        await expect.poll(async () => (await graphql(request, ScratchTerminalSessionsDocument, { projectId: fixture.project.id, moduleId: fixture.module.id, limit: 25 })).terminal_sessions.sessions.length).toBeGreaterThan(0);
      } else await assertTaskLaunch(page, request, item.id);
    }
  });
  test("shows the empty activated-provider picker and recovers after activation", { tag: "@case-launch-empty-providers" }, async ({ page, request }) => {
    const catalog = await getProviderCatalog(request);
    await graphql(request, UpdateProviderCatalogDocument, {
      activatedProviders: [], codexProfiles: catalog.codex_profiles,
      defaultProvider: null, defaultModel: null, defaultReasoning: null,
    });
    await openModule(page, names.module);
    await openWorkItem(page, names.blocker);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("o");
    const picker = page.getByRole("dialog", { name: "Select Agent" });
    await expect(picker).toContainText("No activated providers");
    await page.keyboard.press("Escape");
    await configureCodexDefault(request);
    await page.reload();
    await openWorkItem(page, names.blocker);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("o");
    await expect(picker.getByText("codex", { exact: true })).toBeVisible();
  });

  test("runs the disposable provider through credentialed MCP state transitions and exits", { tag: "@case-launch-provider-mcp" }, async ({ page, request }) => {
    const item = await prepareLaunch(page, request, "provider MCP");
    let from = item.state_id!;
    for (const stateName of ["Implement", "Review"]) {
      const catalog = await getWorkflowCatalog(request, fixture.project.id);
      const story = catalog.issue_types.nodes.find(row => row.id === fixture.storyType.id)!;
      const destination = catalog.states.nodes.find(row => row.name === stateName)!;
      const edge = story.transitions.nodes.find(row => row.from_state === from && row.to_state === destination.id);
      const variables = {
        issueTypeId: story.id, fromStateId: from, toStateId: destination.id,
        agentAllowed: true, handoff: false, workflowRevision: story.workflow_revision,
      };
      if (edge) await graphql(request, UpdateWorkTrackerTransitionDocument, variables);
      else await graphql(request, CreateWorkTrackerTransitionDocument, variables);
      from = destination.id;
    }
    const root = process.env.TICKETRY_E2E_PROVIDER_DIR!;
    await writeFile(join(root, "agent-control.json"), JSON.stringify({ mode: "success", states: ["Implement", "Review"], taskId: item.id, projectId: fixture.project.id }));
    const response = observeLaunch(page);
    await page.getByRole("button", { name: "Run item", exact: true }).click();
    const envelope = await (await response).json();
    expect(envelope.errors).toBeUndefined();
    const runId = envelope.data.terminal_session.agent_run_id;
    await completeFixture(runId);
    await expect.poll(async () => (await getWorkItem(request, item.id)).state_id).toBe(from);
    const calls = (await readFile(join(root, `${runId}.mcp.log`), "utf8")).trim().split("\n");
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toContain('"ok":true');
    await page.reload();
    expect((await getWorkItem(request, item.id)).state_id).toBe(from);
  });

  test("warns from the actual module checkout and rechecks stage skills on a fresh launch", { tag: "@case-launch-stage-skill-checkout" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const item = await prepareLaunch(page, request, "stage skills worktree");
    const skill = `ticketry-browser-stage-skill-${item.sequence_id}`;
    await configureStageSkill(page, request, skill, item.state_id!);
    await openWorkItem(page, item.name);
    const before = await stageSkillTrees([fixture.folder]);
    const launched = observeLaunch(page);
    await page.getByRole("button", { name: "Run item", exact: true }).click();
    const envelope = await (await launched).json();
    expect(envelope.errors).toBeUndefined();
    const firstRun = envelope.data.terminal_session.agent_run_id;
    const provider = await fixtureLaunchEvidence(firstRun);
    const report = await stageSkillReport(request, firstRun);
    expect(report).toMatchObject({ provider: "codex", status: "checked", skills: expect.arrayContaining([expect.objectContaining({ requested: skill, status: "missing" })]) });
    expect(report!.searched_roots.some(root => root.startsWith(fixture.folder))).toBe(true);
    expect(await realpath(provider.cwd)).toBe(await realpath(fixture.folder));
    expect(provider.args.join("\n")).toContain(`Stage skills:\nUse these skills for this stage: ["${skill}"]`);
    expect(provider.args.join("\n")).not.toMatch(/cannot see stage skills:|stage skill availability is unchecked/);
    await page.getByRole("tab", { name: /codex terminal/ }).last().click();
    const warning = page.getByRole("status", { name: "Stage skill warning", exact: true });
    await expect(warning).toContainText(skill);
    await expect(warning).toContainText("codex");
    await expect(warning).toContainText("Launch proceeds");
    const renderer = page.getByTestId("terminal-host");
    await expect(renderer).toBeVisible();
    await expect(renderer).not.toContainText(/cannot see stage skills:|stage skill availability is unchecked/);
    await page.getByRole("tab", { name: "Details", exact: true }).click();
    await page.getByRole("tab", { name: /codex terminal/ }).last().click();
    await expect(warning).toContainText(skill);
    await page.reload();
    await openWorkItem(page, item.name);
    await page.getByRole("tab", { name: /codex terminal/ }).last().click();
    await expect(warning).toContainText(skill);
    expect(await stageSkillReport(request, firstRun)).toEqual(report);
    expect(await stageSkillTrees([fixture.folder])).toEqual(before);
    await installStageSkill(fixture.folder, skill);
    const installed = await stageSkillTrees([fixture.folder]);
    expect(await stageSkillReport(request, firstRun)).toEqual(report);
    await expect(warning).toContainText(skill);
    await completeFixture(firstRun);
    await page.getByRole("tab", { name: "Details", exact: true }).click();
    const fresh = observeLaunch(page);
    await page.getByRole("button", { name: "Open Settings" }).focus();
    await page.keyboard.press("Meta+Enter");
    const second = await (await fresh).json();
    expect(second.errors).toBeUndefined();
    const secondRun = second.data.terminal_session.agent_run_id;
    expect(secondRun).not.toBe(firstRun);
    const secondProvider = await fixtureLaunchEvidence(secondRun);
    expect(await realpath(secondProvider.cwd)).toBe(await realpath(fixture.folder));
    expect(await stageSkillReport(request, secondRun)).toBeNull();
    await page.getByRole("tab", { name: /codex terminal/ }).last().click();
    await expect(warning).toHaveCount(0);
    expect(await stageSkillTrees([fixture.folder])).toEqual(installed);
    expect(await stageSkillReport(request, firstRun)).toEqual(report);
    await completeFixture(secondRun);
  });
  test("recovers the persisted stage-skill warning after a refused report read", { tag: "@case-launch-stage-skill-read-recovery" }, async ({ page, request }) => {
    const item = await prepareLaunch(page, request, "stage skills read recovery");
    const skill = `ticketry-browser-missing-skill-${item.sequence_id}`;
    await configureStageSkill(page, request, skill, item.state_id!);
    let refusedReads = 0;
    await page.route("**/graphql", async route => {
      if (route.request().postDataJSON()?.operationName === "AgentRunStageSkillAvailability") {
        refusedReads++;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message: "forced stage-skill report read refusal" }] }) });
      } else await route.continue();
    });
    const launched = observeLaunch(page);
    await page.getByRole("button", { name: "Run item", exact: true }).click();
    const envelope = await (await launched).json();
    expect(envelope.errors).toBeUndefined();
    const runId = envelope.data.terminal_session.agent_run_id;
    await fixtureLaunchEvidence(runId);
    await page.getByRole("tab", { name: /codex terminal/ }).last().click();
    await expect.poll(() => refusedReads).toBeGreaterThan(0);
    const canonical = await stageSkillReport(request, runId);
    expect(canonical).toMatchObject({ provider: "codex", skills: expect.arrayContaining([expect.objectContaining({ requested: skill, status: "missing" })]) });
    // Restore the real read boundary; never fabricate a successful report.
    await page.unroute("**/graphql");
    await page.reload();
    await openWorkItem(page, item.name);
    await page.getByRole("tab", { name: /codex terminal/ }).last().click();
    const warning = page.getByRole("status", { name: "Stage skill warning", exact: true });
    await expect(warning).toContainText(skill);
    await expect(warning).toContainText("codex");
    expect(await stageSkillReport(request, runId)).toEqual(canonical);
    await completeFixture(runId);
  });
  test("launches without a warning when the workflow has no stage skills", { tag: "@case-launch-stage-skill-empty" }, async ({ page, request }) => {
    const item = await prepareLaunch(page, request, "no stage skills");
    const binding = (await getWorkflowCatalog(request, fixture.project.id)).issue_types.nodes.find(row => row.id === fixture.storyType.id)!.launch_bindings.nodes.find(row => row.state === item.state_id)!;
    expect(binding.stage_skills).toEqual([]);
    const launched = observeLaunch(page);
    await page.getByRole("button", { name: "Run item", exact: true }).click();
    const envelope = await (await launched).json();
    expect(envelope.errors).toBeUndefined();
    const runId = envelope.data.terminal_session.agent_run_id;
    const provider = await fixtureLaunchEvidence(runId);
    expect(await stageSkillReport(request, runId)).toBeNull();
    expect(provider.args.join("\n")).not.toContain("Stage skills:");
    await page.getByRole("tab", { name: /codex terminal/ }).last().click();
    await expect(page.getByTestId("stage-skill-warning")).toHaveCount(0);
    await completeFixture(runId);
  });

  test("refuses a stage-skill launch from an untrusted browser worktree", { tag: "@case-launch-stage-skill-worktree-refusal" }, async ({ page, request }) => {
    const item = await prepareLaunch(page, request, "stage skills worktree refusal");
    await configureStageSkill(page, request, `ticketry-browser-worktree-skill-${item.sequence_id}`, item.state_id!);
    const created = observeLaunch(page, "WorktreeCreate");
    await page.getByTestId("worktree-block").getByRole("button", { name: "+ Worktree", exact: true }).click();
    expect((await (await created).json()).errors).toBeUndefined();
    const checkout = (await graphql(request, WorktreeStatusDocument, { taskId: item.id })).worktree_status;
    expect(checkout.kind).toBe("worktree");
    expect(checkout.path).toBeTruthy();
    const refused = observeLaunch(page);
    await page.getByRole("button", { name: "Run item", exact: true }).click();
    const envelope = await (await refused).json();
    expect(envelope.errors).toEqual(expect.arrayContaining([expect.objectContaining({
      extensions: expect.objectContaining({ code: "terminal_launch_invalid" }),
      message: expect.stringContaining("worktree_trust_approval_required"),
    })]));
    expect(envelope.errors[0].message).toContain(checkout.path!);
    // graphQlMutationError preserves the code; launchFailureMessage renders an
    // untranslated terminal_launch_invalid code while GraphQL retains the reason.
    await expect(page.getByRole("alert").filter({ hasText: "Agent run could not be started" }))
      .toContainText("Agent run could not be started: terminal_launch_invalid");
    expect((await graphql(request, TaskTerminalSessionsDocument, { taskId: item.id, limit: 25 })).terminal_sessions.sessions).toEqual([]);
    await page.getByTestId("worktree-block").getByRole("button", { name: "Show worktree details", exact: true }).click();
    await expect(page.getByTestId("worktree-details")).toBeVisible();
    await expect(page.getByRole("button", { name: "Trust worktree", exact: true })).toHaveCount(0);
    await page.reload();
    expect((await graphql(request, TaskTerminalSessionsDocument, { taskId: item.id, limit: 25 })).terminal_sessions.sessions).toEqual([]);
  });
});
