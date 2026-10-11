import { callSocketMcpTool } from "../scripts/mcp-socket-client.mjs";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  ClearModuleLinkDocument,
  LoadModuleLinksDocument,
} from "../src/features/module-links/generated/moduleLinks.documents";
import { WorktreeStatusDocument } from "../src/features/agents/worktrees/generated/worktreeStatus.documents";
import {
  CreateWorkTrackerWorkItemDocument,
  DeleteWorkTrackerWorkItemDocument,
} from "../src/features/work-items/generated/workItems.documents";
import {
  UpdateWorkTrackerModulePresentationDocument,
  UpdateWorkTrackerProjectDocument,
} from "../src/features/projects/generated/projects.documents";
import {
  CreateWorkTrackerIssueTypeDocument,
  CreateWorkTrackerStateDocument,
  CreateWorkTrackerTransitionDocument,
  DeleteWorkTrackerIssueTypeDocument,
  DeleteWorkTrackerStateDocument,
  DeleteWorkTrackerTransitionDocument,
  RemoveWorkTrackerWorkflowStateDocument,
  ReorderWorkTrackerIssueTypesDocument,
  ReorderWorkTrackerStatesDocument,
  SetWorkTrackerStartStateDocument,
  SetWorkTrackerSubtreeRunDocument,
  UpdateWorkTrackerStateDocument,
} from "../src/features/workflows/generated/workflows.documents";
import {
  acknowledgeOnboarding,
  captureLegacyProductApiRequests,
  CODEX_TEST_MODEL,
  CODEX_TEST_REASONING,
  configureCodexDefault,
  createModule,
  createProject,
  createWorkItem,
  getModules,
  getProjects,
  getWorkItem,
  getWorkItems,
  getWorkflowCatalog,
  graphql,
  graphqlRefusal,
  openModule,
  openWorkItem,
  selectModuleForProfile,
  type ApiRow,
  type ModuleRow,
  type ProjectRow,
  type WorkItemRow,
} from "./support";

type IssueTypeRow = ApiRow & { level: "task" | "module" };
type StateRow = ApiRow & {
  color: string | null;
  group: string;
  sort_order: number;
};

const execFileAsync = promisify(execFile);
export const attachmentContents = "Rust MCP attachment E2E evidence.\n";

export const names = {
  module: "Complete Web App",
  secondModule: "Navigation Target",
  staleModule: "Stale Link Recovery",
  nonRepoModule: "Non-repository Module",
  nonRepoItem: "Work without Git isolation",
  parent: "Complete parent",
  parentRenamed: "Complete parent renamed",
  blocker: "Complete blocker",
  moving: "Complete moving",
  reorderFirst: "Complete reorder first",
  reorderSecond: "Complete reorder second",
  hierarchyParent: "Complete hierarchy parent",
  hierarchyChild: "Complete hierarchy child",
  landing: "Retain committed worktree on completion",
  landingConflict: "Retain diverged worktree on completion",
  landingDirty: "Retain dirty worktree on completion",
  runNow: "Complete safe Run now refusal",
  deletable: "Complete disposable",
};

export const fixture: {
  folder: string;
  nonRepoFolder: string;
  alternateFolder: string;
  attachmentPath: string;
  project: ProjectRow;
  module: ModuleRow;
  secondModule: ModuleRow;
  staleModule: ModuleRow;
  nonRepoModule: ModuleRow;
  storyType: IssueTypeRow;
  implementationType: IssueTypeRow;
  states: StateRow[];
  parent: WorkItemRow;
  blocker: WorkItemRow;
  moving: WorkItemRow;
  reorderFirst: WorkItemRow;
  reorderSecond: WorkItemRow;
  hierarchyParent: WorkItemRow;
  hierarchyChild: WorkItemRow;
  landing: WorkItemRow;
  landingConflict: WorkItemRow;
  landingDirty: WorkItemRow;
  runNow: WorkItemRow;
  deletable: WorkItemRow;
  nonRepoItem: WorkItemRow;
} = {} as never;

