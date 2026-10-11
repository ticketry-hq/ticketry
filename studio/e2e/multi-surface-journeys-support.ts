import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { CreateSprintDocument } from "../src/features/sprints/generated/sprints.documents";
import { CreateWorkTrackerWorkItemDocument } from "../src/features/work-items/generated/workItems.documents";
import { TaskTerminalSessionsDocument } from "../src/features/agents/terminal/generated/terminalSessions.documents";
import { configureCodexDefault, createModule, getWorkflowCatalog, getWorkItems, getWorkspace, graphql, selectModuleForProfile } from "./support";

const providerRoot = () => process.env.TICKETRY_E2E_PROVIDER_DIR!;

/** One uniquely named, disposable linked folder per journey. */
export async function journeyFixture(request: APIRequestContext, label: string) {
  const project = await getWorkspace(request);
  const catalog = await getWorkflowCatalog(request, project.id);
  const moduleType = catalog.issue_types.nodes.find((type) => type.level === "module")!;
  const storyType = catalog.issue_types.nodes.find((type) => type.name === "Story")!;
  const folder = await mkdtemp(join(tmpdir(), "ticketry-journey-"));
  const prefix = `Journey ${label} ${crypto.randomUUID().slice(0, 8)}`;
  await configureCodexDefault(request);
  const linkedModule = async (name: string) => {
    const module = await createModule(request, project.id, { name, issue_type_id: moduleType.id });
    await selectModuleForProfile(request, project.id, module.id, folder);
    return module;
  };
  const story = async (name: string, parentId: string, sprintId?: string) =>
    (await graphql(request, CreateWorkTrackerWorkItemDocument, { projectId: project.id, name, issueTypeId: storyType.id, parentId, sprintId })).create_work_item;
  const sprint = async (name: string) =>
    (await graphql(request, CreateSprintDocument, { data: { projectId: project.id, name } })).worktrackerSprintCreateOne;
  const stateNamed = (name: string) => catalog.states.nodes.find((state) => state.name === name)!;
  return { project, folder, prefix, linkedModule, story, sprint, stateNamed, cleanup: () => rm(folder, { recursive: true, force: true }) };
}

/**
 * The real interactive fixture holds until released, then writes each state
 * through Ticketry's MCP only after its per-state signal.
 */
export async function holdProvider(states: string[] = []) {
  await writeFile(join(providerRoot(), "agent-control.json"), JSON.stringify({ mode: "success", states, stepSignals: states.length > 0 }));
}
export async function releaseProvider(runId: string) {
  await writeFile(join(providerRoot(), `${runId}.release`), "release");
}
export async function advanceProvider(runId: string, state: string) {
  await writeFile(join(providerRoot(), `${runId}.advance-${state}`), "advance");
}
export async function providerEvidence(runId: string) {
  let raw = "";
  await expect.poll(async () => { try { raw = await readFile(join(providerRoot(), `${runId}.interactive.json`), "utf8"); } catch { raw = ""; } return raw.length > 0; }).toBe(true);
  return JSON.parse(raw) as { runId: string; sessionId: string; pid: number };
}
export function processAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
export async function liveTaskSessions(request: APIRequestContext, taskId: string) {
  return (await graphql(request, TaskTerminalSessionsDocument, { taskId, limit: 25 })).terminal_sessions.sessions;
}

/** Count production launch requests so a takeover can prove it never relaunched. */
export function countOperations(page: Page, operation: string) {
  const seen: unknown[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/graphql") && request.postDataJSON()?.operationName === operation) seen.push(request.postDataJSON());
  });
  return () => seen.length;
}

export async function storyNamed(request: APIRequestContext, projectId: string, name: string) {
  const rows = (await getWorkItems(request, projectId)).filter((row) => row.name === name);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

export const moduleTabs = (page: Page) => page.getByRole("tablist", { name: "Project module tabs" });
export const moduleTab = (page: Page, name: string) => moduleTabs(page).getByRole("tab", { name, exact: true });
export const sprintTrigger = (page: Page) => page.getByRole("button", { name: /^Sprint: / });

export async function chooseSprint(page: Page, name: string) {
  await sprintTrigger(page).click();
  const dialog = page.getByRole("dialog", { name: "Choose sprint" });
  await dialog.getByRole("textbox", { name: "Search sprints" }).fill(name);
  await dialog.getByRole("option", { name: new RegExp(name) }).click();
  await expectSprint(page, name);
}

/** The chooser announces the sprint's status after its name. */
export async function expectSprint(page: Page, name: string) {
  await expect(sprintTrigger(page)).toHaveAccessibleName(new RegExp(`^Sprint: ${name}(,|$)`));
}

export async function openManager(page: Page) {
  await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
  const manager = page.getByRole("region", { name: "Module Manager", exact: true });
  await expect(manager).toBeVisible();
  return manager;
}
