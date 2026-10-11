import { expect, type APIRequestContext, type Page, type Locator } from "@playwright/test";
import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { names, fixture, openFeatureModule as openModule } from "./work-items-migration-support";
import { createWorkItem, graphql, openWorkItem, getWorkflowCatalog } from "./support";
import { ClearModuleLinkDocument } from "../src/features/module-links/generated/moduleLinks.documents";
import { AgentRunStageSkillAvailabilityDocument } from "../src/features/agents/terminal/generated/stageSkillWarning.documents";
import type { SkillAvailabilityResult } from "../src/features/workflows/skillAvailability";
import { TaskTerminalSessionsDocument } from "../src/features/agents/terminal/generated/terminalSessions.documents";

export async function openSettings(page: Page): Promise<Locator> {
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
  await page.getByRole("button", { name: "Open Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Studio settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}
export async function clearModuleLinkEventually(request: APIRequestContext, moduleId: string) {
  await expect(async () => { await graphql(request, ClearModuleLinkDocument, { moduleId }); })
    .toPass({ timeout: 5_000, intervals: [100, 250, 500] });
}

export async function prepareLaunch(page: Page, request: APIRequestContext, suffix: string) {
  const item = await createWorkItem(request, fixture.project.id, {
    name: `Launch ${suffix}`, parent_id: fixture.module.id, issue_type_id: fixture.storyType.id,
  });
  await openModule(page, names.module);
  await openWorkItem(page, item.name);
  return item;
}
export async function observeLaunch(page: Page, operation = "CreateTerminalSession") {
  return page.waitForResponse(response => response.url().endsWith("/graphql")
    && response.request().postDataJSON()?.operationName === operation);
}
export async function completeFixture(runId: string) {
  const root = process.env.TICKETRY_E2E_PROVIDER_DIR!;
  await expect(async () => { expect(JSON.parse(await readFile(join(root, `${runId}.interactive.json`), "utf8")).runId).toBe(runId); }).toPass({ timeout: 10_000 });
  await writeFile(join(root, `${runId}.release`), "success\n");
  await expect(async () => { expect(await readFile(join(root, `${runId}.hooks.log`), "utf8")).toContain("Stop"); }).toPass({ timeout: 10_000 });
  const { pid } = JSON.parse(await readFile(join(root, `${runId}.interactive.json`), "utf8"));
  await expect.poll(() => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; } }).toBe(false);
}
export async function assertTaskLaunch(page: Page, request: APIRequestContext, taskId: string) {
  await expect.poll(async () => (await graphql(request, TaskTerminalSessionsDocument, { taskId, limit: 25 })).terminal_sessions.sessions.length).toBeGreaterThan(0);
  const session = (await graphql(request, TaskTerminalSessionsDocument, { taskId, limit: 25 })).terminal_sessions.sessions[0]!;
  expect(session.agent_run?.agent).toBe("codex");
  await completeFixture(session.agent_run_id);
  await page.reload();
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
  expect((await graphql(request, TaskTerminalSessionsDocument, { taskId, limit: 25 })).terminal_sessions.sessions.map(row => row.agent_run_id)).toContain(session.agent_run_id);
}


export async function configureStageSkill(page: Page, request: APIRequestContext, skill: string, stateId: string) {
  await page.getByRole("button", { name: "Configure Ideas state", exact: true }).click();
  const panel = page.getByTestId("state-configuration-panel");
  await expect(panel).toBeVisible();
  await panel.getByRole("tab", { name: "Story", exact: true }).click();
  await panel.getByRole("textbox", { name: "Skills", exact: true }).fill(skill);
  await panel.getByRole("textbox", { name: "Skills", exact: true }).press("Enter");
  await expect.poll(async () => (await getWorkflowCatalog(request, fixture.project.id)).issue_types.nodes
    .find(row => row.id === fixture.storyType.id)?.launch_bindings.nodes.find(row => row.state === stateId)?.stage_skills).toContain(skill);
  await page.getByRole("button", { name: "Close Ideas state configuration", exact: true }).click();
}
export async function stageSkillReport(request: APIRequestContext, runId: string): Promise<SkillAvailabilityResult | null> {
  const data = await graphql(request, AgentRunStageSkillAvailabilityDocument, { agentRunId: runId });
  const row = data.agent_runs.nodes.find(candidate => candidate.id.replace(/-/g, "") === runId.replace(/-/g, ""));
  expect(row, `acknowledged run ${runId}`).toBeTruthy();
  return row!.stage_skill_availability ? JSON.parse(row!.stage_skill_availability) : null;
}
export async function installStageSkill(directory: string, skill: string) {
  const root = join(directory, ".agents", "skills", skill);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "SKILL.md"), `---\nname: ${skill}\ndescription: Disposable browser acceptance skill\n---\nOnly a local fixture.\n`);
}
/** Snapshot owned fixture trees to prove the read-only check does not install anything. */
export async function stageSkillTrees(directories: string[]): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {};
  async function visit(path: string): Promise<void> {
    let stat;
    try { stat = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") { snapshot[path] = null; return; } throw error; }
    if (!stat.isDirectory()) { snapshot[path] = { data: await readFile(path, "base64"), mode: stat.mode, modified: stat.mtimeMs, changed: stat.ctimeMs }; return; }
    const children = (await readdir(path)).sort();
    snapshot[path] = { children, mode: stat.mode, modified: stat.mtimeMs, changed: stat.ctimeMs };
    for (const child of children) await visit(join(path, child));
  }
  for (const directory of directories) await visit(join(directory, ".agents", "skills"));
  return snapshot;
}
export async function fixtureLaunchEvidence(runId: string): Promise<{ runId: string; args: string[]; pid: number; cwd: string }> {
  const root = process.env.TICKETRY_E2E_PROVIDER_DIR!;
  await expect(async () => { expect(JSON.parse(await readFile(join(root, `${runId}.interactive.json`), "utf8")).runId).toBe(runId); }).toPass({ timeout: 10_000 });
  return JSON.parse(await readFile(join(root, `${runId}.interactive.json`), "utf8"));
}