export async function seedProject(request: APIRequestContext): Promise<void> {
  fixture.folder = await mkdtemp(join(tmpdir(), "ticketry-web-e2e-"));
  fixture.nonRepoFolder = await mkdtemp(join(tmpdir(), "ticketry-web-no-repo-e2e-"));
  fixture.alternateFolder = await mkdtemp(join(tmpdir(), "ticketry-web-alternate-e2e-"));
  const gitEnvironment = {
    ...process.env,
    GIT_AUTHOR_NAME: "Ticketry E2E",
    GIT_AUTHOR_EMAIL: "e2e@ticketry.invalid",
    GIT_COMMITTER_NAME: "Ticketry E2E",
    GIT_COMMITTER_EMAIL: "e2e@ticketry.invalid",
  };
  const git = async (...arguments_: string[]): Promise<void> => {
    await execFileAsync("git", ["-C", fixture.folder, ...arguments_], {
      env: gitEnvironment,
    });
  };
  await git("init", "-b", "main");
  await writeFile(join(fixture.folder, "README.md"), "Ticketry browser E2E\n");
  fixture.attachmentPath = join(fixture.folder, "e2e-implementation-notes.md");
  await writeFile(fixture.attachmentPath, attachmentContents);
  await git("add", "README.md", "e2e-implementation-notes.md");
  await git("commit", "-m", "Initial E2E fixture");
  await acknowledgeOnboarding(request);

  const projects = await getProjects(request);
  fixture.project = projects.find((project) => project.slug === "CDN")
    ?? await createProject(request, {
      name: "Coding",
      slug: "CDN",
      description: "",
    });

  const catalog = await getWorkflowCatalog(request, fixture.project.id);
  const issueTypes = catalog.issue_types.nodes;
  const moduleType = issueTypes.find((issueType) =>
    issueType.level === "module" || issueType.name === "Module"
  );
  const storyType = issueTypes.find((issueType) => issueType.name === "Story");
  const implementationType = issueTypes.find((issueType) =>
    issueType.name === "Implementation"
  );
  expect(moduleType, "the seeded Module issue type").toBeTruthy();
  expect(storyType, "the seeded Story issue type").toBeTruthy();
  expect(implementationType, "the seeded Implementation issue type").toBeTruthy();
  fixture.storyType = storyType!;
  fixture.implementationType = implementationType!;

  const modules = await getModules(request, fixture.project.id);
  fixture.module = modules.find((module) => module.name === names.module)
    ?? await createModule(request, fixture.project.id, {
      name: names.module,
      issue_type_id: moduleType!.id,
    });
  fixture.secondModule = modules.find((module) =>
    module.name === names.secondModule
  ) ?? await createModule(request, fixture.project.id, {
    name: names.secondModule,
    issue_type_id: moduleType!.id,
  });
  fixture.staleModule = modules.find((module) =>
    module.name === names.staleModule
  ) ?? await createModule(request, fixture.project.id, {
    name: names.staleModule,
    issue_type_id: moduleType!.id,
  });
  fixture.nonRepoModule = modules.find((module) =>
    module.name === names.nonRepoModule
  ) ?? await createModule(request, fixture.project.id, {
    name: names.nonRepoModule,
    issue_type_id: moduleType!.id,
  });
  await selectModuleForProfile(
    request,
    fixture.project.id,
    fixture.secondModule.id,
    fixture.folder,
  );
  await selectModuleForProfile(
    request,
    fixture.project.id,
    fixture.module.id,
    fixture.folder,
  );
  await selectModuleForProfile(
    request,
    fixture.project.id,
    fixture.nonRepoModule.id,
    fixture.nonRepoFolder,
  );
  await selectModuleForProfile(
    request,
    fixture.project.id,
    fixture.module.id,
    fixture.folder,
  );

  fixture.states = [...catalog.states.nodes];
  const existingItems = await getWorkItems(request, fixture.project.id);
  const ensureItem = async (
    name: string,
    body: Record<string, unknown>,
    aliases: string[] = [],
  ): Promise<WorkItemRow> => existingItems.find((item) =>
    item.name === name || aliases.includes(item.name)
  ) ?? await createWorkItem(request, fixture.project.id, { name, ...body });
  const rootStory = {
    parent_id: fixture.module.id,
    issue_type_id: fixture.storyType.id,
  };
  fixture.parent = await ensureItem(names.parent, {
    ...rootStory,
    description: "Original complete description",
  }, [names.parentRenamed]);
  fixture.blocker = await ensureItem(names.blocker, rootStory);
  fixture.moving = await ensureItem(names.moving, rootStory);
  fixture.reorderFirst = await ensureItem(names.reorderFirst, rootStory);
  fixture.reorderSecond = await ensureItem(names.reorderSecond, rootStory);
  fixture.hierarchyParent = await ensureItem(names.hierarchyParent, rootStory);
  fixture.hierarchyChild = await ensureItem(names.hierarchyChild, {
    parent_id: fixture.hierarchyParent.id,
    issue_type_id: fixture.implementationType.id,
  });
  fixture.landing = await ensureItem(names.landing, rootStory);
  fixture.landingConflict = await ensureItem(names.landingConflict, rootStory);
  fixture.landingDirty = await ensureItem(names.landingDirty, rootStory);
  fixture.runNow = await ensureItem(names.runNow, rootStory);
  fixture.deletable = await ensureItem(names.deletable, rootStory);
  fixture.nonRepoItem = await ensureItem(names.nonRepoItem, {
    parent_id: fixture.nonRepoModule.id,
    issue_type_id: fixture.storyType.id,
  });
}

