import { access, constants } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync, realpathSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { featureSuite } from "./featureSuite";
import { configureCodexDefault } from "../support";
import { cleanupWorkItemsFixture, fixture, names, openFeatureModule, seedProject } from "../work-items-migration-support";
import { agentStatus, waitForAgentExit } from "../agent-lifecycle-support";
import { releaseConversation } from "../conversation-support";
import { fixtureLaunchEvidence } from "../agent-launch-support";
import {
  expectSpoolDrained,
  hookEvent,
  publishHook,
  launchFixtureRun,
  launchHook,
  lifecycleChip,
  rowBadge,
  runHolding,
  spoolEntries,
} from "../agent-services-support";

featureSuite("hook-runner-and-lifecycle-reporting", { isolation: "case" }, () => {
  test.beforeAll(async ({ request }) => { await seedProject(request); await configureCodexDefault(request); });
  test.afterAll(cleanupWorkItemsFixture);

  test("hands Run item the packaged hook runner and reports a permission request into the open row", { tag: "@case-hook-launch-lifecycle" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    await openFeatureModule(page, names.module);
    await expect(page.getByRole("treeitem", { name: new RegExp(names.parent) })).toBeVisible();
    await expect(rowBadge(page, names.parent)).toHaveCount(0);
    expect((await agentStatus(request, fixture.project.id)).agent_run_holdings).toEqual([]);
    const runId = await launchFixtureRun(page, names.parent, { mode: "success", hooks: ["PermissionRequest"] });
    const hook = await launchHook(runId);
    expect(hook.provider).toBe("codex");
    expect(hook.runId).toBe(runId);
    expect(isAbsolute(hook.executable)).toBe(true);
    expect(hook.executable).toMatch(/\/ticketry-hook$/);
    await access(hook.executable, constants.X_OK);
    // The spool is per data directory and lives outside it, in the system temporary directory.
    expect(realpathSync(join(hook.spoolDirectory, ".."))).toBe(realpathSync(tmpdir()));
    expect(hook.spoolDirectory).toMatch(/ticketry-hook-spool-[0-9a-f]{16}$/);
    expect(hook.spoolDirectory.startsWith(process.env.TICKETRY_E2E_DATA_DIR!)).toBe(false);

    const badge = rowBadge(page, names.parent);
    await expect(badge.getByLabel(lifecycleChip.permission, { exact: true })).toBeVisible();
    await expect.poll(async () => (await runHolding(request, fixture.project.id, runId))?.state).toBe("permission_required");
    await expectSpoolDrained(hook.spoolDirectory);

    await page.reload();
    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.permission, { exact: true })).toBeVisible();

    await releaseConversation(runId);
    await waitForAgentExit(request, fixture.parent.id, runId);
    await expect(rowBadge(page, names.parent)).toHaveCount(0);
    expect(await runHolding(request, fixture.project.id, runId)).toBeUndefined();
    expect((await fixtureLaunchEvidence(runId)).runId).toBe(runId);
    expect((await spoolEntries(hook.spoolDirectory)).filter(name => name.endsWith(".hook"))).toEqual([]);
  });

  test("maps each provider's events to distinct lifecycle chips on the row and module tab", { tag: "@case-hook-provider-event-mapping" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const runId = await launchFixtureRun(page, names.parent, { mode: "success" });
    const hook = await launchHook(runId);
    const badge = rowBadge(page, names.parent);
    const moduleTab = page.getByRole("tab", { name: names.module, exact: true }).last();
    await expect(badge.getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    await expect(moduleTab.getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();

    // Codex Stop means the agent awaits input, not that the process exited.
    expect(publishHook(hook.command, hookEvent("Stop"))).toEqual({ status: 0, stdout: "", stderr: "" });
    await expect(badge.getByLabel(lifecycleChip.needsInput, { exact: true })).toBeVisible();
    await expect(moduleTab.getByLabel(lifecycleChip.needsInput, { exact: true })).toBeVisible();
    await expect.poll(async () => (await runHolding(request, fixture.project.id, runId))?.state).toBe("needs_input");
    await expectSpoolDrained(hook.spoolDirectory);

    publishHook(hook.command, hookEvent("UserPromptSubmit"));
    await expect(badge.getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    await expect.poll(async () => (await runHolding(request, fixture.project.id, runId))?.state).toBe("working");

    // Claude Stop means a completed turn; hook mode also takes its run from MUXED_AGENT_RUN_ID.
    const claude = `MUXED_AGENT_RUN_ID=${runId} '${hook.executable}' hook claude --spool-dir '${hook.spoolDirectory}'`;
    expect(publishHook(claude, hookEvent("Stop"))).toEqual({ status: 0, stdout: "", stderr: "" });
    await expect(badge.getByLabel(lifecycleChip.turnComplete, { exact: true })).toBeVisible();
    // Module tabs aggregate only working, input, permission and error runs.
    await expect(moduleTab.getByLabel(lifecycleChip.working, { exact: true })).toHaveCount(0);
    await expect.poll(async () => (await runHolding(request, fixture.project.id, runId))?.state).toBe("turn_complete");
    await expectSpoolDrained(hook.spoolDirectory);

    // Gemini and Agy payloads use their own event names for the same lifecycle facts.
    const provider = (name: string) => `'${hook.executable}' hook ${name} --agent-run-id ${runId} --spool-dir '${hook.spoolDirectory}'`;
    publishHook(provider("agy"), JSON.stringify({ hook_event_name: "Notification", conversationId: "agy-session" }));
    await expect(badge.getByLabel(lifecycleChip.needsInput, { exact: true })).toBeVisible();
    publishHook(provider("gemini"), JSON.stringify({ hook_event_name: "AfterAgent", session_id: "gemini-session" }));
    await expect(badge.getByLabel(lifecycleChip.turnComplete, { exact: true })).toBeVisible();
    await expect.poll(async () => (await runHolding(request, fixture.project.id, runId))?.state).toBe("turn_complete");
    await expectSpoolDrained(hook.spoolDirectory);

    await page.reload();
    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.turnComplete, { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: names.module, exact: true }).last().getByLabel(lifecycleChip.working, { exact: true })).toHaveCount(0);

    await releaseConversation(runId);
    await waitForAgentExit(request, fixture.parent.id, runId);
    await expect(rowBadge(page, names.parent)).toHaveCount(0);
  });

  test("quarantines malformed hook payloads and drops unmapped events without changing the row", { tag: "@case-hook-invalid-deliveries" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const runId = await launchFixtureRun(page, names.parent, { mode: "success" });
    const hook = await launchHook(runId);
    const badge = rowBadge(page, names.parent);
    await expect(badge.getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    const silent = { status: 0, stdout: "", stderr: "" };
    for (const payload of ["not json", "", JSON.stringify({ hook_event_name: "Stop", ticketry_hook_version: 2 }), hookEvent("Mystery")]) {
      expect(publishHook(hook.command, payload)).toEqual(silent);
    }
    // An unsupported provider is refused by the runner itself and publishes nothing.
    expect(publishHook(`'${hook.executable}' hook mystery --agent-run-id ${runId} --spool-dir '${hook.spoolDirectory}'`, hookEvent("Stop"))).toEqual(silent);

    const quarantine = join(hook.spoolDirectory, "quarantine");
    await expect.poll(() => spoolEntries(quarantine), { timeout: 10_000 }).toHaveLength(3);
    for (const name of await spoolEntries(quarantine)) {
      expect(name).toMatch(new RegExp(`^v1__codex__${runId}__.+\\.hook\\.[0-9a-f]{32}\\.invalid$`));
    }
    await expectSpoolDrained(hook.spoolDirectory);
    await expect(badge.getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    expect((await runHolding(request, fixture.project.id, runId))?.state).toBe("working");

    await page.reload();
    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    expect(await spoolEntries(quarantine)).toHaveLength(3);

    await releaseConversation(runId);
    await waitForAgentExit(request, fixture.parent.id, runId);
  });

  test("keeps producer failures silent and consumes an unknown run's delivery without disturbing the live run", { tag: "@case-hook-silent-failures" }, async ({ page, request }) => {
    test.setTimeout(90_000);
    const runId = await launchFixtureRun(page, names.parent, { mode: "success" });
    const hook = await launchHook(runId);
    const badge = rowBadge(page, names.parent);
    await expect(badge.getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    const silent = { status: 0, stdout: "", stderr: "" };
    // Start from a drained spool so any file below could only come from a failed publish.
    await expectSpoolDrained(hook.spoolDirectory);

    const missing = `${hook.spoolDirectory}-missing`;
    expect(publishHook(hook.command.replace(hook.spoolDirectory, missing), hookEvent("Stop"))).toEqual(silent);
    expect(existsSync(missing)).toBe(false);
    expect(publishHook(hook.command, "x".repeat(1024 * 1024 + 1))).toEqual(silent);
    expect((await spoolEntries(hook.spoolDirectory)).filter(name => name !== "quarantine")).toEqual([]);

    const strangerRun = "f".repeat(32);
    expect(publishHook(`MUXED_AGENT_RUN_ID=${strangerRun} '${hook.executable}' hook codex --spool-dir '${hook.spoolDirectory}'`, hookEvent("Stop"))).toEqual(silent);
    await expectSpoolDrained(hook.spoolDirectory);
    expect(await spoolEntries(join(hook.spoolDirectory, "quarantine"))).toEqual([]);
    await expect(badge.getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();
    expect((await runHolding(request, fixture.project.id, runId))?.state).toBe("working");
    expect(await runHolding(request, fixture.project.id, strangerRun)).toBeUndefined();

    await page.reload();
    await expect(rowBadge(page, names.parent).getByLabel(lifecycleChip.working, { exact: true })).toBeVisible();

    await releaseConversation(runId);
    await waitForAgentExit(request, fixture.parent.id, runId);
  });
});
