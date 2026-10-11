import { execFile } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, type APIRequestContext, type Locator, type Page, type Route } from "@playwright/test";
import { WorktreeStatusDocument } from "../src/features/agents/worktrees/generated/worktreeStatus.documents";
import { WorktreeDiscardDocument } from "../src/features/agents/worktrees/generated/worktreeDiscard.documents";
import { WorktreeCreateDocument } from "../src/features/agents/worktrees/generated/worktreeCreate.documents";
import { createModule, createWorkItem, getWorkflowCatalog, getWorkspace, graphql, selectModuleForProfile, type ModuleRow, type WorkItemRow } from "./support";

const execFileAsync = promisify(execFile);
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: "Ticketry E2E",
  GIT_AUTHOR_EMAIL: "e2e@ticketry.invalid",
  GIT_COMMITTER_NAME: "Ticketry E2E",
  GIT_COMMITTER_EMAIL: "e2e@ticketry.invalid",
};

export async function git(folder: string, ...arguments_: string[]): Promise<string> {
  return (await execFileAsync("git", ["-C", folder, ...arguments_], { env: gitEnvironment })).stdout;
}

/** A disposable repository whose only commit holds README.md. */
export async function createRepository(label: string): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), `ticketry-${label}-`));
  await git(folder, "init", "-b", "main");
  await writeFile(join(folder, "README.md"), "Ticketry browser E2E\n");
  await git(folder, "add", "README.md");
  await git(folder, "commit", "-m", "Initial E2E fixture");
  return folder;
}

export async function commitFile(folder: string, name: string, contents: string, message: string) {
  await writeFile(join(folder, name), contents);
  await git(folder, "add", name);
  await git(folder, "commit", "-m", message);
}

export async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export interface WorktreeFixture {
  projectId: string;
  storyTypeId: string;
  implementationTypeId: string;
  module: (name: string, folder: string, requestContext?: APIRequestContext) => Promise<ModuleRow>;
  story: (name: string, parentId: string, issueTypeId?: string, requestContext?: APIRequestContext) => Promise<WorkItemRow>;
}

export async function worktreeFixture(request: APIRequestContext): Promise<WorktreeFixture> {
  const project = await getWorkspace(request);
  const types = (await getWorkflowCatalog(request, project.id)).issue_types.nodes;
  const moduleType = types.find((type) => type.level === "module")!;
  const storyType = types.find((type) => type.name === "Story")!;
  const implementationType = types.find((type) => type.name === "Implementation")!;
  return {
    projectId: project.id,
    storyTypeId: storyType.id,
    implementationTypeId: implementationType.id,
    module: async (name, folder, requestContext = request) => {
      const module = await createModule(requestContext, project.id, { name, issue_type_id: moduleType.id });
      await selectModuleForProfile(requestContext, project.id, module.id, folder);
      return module;
    },
    story: (name, parentId, issueTypeId = storyType.id, requestContext = request) =>
      createWorkItem(requestContext, project.id, { name, parent_id: parentId, issue_type_id: issueTypeId }),
  };
}

export async function worktreeStatus(request: APIRequestContext, taskId: string) {
  return (await graphql(request, WorktreeStatusDocument, { taskId })).worktree_status;
}

/** Removes any checkout Ticketry still indexes for these tasks through the production discard. */
export async function discardWorktrees(request: APIRequestContext, taskIds: string[]) {
  for (const taskId of taskIds) {
    try {
      if ((await worktreeStatus(request, taskId)).kind !== "worktree") continue;
      await graphql(request, WorktreeDiscardDocument, { taskId, operationId: crypto.randomUUID() });
    } catch {
      // A failed teardown discard still leaves the repository removal below.
    }
  }
}

export async function openModuleTab(page: Page, name: string) {
  await page.goto("/");
  const tab = page.getByRole("tablist", { name: "Project module tabs" }).getByRole("tab", { name, exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}

export function graphqlResponse(page: Page, operationName: string) {
  return page.waitForResponse((response) =>
    response.url().endsWith("/graphql") && response.request().postDataJSON()?.operationName === operationName);
}

/** Refuses one GraphQL operation at the network boundary until the returned stop is called. */
export async function refuseOperation(page: Page, operationName: string, message: string) {
  let refused = 0;
  const handler = async (route: Route) => {
    if (route.request().postDataJSON()?.operationName !== operationName) return route.fallback();
    refused += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ errors: [{ message }] }) });
  };
  await page.route("**/graphql", handler);
  return {
    count: () => refused,
    stop: () => page.unroute("**/graphql", handler),
  };
}

export async function removeRepository(folder: string | undefined) {
  if (folder) await rm(folder, { recursive: true, force: true });
}

/** Moves the selected ticket through one permitted workflow edge and proves the server accepted it. */
export async function selectState(page: Page, stateName: string) {
  const picker = page.getByTestId("state-picker");
  const option = page.getByRole("button", { name: stateName, exact: true });
  const saved = graphqlResponse(page, "TransitionWorkTrackerWorkItem");
  // The previous transition's authoritative row can re-render the picker and
  // close a menu that just opened; reopen and choose until the click lands.
  await expect(async () => {
    if (!await option.isVisible()) await picker.getByRole("button").first().click();
    await option.click({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
  const envelope = await (await saved).json();
  expect(envelope.errors, JSON.stringify(envelope.errors)).toBeUndefined();
  await expect(picker).toContainText(stateName);
}

/** Opts a task into a real checkout through the production create operation. */
export async function createWorktree(request: APIRequestContext, taskId: string) {
  const created = (await graphql(request, WorktreeCreateDocument, { taskId, operationId: crypto.randomUUID() })).worktree_create;
  expect(created.kind).toBe("worktree");
  return created;
}

/** Enters the independent Changes workspace from the module's workspace tab. */
export async function openChanges(page: Page) {
  await page.getByTestId("workspace-tab-changes").click();
  const workspace = page.getByRole("region", { name: "Changes workspace" });
  await expect(workspace).toBeVisible();
  return workspace;
}

/** Ordinary checkout labels are `<project>-<sequence> <name>`. */
export function checkoutOption(scope: Locator, item: { sequence_id: number; name: string }) {
  return scope.getByRole("option", { name: new RegExp(`^Open \\w+-${item.sequence_id} ${item.name} Changes$`) });
}