async function openSettings(page: Page): Promise<Locator> {
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
  await page.getByRole("button", { name: "Open Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Studio settings" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function editDescription(page: Page, description: string): Promise<void> {
  const source = page.getByRole("textbox", {
    name: "Ticket description source",
  });
  const input = (await source.isVisible().catch(() => false))
    ? source
    : page.getByTestId("rich-markdown-editor-shell").locator('[contenteditable="true"]');
  await input.fill(description);
  // Leaving the editor writes the draft.
  await input.blur();
  await expect(page.getByText("Saving…")).toHaveCount(0);
  await expect(page.getByTestId("issue-description")).toContainText(description);
}

export async function selectState(page: Page, stateName: string): Promise<void> {
  const picker = page.getByTestId("state-picker");
  await picker.getByRole("button").click();
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/graphql") &&
    response.request().postDataJSON()?.operationName ===
      "TransitionWorkTrackerWorkItem"
  );
  await page.getByRole("button", { name: stateName, exact: true }).click();
  await saved;
  await expect(picker).toContainText(stateName);
}

export async function callMcpTool<TResult>(
  name: string,
  arguments_: Record<string, unknown>,
): Promise<TResult> {
  const dataDirectory = process.env.TICKETRY_E2E_DATA_DIR;
  if (!dataDirectory) throw new Error("E2E data directory was not configured");
  const result = await callSocketMcpTool(dataDirectory, name, arguments_) as {
    structuredContent?: TResult;
  };
  expect(result.structuredContent, JSON.stringify(result)).toBeTruthy();
  return result.structuredContent!;
}

export async function cleanupWorkItemsFixture() {
  for (const folder of [fixture.folder, fixture.nonRepoFolder, fixture.alternateFolder]) {
    if (folder) await rm(folder, { recursive: true, force: true });
  }
}

/** Production module tabs replace the removed Modules pane used by historical specs. */
export async function openFeatureModule(page: Page, name: string): Promise<void> {
  await page.goto("/");
  const tab = page.getByRole("tab", { name, exact: true }).last();
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("module-workspace-region")).toBeVisible();
}

/** Drag from the row gutter and observe the product drop seam before release. */
export async function dragStoryTo(page: Page, source: Locator, target: Locator, cancel = false) {
  await expect(source).toHaveAttribute("draggable", "true");
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  expect(from).toBeTruthy();
  expect(to).toBeTruthy();
  await page.mouse.move(from!.x + 6, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + 6, from!.y + from!.height / 2 + 8, { steps: 3 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + (cancel ? to!.height - 2 : 2), { steps: 8 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + (cancel ? to!.height - 3 : 3));
  await expect(page.getByTestId("ticket-drop-seam").first()).toBeVisible();
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
