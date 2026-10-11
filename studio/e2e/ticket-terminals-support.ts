import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { TaskTerminalSessionsDocument } from "../src/features/agents/terminal/generated/terminalSessions.documents";
import { configureCodexDefault, createModule, createWorkItem, getWorkflowCatalog, getWorkspace, graphql, selectModuleForProfile } from "./support";

/** One linked disposable folder and a uniquely named module for the suite. */
export async function terminalFixture(request: APIRequestContext) {
  const project = await getWorkspace(request);
  const catalog = await getWorkflowCatalog(request, project.id);
  const moduleType = catalog.issue_types.nodes.find((type) => type.level === "module")!;
  const storyType = catalog.issue_types.nodes.find((type) => type.name === "Story")!;
  const folder = await mkdtemp(join(tmpdir(), "ticketry-ticket-terminals-"));
  await configureCodexDefault(request);
  const module = await createModule(request, project.id, {
    name: `Ticket terminals ${crypto.randomUUID().slice(0, 8)}`, issue_type_id: moduleType.id,
  });
  await selectModuleForProfile(request, project.id, module.id, folder);
  const story = (api: APIRequestContext, name: string) => createWorkItem(api, project.id, {
    name, parent_id: module.id, issue_type_id: storyType.id,
  });
  return { project, module, folder, story, cleanup: () => rm(folder, { recursive: true, force: true }) };
}

export const workspaceTabs = (page: Page) => page.getByRole("tablist", { name: "Workspace tabs" });
export const detailsTab = (page: Page) => workspaceTabs(page).getByRole("tab", { name: "Details", exact: true });
export const visibleHost = (page: Page) => page.getByTestId("terminal-host").filter({ visible: true });
export const visibleViewer = (page: Page) => page.getByTestId("retained-terminal-viewer").filter({ visible: true });

export async function openTicketModule(page: Page, moduleName: string) {
  await page.goto("/");
  const tab = page.getByRole("tablist", { name: "Project module tabs" }).getByRole("tab", { name: moduleName, exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}

export async function selectTicket(page: Page, name: string) {
  await page.getByRole("treeitem", { name: new RegExp(name) }).click();
  await expect(page.getByTestId("issue-name")).toContainText(name);
}

/** Opens a real Work Item shell through Issue actions and returns its run. */
export async function openTicketShell(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Issue actions", exact: true }).click();
  const created = page.waitForResponse((response) => response.url().endsWith("/graphql")
    && response.request().postDataJSON()?.operationName === "CreateWorkItemShell");
  await page.getByRole("menuitem", { name: "Open terminal", exact: true }).click();
  const envelope = await (await created).json();
  expect(envelope.errors, JSON.stringify(envelope)).toBeUndefined();
  return envelope.data.terminal_session.agent_run_id as string;
}

export async function liveRunIds(request: APIRequestContext, taskId: string) {
  return (await graphql(request, TaskTerminalSessionsDocument, { taskId, limit: 25 })).terminal_sessions.sessions.map((row) => row.agent_run_id);
}

export function shellTab(page: Page): Locator {
  return workspaceTabs(page).getByRole("tab", { name: /shell/i });
}

/** Types one command into the engaged xterm and waits for its output. */
export async function runInTerminal(page: Page, command: string, output: string | RegExp) {
  const host = visibleHost(page);
  await host.click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
  await expect(host).toContainText(output);
}

const tmuxSocket = () => `ticketry-e2e-${basename(process.env.TICKETRY_E2E_DATA_DIR!)}`;

/** Live tmux session names on the suite's private server. */
export async function tmuxSessions(): Promise<string[]> {
  try {
    const { stdout } = await promisify(execFile)("tmux", ["-L", tmuxSocket(), "list-sessions", "-F", "#{session_name}"]);
    return stdout.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export async function providerRunIds(): Promise<string[]> {
  const files = await readdir(process.env.TICKETRY_E2E_PROVIDER_DIR!);
  return files.filter((file) => file.endsWith(".interactive.json")).map((file) => file.replace(".interactive.json", ""));
}

/** Ends one tmux session outside Ticketry, as an external kill would. */
export async function killTmuxSession(name: string) {
  await promisify(execFile)("tmux", ["-L", tmuxSocket(), "kill-session", "-t", name]);
}
