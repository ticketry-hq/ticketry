import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { ModuleFileDiffDocument } from "../../src/features/agents/worktrees/generated/moduleFileDiff.documents";
import { ModuleVersionControlDocument } from "../../src/features/agents/worktrees/generated/moduleVersionControl.documents";
import { CurrentWorktreesDocument } from "../../src/features/agents/worktrees/generated/currentWorktrees.documents";
import { graphql, openWorkItem, type ModuleRow, type WorkItemRow } from "../support";
import {
  checkoutOption,
  commitFile,
  createRepository,
  createWorktree,
  discardWorktrees,
  exists,
  git,
  graphqlResponse,
  openChanges,
  openModuleTab,
  refuseOperation,
  selectState,
  removeRepository,
  worktreeFixture,
  worktreeStatus,
  type WorktreeFixture,
} from "../worktrees-and-changes-support";
import { featureSuite } from "./featureSuite";

// A restarted worker reruns beforeAll, so module tabs carry a per-run token.
const run = crypto.randomUUID().slice(0, 6);
const names = {
  module: `Worktree lifecycle ${run}`,
  nonRepoModule: `Non-repository ${run}`,
  nonRepoItem: "Work without Git isolation",
  parent: "Complete parent",
  hierarchyParent: "Complete hierarchy parent",
  hierarchyChild: "Complete hierarchy child",
  landing: "Retain committed worktree on completion",
  landingConflict: "Retain diverged worktree on completion",
  landingDirty: "Retain dirty worktree on completion",
  refusal: "Recover refused worktree writes",
  changesModule: `Changes review ${run}`,
  emptyModule: `Changes empty ${run}`,
  review: "Changes review story",
  clean: "Changes clean story",
  origin: "Changes origin story",
};

featureSuite("worktrees-and-changes", () => {
  let fixture: WorktreeFixture;
  let folder: string;
  let nonRepoFolder: string;
  let module: ModuleRow;
  let changesFolder: string;
  let emptyFolder: string;
  let changesModule: ModuleRow;
  let emptyModule: ModuleRow;
  const items: Record<string, WorkItemRow> = {};

  test.beforeAll(async ({ request }) => {
    fixture = await worktreeFixture(request);
    folder = await createRepository("worktree-lifecycle");
    nonRepoFolder = await mkdtemp(join(tmpdir(), "ticketry-worktree-no-repo-"));
    module = await fixture.module(names.module, folder);
    const nonRepoModule = await fixture.module(names.nonRepoModule, nonRepoFolder);
    for (const key of ["parent", "hierarchyParent", "landing", "landingConflict", "landingDirty"] as const) {
      items[key] = await fixture.story(names[key], module.id);
    }
    items.hierarchyChild = await fixture.story(names.hierarchyChild, items.hierarchyParent!.id, fixture.implementationTypeId);
    items.nonRepoItem = await fixture.story(names.nonRepoItem, nonRepoModule.id);
    items.refusal = await fixture.story(names.refusal, module.id);

    changesFolder = await createRepository("changes-review");
    await mkdir(join(changesFolder, "docs", "guide"), { recursive: true });
    await commitFile(changesFolder, "docs/guide/intro.md", "Intro\n", "E2E guide intro");
    await commitFile(changesFolder, "docs/guide/usage.md", "Usage\n", "E2E guide usage");
    await commitFile(changesFolder, "docs/guide/retired.md", "Retired guide\n", "E2E retired guide");
    await mkdir(join(changesFolder, "assets"));
    await writeFile(join(changesFolder, "assets", "logo.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    await git(changesFolder, "add", "assets/logo.bin");
    await git(changesFolder, "commit", "-m", "E2E binary asset");
    changesModule = await fixture.module(names.changesModule, changesFolder);
    for (const key of ["review", "clean", "origin"] as const) {
      items[key] = await fixture.story(names[key], changesModule.id);
    }
    const reviewCheckout = await createWorktree(request, items.review!.id);
    await commitFile(reviewCheckout.path!, "task-feature.txt", "Task-side committed feature\n", "E2E task feature");
    await createWorktree(request, items.clean!.id);

    emptyFolder = await createRepository("changes-empty");
    emptyModule = await fixture.module(names.emptyModule, emptyFolder);
  });

  test.afterAll(async ({ request }) => {
    await discardWorktrees(request, Object.values(items).map((item) => item.id));
    await removeRepository(folder);
    await removeRepository(nonRepoFolder);
    await removeRepository(changesFolder);
    await removeRepository(emptyFolder);
  });

  test("creates, detects changes in, and explicitly discards a real Git worktree", { tag: "@case-worktree-create-detect-discard" }, async ({ page, request }) => {
    await openModuleTab(page, names.module);
    await openWorkItem(page, names.parent);
    const worktree = page.getByTestId("worktree-block");
    const create = worktree.getByRole("button", { name: "+ Worktree" });
    await expect(create).toBeVisible();

    const created = graphqlResponse(page, "WorktreeCreate");
    await create.click();
    await created;
    await expect(worktree).toContainText(/wt\/[A-Z]+-\d+-complete-parent/);
    // Status and Discard live in the details popover (position:fixed, but a
    // DOM descendant of the worktree block).
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await expect(worktree.getByTestId("worktree-details")).toContainText("Clean");
    await expect(worktree.getByTestId("worktree-details")).toContainText("vs main");
    await expect(worktree.getByRole("button", { name: "Discard" })).toBeVisible();

    const status = await worktreeStatus(request, items.parent!.id);
    expect(status.kind).toBe("worktree");
    expect(status.path).toBeTruthy();
    await writeFile(join(status.path!, "e2e-uncommitted-change.txt"), "dirty\n");

    await page.reload();
    await expect(worktree).toContainText(/wt\/[A-Z]+-\d+-complete-parent/);
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await expect(worktree.getByTestId("worktree-details")).toContainText("Dirty");
    await worktree.getByRole("button", { name: "Discard" }).click();
    await expect(worktree).toContainText("Discard — work is thrown away?");
    await worktree.getByRole("button", { name: "Cancel" }).click();
    await expect(worktree).not.toContainText("Discard — work is thrown away?");
    await expect(worktree.getByRole("button", { name: "Discard" })).toBeVisible();

    await worktree.getByRole("button", { name: "Discard" }).click();
    const discarded = graphqlResponse(page, "WorktreeDiscard");
    await worktree.getByRole("button", { name: "Yes, discard" }).click();
    await discarded;
    await expect(create).toBeVisible();

    await page.reload();
    await expect(create).toBeVisible();
    await expect(worktree.getByRole("button", { name: "Discard" })).toHaveCount(0);
    expect((await worktreeStatus(request, items.parent!.id)).kind).toBe("none");
    expect(await exists(status.path!)).toBe(false);
  });

  test("keeps a top-level worktree when a sharing child reaches Done", { tag: "@case-worktree-shared-child-done" }, async ({ page, request }) => {
    await openModuleTab(page, names.module);
    await openWorkItem(page, names.hierarchyParent);
    let worktree = page.getByTestId("worktree-block");
    const created = graphqlResponse(page, "WorktreeCreate");
    await worktree.getByRole("button", { name: "+ Worktree" }).click();
    await created;
    await expect(worktree).toContainText(/wt\/[A-Z]+-\d+-complete-hierarchy-parent/);

    await page.getByTestId("child-issues").getByRole("button", { name: new RegExp(names.hierarchyChild) }).click();
    worktree = page.getByTestId("worktree-block");
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await expect(worktree).toContainText("Shares the worktree owned by top-level task");
    await expect(worktree.getByRole("button", { name: "+ Worktree" })).toHaveCount(0);
    await expect(worktree.getByRole("button", { name: "Discard" })).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.hierarchyChild);
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await expect(page.getByTestId("worktree-block")).toContainText("Shares the worktree owned by top-level task");
    await selectState(page, "Review");
    await selectState(page, "Done");
    await expect.poll(async () => (await worktreeStatus(request, items.hierarchyParent!.id)).kind).toBe("worktree");
    // Choosing a state clicked outside, which closed the details popover.
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await expect(page.getByTestId("worktree-block")).toContainText("Shares the worktree owned by top-level task");

    await openWorkItem(page, names.hierarchyParent);
    worktree = page.getByTestId("worktree-block");
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await worktree.getByRole("button", { name: "Discard" }).click();
    await worktree.getByRole("button", { name: "Yes, discard" }).click();
    await expect(worktree.getByRole("button", { name: "+ Worktree" })).toBeVisible();
  });

  test("keeps a committed worktree when its Story reaches Done until explicit discard", { tag: "@case-worktree-committed-done" }, async ({ page, request }) => {
    test.setTimeout(45_000);
    await openModuleTab(page, names.module);
    await openWorkItem(page, names.landing);
    const worktree = page.getByTestId("worktree-block");
    const created = graphqlResponse(page, "WorktreeCreate");
    await worktree.getByRole("button", { name: "+ Worktree" }).click();
    await created;
    await expect(worktree).toContainText(/wt\/[A-Z]+-\d+-retain-committed-worktree-on-completion/);

    const status = await worktreeStatus(request, items.landing!.id);
    expect(status).toMatchObject({ kind: "worktree", base_branch: "main", clean: true });
    expect(status.path).toBeTruthy();
    const evidenceName = "retained-worktree-e2e.txt";
    const evidence = "Retained after Work Item completion.\n";
    await commitFile(status.path!, evidenceName, evidence, "E2E retained worktree");

    await page.reload();
    await expect(worktree).toContainText("↑1");
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await expect(worktree.getByTestId("worktree-details")).toContainText("Clean");
    await selectState(page, "Implement");
    await selectState(page, "Review");
    await selectState(page, "Done");

    await expect.poll(async () => (await worktreeStatus(request, items.landing!.id)).kind, { timeout: 20_000 }).toBe("worktree");
    await expect.poll(async () => readFile(join(status.path!, evidenceName), "utf8").catch(() => null)).toBe(evidence);
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await expect(worktree.getByTestId("worktree-details")).toContainText("Completion keeps the worktree");
    await expect(worktree.getByRole("button", { name: "Discard" })).toBeVisible();
    expect(await exists(join(folder, evidenceName))).toBe(false);

    await page.reload();
    await expect(page.getByTestId("status-row")).toContainText("Done");
    const retained = page.getByTestId("worktree-block");
    await expect(retained).toContainText(status.branch!);
    await retained.getByRole("button", { name: "Show worktree details" }).click();
    await retained.getByRole("button", { name: "Discard" }).click();
    await retained.getByRole("button", { name: "Yes, discard" }).click();
    await expect(retained.getByRole("button", { name: "+ Worktree" })).toBeVisible();
    await expect.poll(() => exists(status.path!)).toBe(false);
  });

  test("keeps diverged worktree and primary checkouts independent on Done", { tag: "@case-worktree-diverged-done" }, async ({ page, request }) => {
    test.setTimeout(45_000);
    await openModuleTab(page, names.module);
    await openWorkItem(page, names.landingConflict);
    const worktree = page.getByTestId("worktree-block");
    const created = graphqlResponse(page, "WorktreeCreate");
    await worktree.getByRole("button", { name: "+ Worktree" }).click();
    await created;
    await expect(worktree).toContainText(/wt\/[A-Z]+-\d+-retain-diverged-worktree-on-completion/);

    const status = await worktreeStatus(request, items.landingConflict!.id);
    expect(status.path).toBeTruthy();
    const originalReadme = await readFile(join(folder, "README.md"), "utf8");
    await commitFile(status.path!, "README.md", "task-side conflict\n", "E2E task-side conflict");
    const primaryContents = "primary-side conflict\n";
    await commitFile(folder, "README.md", primaryContents, "E2E primary-side conflict");

    try {
      await selectState(page, "Implement");
      await selectState(page, "Review");
      await selectState(page, "Done");

      await expect.poll(async () => (await worktreeStatus(request, items.landingConflict!.id)).kind, { timeout: 20_000 }).toBe("worktree");
      await worktree.getByRole("button", { name: "Show worktree details" }).click();
      await expect(worktree.getByTestId("worktree-details")).toContainText("Completion keeps the worktree");
      expect(await readFile(join(status.path!, "README.md"), "utf8")).toBe("task-side conflict\n");
      expect(await readFile(join(folder, "README.md"), "utf8")).toBe(primaryContents);
      await expect.poll(() => exists(join(folder, ".git", "MERGE_HEAD"))).toBe(false);
    } finally {
      // Later cases compare against the original primary README.
      await commitFile(folder, "README.md", originalReadme, "E2E restore primary README");
    }
  });

  test("keeps uncommitted work when a Story reaches Done", { tag: "@case-worktree-uncommitted-done" }, async ({ page, request }) => {
    test.setTimeout(45_000);
    await openModuleTab(page, names.module);
    await openWorkItem(page, names.landingDirty);
    const worktree = page.getByTestId("worktree-block");
    const created = graphqlResponse(page, "WorktreeCreate");
    await worktree.getByRole("button", { name: "+ Worktree" }).click();
    await created;
    const status = await worktreeStatus(request, items.landingDirty!.id);
    expect(status.path).toBeTruthy();
    const protectedName = "uncommitted-retained-e2e.txt";
    const protectedContents = "Uncommitted work must survive completion.\n";
    await writeFile(join(status.path!, protectedName), protectedContents);

    await page.reload();
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await expect(worktree.getByTestId("worktree-details")).toContainText("Dirty");
    await selectState(page, "Implement");
    await selectState(page, "Review");
    await selectState(page, "Done");
    expect(await worktreeStatus(request, items.landingDirty!.id)).toMatchObject({ kind: "worktree", dirty: true, checkout_present: true });
    expect(await readFile(join(status.path!, protectedName), "utf8")).toBe(protectedContents);
    await expect.poll(() => exists(join(folder, protectedName))).toBe(false);
    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await expect(worktree.getByTestId("worktree-details")).toContainText("Dirty");
    await expect(worktree.getByRole("button", { name: "Discard" })).toBeVisible();

    await worktree.getByRole("button", { name: "Discard" }).click();
    await worktree.getByRole("button", { name: "Yes, discard" }).click();
    await expect(worktree.getByRole("button", { name: "+ Worktree" })).toBeVisible();
    await expect.poll(() => exists(status.path!)).toBe(false);
  });

  test("keeps a non-Git module usable without offering false worktree isolation", { tag: "@case-worktree-non-git-module" }, async ({ page, request }) => {
    await openModuleTab(page, names.nonRepoModule);
    await openWorkItem(page, names.nonRepoItem);
    // A module without a repository offers no worktree control at all.
    await expect(page.getByTestId("worktree-block")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ Worktree" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show worktree details" })).toHaveCount(0);
    expect((await worktreeStatus(request, items.nonRepoItem!.id)).kind).toBe("no_repo");

    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.nonRepoItem);
    await expect(page.getByTestId("worktree-block")).toHaveCount(0);
    expect(await git(nonRepoFolder, "rev-parse", "--is-inside-work-tree").catch(() => "not a repository")).toBe("not a repository");
  });
  test("recovers refused worktree create, discard and status reads", { tag: "@case-worktree-refusal-recovery" }, async ({ page, request }) => {
    await openModuleTab(page, names.module);
    await openWorkItem(page, names.refusal);
    const worktree = page.getByTestId("worktree-block");
    const create = worktree.getByRole("button", { name: "+ Worktree" });
    const refusedCreate = await refuseOperation(page, "WorktreeCreate", "Worktree create refused");
    await create.click();
    await expect(worktree).toContainText("Create failed");
    await expect(create).toBeEnabled();
    expect(refusedCreate.count()).toBe(1);
    expect((await worktreeStatus(request, items.refusal!.id)).kind).toBe("none");
    await refusedCreate.stop();
    await create.click();
    await expect(worktree).toContainText(/wt\/[A-Z]+-\d+-recover-refused-worktree-writes/);
    await expect(worktree).not.toContainText("Create failed");
    const status = await worktreeStatus(request, items.refusal!.id);
    expect(status.kind).toBe("worktree");

    const refusedStatus = await refuseOperation(page, "WorktreeStatus", "Worktree status refused");
    await page.reload();
    await expect(page.getByTestId("worktree-block")).toContainText("Could not load worktree status");
    await expect(page.getByRole("button", { name: "+ Worktree" })).toHaveCount(0);
    await refusedStatus.stop();
    await page.reload();
    await expect(worktree).toContainText(status.branch!);

    await worktree.getByRole("button", { name: "Show worktree details" }).click();
    await worktree.getByRole("button", { name: "Discard" }).click();
    const refusedDiscard = await refuseOperation(page, "WorktreeDiscard", "Worktree discard refused");
    await worktree.getByRole("button", { name: "Yes, discard" }).click();
    await expect(worktree).toContainText("Discard failed");
    expect((await worktreeStatus(request, items.refusal!.id)).kind).toBe("worktree");
    expect(await exists(status.path!)).toBe(true);
    await refusedDiscard.stop();
    await worktree.getByRole("button", { name: "Yes, discard" }).click();
    await expect(create).toBeVisible();
    await expect(worktree).not.toContainText("Discard failed");
    await page.reload();
    await expect(create).toBeVisible();
    expect((await worktreeStatus(request, items.refusal!.id)).kind).toBe("none");
    expect(await exists(status.path!)).toBe(false);
  });

  test("keeps all Changes columns usable while resizing and in a narrow window", { tag: "@case-changes-columns-resize-narrow" }, async ({ page }) => {
    const readmePath = join(changesFolder, "README.md");
    const original = await readFile(readmePath, "utf8");
    await writeFile(readmePath, `${original}Three-column Changes workspace\n`);

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openModuleTab(page, names.changesModule);
      const workspace = await openChanges(page);

      // The checkout column became the toolbar switcher; the branch inspector
      // is the third column beside files and diff.
      const files = page.getByTestId("changes-files-column");
      const diff = page.getByTestId("changes-diff-column");
      await expect(files).toBeVisible();
      await expect(diff).toBeVisible();
      await expect(page.locator('[data-pane="tasks"]')).toBeHidden();
      await workspace.getByRole("button", { name: "Branch", exact: true }).click();
      const inspector = page.getByTestId("changes-branch-inspector");
      await expect(inspector).toBeVisible();
      await files.getByRole("button", { name: "README.md" }).click();
      await expect(diff).toContainText("README.md");

      const handle = page.getByTestId("changes-diff-resize-handle");
      const drag = async (delta: number): Promise<void> => {
        const before = await handle.getAttribute("aria-valuenow");
        const box = await handle.boundingBox();
        expect(box).toBeTruthy();
        await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
        await page.mouse.down();
        await page.mouse.move(box!.x + delta, box!.y + box!.height / 2, { steps: 12 });
        await page.mouse.up();
        await expect(handle).not.toHaveAttribute("aria-valuenow", before!);
      };

      await drag(900);
      expect((await diff.boundingBox())!.width).toBeGreaterThanOrEqual(300);
      await drag(-900);
      expect((await files.boundingBox())!.width).toBeGreaterThanOrEqual(200);
      expect((await diff.boundingBox())!.width).toBeGreaterThanOrEqual(300);
      expect((await inspector.boundingBox())!.width).toBeGreaterThanOrEqual(300);

      await page.setViewportSize({ width: 700, height: 700 });
      for (const column of [files, diff, inspector]) {
        await expect(column).toBeVisible();
        expect((await column.boundingBox())!.width).toBeGreaterThan(60);
      }
      await expect(diff).toContainText("README.md");
      await expect(diff.getByRole("region", { name: "File diff content" })).toContainText("Three-column Changes workspace");
      await inspector.getByRole("button", { name: "Close branch inspector" }).click();
      await expect(inspector).toHaveCount(0);
    } finally {
      await writeFile(readmePath, original);
    }
  });

  test("reviews a long diff and resizes Changes panes entirely by keyboard", { tag: "@case-changes-long-diff-keyboard" }, async ({ page }) => {
    const readmePath = join(changesFolder, "README.md");
    const original = await readFile(readmePath, "utf8");
    const extraPaths = Array.from({ length: 60 }, (_, index) =>
      join(changesFolder, `browser-review-${String(index).padStart(2, "0")}.txt`));
    const longLine = `horizontal-${"0123456789".repeat(40)}`;
    const longPatch = Array.from({ length: 120 }, (_, index) =>
      `browser review line ${String(index).padStart(3, "0")} ${longLine}`).join("\n");
    await writeFile(readmePath, `${original}${longPatch}\n`);
    await Promise.all(extraPaths.map((path, index) => writeFile(path, `browser review fixture ${index}\n`)));

    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await openModuleTab(page, names.changesModule);
      await openChanges(page);

      const files = page.getByRole("list", { name: "Module changed files" });
      const firstFile = files.getByRole("button", { name: "browser-review-00.txt" });
      await firstFile.focus();
      await expect(firstFile).toBeFocused();
      await page.keyboard.press("End");
      const lastFile = files.getByRole("button", { name: "README.md" });
      await expect(lastFile).toBeFocused();
      expect(await lastFile.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
      // The changed-file list scrolls inside its own column.
      expect(await files.evaluate((element) => element.parentElement!.scrollTop)).toBeGreaterThan(0);
      const resize = page.getByRole("separator", { name: "Resize changed files and diff" });
      await page.keyboard.press("Tab");
      await expect(resize).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(lastFile).toBeFocused();
      const readme = files.getByRole("button", { name: "README.md" });
      await readme.focus();
      await page.keyboard.press("Enter");
      await expect(readme).toHaveAttribute("aria-pressed", "true");
      await expect(readme).toBeFocused();

      const diff = page.getByRole("region", { name: "File diff content" });
      await expect(diff).toBeVisible();
      await expect(diff.getByTestId("raw-patch")).toHaveCount(0);
      await expect(diff.getByTestId("patch-viewer")).toBeVisible();
      await diff.focus();
      await expect(diff).toBeFocused();
      await page.keyboard.press("PageDown");
      expect(await diff.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
      await expect.poll(() => diff.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => diff.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await page.keyboard.press("Home");
      await expect.poll(() => diff.evaluate((element) => element.scrollTop)).toBe(0);
      await page.keyboard.press("End");
      await expect.poll(() => diff.evaluate((element) =>
        element.scrollHeight - element.clientHeight - element.scrollTop)).toBe(0);

      // Tab leaves the reading region for the status bar's first control.
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Open Module Manager", exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(diff).toBeFocused();

      await resize.focus();
      await expect(resize).toBeFocused();
      const before = Number(await resize.getAttribute("aria-valuenow"));
      const filesColumn = page.getByTestId("changes-files-column");
      const ordinaryWidthBefore = (await filesColumn.boundingBox())!.width;
      const minimum = Number(await resize.getAttribute("aria-valuemin"));
      const maximum = Number(await resize.getAttribute("aria-valuemax"));
      await page.keyboard.press("ArrowRight");
      expect(await resize.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
      await expect.poll(async () => Number(await resize.getAttribute("aria-valuenow"))).not.toBe(before);
      await expect.poll(async () => (await filesColumn.boundingBox())!.width).not.toBe(ordinaryWidthBefore);
      for (let press = 0; press < 50; press += 1) await page.keyboard.press("ArrowRight");
      const ordinaryBound = Number(await resize.getAttribute("aria-valuenow"));
      expect(ordinaryBound).toBeGreaterThanOrEqual(minimum);
      expect(ordinaryBound).toBeLessThanOrEqual(maximum);
      await page.keyboard.press("Home");
      const homeBound = Number(await resize.getAttribute("aria-valuenow"));
      expect(homeBound).toBeGreaterThanOrEqual(minimum);
      expect(homeBound).toBeLessThanOrEqual(ordinaryBound);
      await page.keyboard.press("End");
      const endBound = Number(await resize.getAttribute("aria-valuenow"));
      expect(endBound).toBeGreaterThanOrEqual(homeBound);
      expect(endBound).toBeLessThanOrEqual(maximum);

      await page.setViewportSize({ width: 700, height: 700 });
      await expect(resize).toBeVisible();
      await resize.focus();
      const narrowWidthBefore = (await filesColumn.boundingBox())!.width;
      for (let press = 0; press < 50; press += 1) await page.keyboard.press("ArrowLeft");
      const narrowBound = Number(await resize.getAttribute("aria-valuenow"));
      expect(narrowBound).toBeGreaterThanOrEqual(minimum);
      expect(narrowBound).toBeLessThanOrEqual(maximum);
      expect((await filesColumn.boundingBox())!.width).not.toBe(narrowWidthBefore);
      await expect(resize).toBeFocused();
    } finally {
      await writeFile(readmePath, original);
      await Promise.all(extraPaths.map((path) => rm(path, { force: true })));
    }
  });

  test("keeps keyboard scrolling on the raw diff fallback", { tag: "@case-changes-raw-diff-fallback" }, async ({ page }) => {
    const readmePath = join(changesFolder, "README.md");
    const original = await readFile(readmePath, "utf8");
    const longLine = `raw-horizontal-${"abcdefghij".repeat(40)}`;
    const longPatch = Array.from({ length: 100 }, (_, index) =>
      `raw fallback line ${String(index).padStart(3, "0")} ${longLine}`).join("\n");
    await writeFile(readmePath, `${original}${longPatch}\n`);

    try {
      // The rendered patch viewer is a lazily loaded chunk; refusing it at the
      // network boundary leaves the raw patch fallback in place.
      await page.route(/PatchViewer[^/]*\.(tsx|js)/, (route) => route.abort());
      await openModuleTab(page, names.changesModule);
      await openChanges(page);
      await page.getByRole("button", { name: "README.md" }).click();

      const diff = page.getByRole("region", { name: "File diff content" });
      await expect(diff.getByTestId("raw-patch")).toBeVisible();
      await expect(diff.getByTestId("raw-patch")).toContainText("raw fallback line 099");
      await diff.focus();
      await page.keyboard.press("PageDown");
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => diff.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      await expect.poll(() => diff.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      await expect(diff).toBeFocused();
    } finally {
      await writeFile(readmePath, original);
    }
  });

  test("keeps the full Changes column reachable in a short window", { tag: "@case-changes-short-window-column" }, async ({ page }) => {
    const readmePath = join(changesFolder, "README.md");
    const readme = await readFile(readmePath);
    const extraPaths = Array.from({ length: 16 }, (_, index) => join(changesFolder, `short-window-${String(index).padStart(2, "0")}.txt`));
    await writeFile(readmePath, "Ticketry browser E2E\nChanged\n");
    await Promise.all(extraPaths.map((path, index) => writeFile(path, `short window ${index}\n`)));
    try {
      // The terminal panel is not presented over independent Changes review, so
      // a shorter window stands in for the panel's lost height.
      await page.setViewportSize({ width: 720, height: 360 });
      await openModuleTab(page, names.changesModule);
      const workspace = await openChanges(page);

      const column = page.getByTestId("changes-files-column");
      await workspace.getByRole("button", { name: /^Commit & push on / }).click();
      const confirmation = workspace.getByRole("dialog", { name: "Confirm Changes action" });
      const changedFile = column.getByRole("button", { name: "short-window-15.txt" });
      const list = column.getByRole("list", { name: "Module changed files" });

      await expect(confirmation).toBeVisible();
      await changedFile.scrollIntoViewIfNeeded();
      await expect(changedFile).toBeVisible();
      await expect.poll(() => list.evaluate((node) => node.parentElement!.scrollTop)).toBeGreaterThan(0);
      await list.evaluate((node) => node.parentElement!.scrollTo({ top: 0 }));
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button", { name: "Cancel" }).click();
      await expect(confirmation).toHaveCount(0);
      // Cancelling the stacked action wrote nothing.
      expect(await git(changesFolder, "status", "--porcelain", "README.md")).toContain("README.md");
    } finally {
      await writeFile(readmePath, readme);
      await Promise.all(extraPaths.map((path) => rm(path, { force: true })));
    }
  });

  test("scrolls to and opens the last checkout in a short window", { tag: "@case-changes-short-window-last-checkout" }, async ({ page, request }) => {
    test.setTimeout(60_000);
    const overflow: WorkItemRow[] = [];
    for (let index = 0; index < 12; index += 1) {
      const story = await fixture.story(`Overflow checkout ${index + 1}`, changesModule.id, undefined, request);
      await createWorktree(request, story.id);
      overflow.push(story);
    }
    const last = overflow.at(-1)!;
    try {
      await page.setViewportSize({ width: 720, height: 480 });
      await openModuleTab(page, names.changesModule);
      const workspace = await openChanges(page);

      await workspace.getByRole("button", { name: "Choose checkout" }).click();
      const checkouts = workspace.getByRole("listbox", { name: "Current worktree checkouts" });
      const lastCheckout = checkoutOption(checkouts, last);
      await expect(checkouts.getByRole("option")).toHaveCount(15);
      await expect.poll(() => checkouts.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      await lastCheckout.scrollIntoViewIfNeeded();
      await expect(lastCheckout).toBeVisible();
      await expect.poll(() => checkouts.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

      const selected = page.waitForRequest((request) =>
        request.url().endsWith("/graphql")
        && request.postDataJSON()?.operationName === "WorktreeChanges"
        && request.postDataJSON()?.variables?.taskId === last.id);
      await lastCheckout.click();
      await selected;
      await expect(page.getByTestId("task-worktree-changes")).toBeVisible();
    } finally {
      await discardWorktrees(request, overflow.map((story) => story.id));
    }
  });

  test("[overhaul-web-15] traverses Changes controls in visible DOM order", { tag: "@case-overhaul-web-15" }, async ({ page }) => {
    const readmePath = join(changesFolder, "README.md");
    const original = await readFile(readmePath, "utf8");
    // A real dirty module checkout offers the confirmed stacked primary action.
    await writeFile(readmePath, `${original}Keyboard traversal fixture\n`);
    try {
      await openModuleTab(page, names.changesModule);
      const entry = page.getByTestId("workspace-tab-changes");
      await entry.focus();
      await page.keyboard.press("Enter");

      const workspace = page.getByRole("region", { name: "Changes workspace" });
      await expect(workspace).toBeVisible();
      const switcher = workspace.getByRole("button", { name: "Choose checkout" });
      await expect(switcher).toBeFocused();

      await page.keyboard.press("Enter");
      const current = workspace.getByRole("option", { name: "Open Module checkout Changes" });
      await expect(current).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(switcher).toBeFocused();

      const branch = workspace.getByRole("button", { name: "Branch", exact: true });
      for (let step = 0; step < 8; step += 1) {
        if (await branch.evaluate((element) => element === document.activeElement)) break;
        await page.keyboard.press("Tab");
      }
      await expect(branch).toBeFocused();
      await page.keyboard.press("Enter");
      const closeInspector = workspace.getByRole("button", { name: "Close branch inspector" });
      await expect(closeInspector).toBeFocused();
      await page.keyboard.press("Tab");
      const statusSummary = workspace.locator("summary").filter({ hasText: "Status" });
      await expect(statusSummary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(statusSummary.locator("xpath=..")).not.toHaveAttribute("open", "");
      await page.keyboard.press("Enter");
      await expect(statusSummary.locator("xpath=..")).toHaveAttribute("open", "");
      await page.keyboard.press("Escape");
      await expect(branch).toBeFocused();

      const primary = workspace.locator('button[aria-label*=" on "]').first();
      await primary.focus();
      await page.keyboard.press("Enter");
      const confirmation = workspace.getByRole("dialog", { name: "Confirm Changes action" });
      await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(primary).toBeFocused();

      await page.keyboard.press("Escape");
      const reopenedEntry = page.getByTestId("workspace-tab-changes");
      await expect(reopenedEntry).toBeFocused();
      await page.keyboard.press("Space");
      await expect(workspace).toBeVisible();
      await expect(workspace.getByRole("button", { name: "Choose checkout" })).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(workspace).toHaveCount(0);
    } finally {
      await writeFile(readmePath, original);
    }
  });

  test("returns from independent Changes review to the originating ticket", { tag: "@case-changes-origin-return" }, async ({ page }) => {
    await openModuleTab(page, names.changesModule);
    await openWorkItem(page, names.origin);
    const tabs = page.getByRole("tablist", { name: "Workspace tabs" });
    await expect(tabs.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");

    const workspace = await openChanges(page);
    await expect(page.getByTestId("workspace-tab-changes")).toHaveAttribute("aria-selected", "true");
    await expect(workspace.getByTestId("module-version-control")).toBeVisible();
    await workspace.getByRole("button", { name: "Choose checkout" }).click();
    const checkouts = workspace.getByRole("listbox", { name: "Current worktree checkouts" });
    await checkoutOption(checkouts, items.review!).click();
    const task = workspace.getByTestId("task-worktree-changes");
    await expect(task).toContainText("Includes committed work from the recorded base.");
    const feature = task.getByRole("button", { name: "task-feature.txt" });
    await feature.click();
    await expect(task.getByRole("region", { name: "File diff content" })).toContainText("Task-side committed feature");

    // The originating module tab returns to the exact planning origin.
    await page.getByRole("tablist", { name: "Project module tabs" }).getByRole("tab", { name: names.changesModule, exact: true }).click();
    await expect(workspace).toHaveCount(0);
    await expect(page.getByTestId("issue-name")).toContainText(names.origin);
    await expect(tabs.getByRole("tab", { name: "Details", exact: true })).toHaveAttribute("aria-selected", "true");

    // Escape outside a Changes popup also leaves review.
    await openChanges(page);
    await page.keyboard.press("Escape");
    await expect(workspace).toHaveCount(0);
    await expect(page.getByTestId("workspace-tab-changes")).toBeFocused();
    await expect(page.getByTestId("issue-name")).toContainText(names.origin);

    // Review state is not restored by reload: the origin ticket comes back
    // with Details, outside the Changes workspace.
    await page.reload();
    await expect(page.getByTestId("issue-name")).toContainText(names.origin);
    await expect(page.getByTestId("workspace-tab-changes")).toHaveAttribute("aria-selected", "false");

    // A ticket's branch chip opens that ticket's own Changes surface.
    await openWorkItem(page, names.review);
    const worktree = page.getByTestId("worktree-block");
    await worktree.getByRole("button", { name: /^View changes on wt\// }).click();
    await expect(tabs.getByRole("tab", { name: "Changes", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("workspace-changes-surface").getByTestId("task-worktree-changes")).toContainText("task-feature.txt");
  });

  test("navigates checkouts with local keys and keeps the module checkout first", { tag: "@case-changes-checkout-keyboard" }, async ({ page, request }) => {
    await openModuleTab(page, names.changesModule);
    const entry = page.getByTestId("workspace-tab-changes");
    await entry.focus();
    await page.keyboard.press("Enter");
    const workspace = page.getByRole("region", { name: "Changes workspace" });
    const trigger = workspace.getByRole("button", { name: "Choose checkout" });
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText("Module checkout");

    await page.keyboard.press("Enter");
    const checkouts = workspace.getByRole("listbox", { name: "Current worktree checkouts" });
    const moduleOption = checkouts.getByRole("option", { name: "Open Module checkout Changes" });
    const reviewOption = checkoutOption(checkouts, items.review!);
    const cleanOption = checkoutOption(checkouts, items.clean!);
    await expect(checkouts.getByRole("option")).toHaveCount(3);
    await expect(checkouts.getByRole("option").first()).toHaveAccessibleName("Open Module checkout Changes");
    await expect(moduleOption).toBeFocused();
    await expect(moduleOption).toHaveAttribute("aria-selected", "true");
    await expect(reviewOption).toContainText(/wt\//);
    await page.keyboard.press("ArrowDown");
    await expect(reviewOption).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(cleanOption).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(cleanOption).toBeFocused();
    await page.keyboard.press("Home");
    await expect(moduleOption).toBeFocused();
    await page.keyboard.press("End");
    await expect(cleanOption).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(reviewOption).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(checkouts).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(workspace.getByTestId("module-version-control")).toBeVisible();

    await page.keyboard.press("Enter");
    await page.keyboard.press("End");
    await page.keyboard.press("Space");
    await expect(checkouts).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toContainText(names.clean);
    const task = workspace.getByTestId("task-worktree-changes");
    await expect(task.getByRole("region", { name: "Cumulative changed files empty" })).toHaveText("No cumulative changes from the recorded base.");

    await page.keyboard.press("Enter");
    await expect(cleanOption).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(trigger).toContainText("Module checkout");
    await expect(workspace.getByTestId("module-version-control")).toBeVisible();

    const listed = (await graphql(request, CurrentWorktreesDocument, { moduleId: changesModule.id.replaceAll("-", "") })).worktrees.nodes;
    expect(listed.map((node) => node.issue?.name).sort()).toEqual([names.clean, names.review].sort());
    await page.reload();
    await openModuleTab(page, names.changesModule);
    await openChanges(page);
    await workspace.getByRole("button", { name: "Choose checkout" }).click();
    await expect(checkouts.getByRole("option")).toHaveCount(3);
    await expect(checkoutOption(checkouts, items.clean!)).toContainText("clean");
  });

  test("reports empty and failed checkout lists while the module checkout stays reachable", { tag: "@case-changes-checkout-recovery" }, async ({ page }) => {
    await openModuleTab(page, names.emptyModule);
    let workspace = await openChanges(page);
    await expect(workspace.getByRole("region", { name: "Module changed files empty" })).toHaveText("No module changes from the selected baseline.");
    await expect(workspace.getByTestId("changes-diff-column")).toContainText("Select a file to review its diff.");
    await workspace.getByRole("button", { name: "Choose checkout" }).click();
    const checkouts = workspace.getByRole("listbox", { name: "Current worktree checkouts" });
    await expect(checkouts.getByRole("option")).toHaveCount(1);
    await expect(workspace.getByText("No current task worktrees.")).toBeVisible();
    await page.keyboard.press("Escape");

    const refused = await refuseOperation(page, "CurrentWorktrees", "Worktree list refused");
    await openModuleTab(page, names.changesModule);
    workspace = await openChanges(page);
    await workspace.getByRole("button", { name: "Choose checkout" }).click();
    await expect(workspace.getByRole("alert").filter({ hasText: "Unable to load worktree checkouts." })).toBeVisible();
    await expect(checkouts.getByRole("option")).toHaveCount(1);
    await checkouts.getByRole("option", { name: "Open Module checkout Changes" }).click();
    await expect(workspace.getByTestId("module-version-control")).toBeVisible();
    expect(refused.count()).toBeGreaterThan(0);

    await refused.stop();
    await page.reload();
    await openModuleTab(page, names.changesModule);
    workspace = await openChanges(page);
    await workspace.getByRole("button", { name: "Choose checkout" }).click();
    await expect(checkoutOption(checkouts, items.review!)).toBeVisible();
    await expect(workspace.getByText("Unable to load worktree checkouts.")).toHaveCount(0);
  });

  test("opens the branch inspector, recovers a refused commit and keeps the committed result", { tag: "@case-changes-branch-inspector" }, async ({ page, request }) => {
    const notePath = join(emptyFolder, "inspector-note.txt");
    await writeFile(notePath, "Commit from the branch inspector\n");
    await openModuleTab(page, names.emptyModule);
    const workspace = await openChanges(page);
    const branch = workspace.getByRole("button", { name: "Branch", exact: true });
    await expect(branch).toHaveAttribute("aria-pressed", "false");
    await branch.click();
    const inspector = workspace.getByTestId("changes-branch-inspector");
    await expect(inspector).toBeVisible();
    await expect(branch).toHaveAttribute("aria-pressed", "true");
    await expect(inspector.getByRole("button", { name: "Close branch inspector" })).toBeFocused();
    await expect(inspector).toContainText("uncommitted changes");
    await expect(inspector).toContainText("main");
    await page.keyboard.press("Escape");
    await expect(inspector).toHaveCount(0);
    await expect(branch).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(inspector).toBeVisible();

    const refused = await refuseOperation(page, "ModuleCheckoutCommit", "Module commit refused");
    await inspector.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(workspace.getByRole("alert").filter({ hasText: "Module commit refused" })).toBeVisible();
    expect(await git(emptyFolder, "status", "--porcelain")).toContain("inspector-note.txt");
    await refused.stop();
    await inspector.getByRole("button", { name: "Commit", exact: true }).click();
    await expect(inspector.getByRole("status").filter({ hasText: /^Committed as / })).toBeVisible();
    await expect(inspector).toContainText("clean");
    await expect(workspace.getByRole("alert")).toHaveCount(0);
    expect(await git(emptyFolder, "status", "--porcelain")).toBe("");
    expect(await git(emptyFolder, "log", "--name-only", "-1", "--format=")).toContain("inspector-note.txt");
    const checkout = (await graphql(request, ModuleVersionControlDocument, { moduleId: emptyModule.id })).module_version_control.checkout;
    expect(checkout).toMatchObject({ dirty: false });

    await page.reload();
    await openModuleTab(page, names.emptyModule);
    await openChanges(page);
    await workspace.getByRole("button", { name: "Branch", exact: true }).click();
    await expect(inspector).toContainText("clean");
    await expect(inspector.getByRole("button", { name: "Commit", exact: true })).toBeDisabled();
    await expect(workspace.getByRole("button", { name: /^Commit & push on / })).toBeDisabled();
    await inspector.getByRole("button", { name: "Close branch inspector" }).click();
    await expect(inspector).toHaveCount(0);
    await expect(branch).toBeFocused();
  });

  test("moves through changed files by keyboard without selecting on focus", { tag: "@case-changes-file-navigation" }, async ({ page, request }) => {
    const changed = {
      readme: join(changesFolder, "README.md"),
      intro: join(changesFolder, "docs", "guide", "intro.md"),
      usage: join(changesFolder, "docs", "guide", "usage.md"),
    };
    const originals = Object.fromEntries(await Promise.all(Object.entries(changed).map(async ([key, path]) => [key, await readFile(path, "utf8")])));
    await Promise.all(Object.entries(changed).map(([key, path]) => writeFile(path, `${originals[key]}navigation ${key}\n`)));
    try {
      await openModuleTab(page, names.changesModule);
      await page.getByTestId("workspace-tab-changes").focus();
      await page.keyboard.press("Enter");
      const workspace = page.getByRole("region", { name: "Changes workspace" });
      const files = workspace.getByRole("list", { name: "Module changed files" });
      const directory = files.getByRole("button", { name: "docs/guide", exact: true });
      const intro = files.getByRole("button", { name: "docs/guide/intro.md", exact: true });
      const usage = files.getByRole("button", { name: "docs/guide/usage.md", exact: true });
      const readme = files.getByRole("button", { name: "README.md", exact: true });
      const heading = workspace.getByTestId("changes-diff-column").getByRole("heading", { level: 3 });

      // Down from the toolbar enters the file tree at its first row.
      const trigger = workspace.getByRole("button", { name: "Choose checkout" });
      await expect(trigger).toBeFocused();
      await expect(readme).toBeVisible();
      await page.keyboard.press("ArrowDown");
      await expect(directory).toBeFocused();
      await expect(directory).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("ArrowLeft");
      await expect(directory).toHaveAttribute("aria-expanded", "false");
      await expect(intro).toHaveCount(0);
      await page.keyboard.press("ArrowRight");
      await expect(directory).toHaveAttribute("aria-expanded", "true");
      await page.keyboard.press("Enter");
      await expect(directory).toHaveAttribute("aria-expanded", "false");
      await page.keyboard.press("Space");
      await expect(directory).toHaveAttribute("aria-expanded", "true");

      await page.keyboard.press("ArrowDown");
      await expect(intro).toBeFocused();
      await expect(intro).toHaveAttribute("aria-pressed", "false");
      await expect(heading).toHaveText("No file selected");
      await page.keyboard.press("Enter");
      await expect(intro).toHaveAttribute("aria-pressed", "true");
      await expect(heading).toHaveText("docs/guide/intro.md");
      await page.keyboard.press("ArrowDown");
      await expect(usage).toBeFocused();
      await expect(intro).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Space");
      await expect(usage).toHaveAttribute("aria-pressed", "true");
      await expect(heading).toHaveText("docs/guide/usage.md");
      await page.keyboard.press("End");
      await expect(readme).toBeFocused();
      await page.keyboard.press("Home");
      await expect(directory).toBeFocused();
      await page.keyboard.press("ArrowUp");
      await expect(trigger).toBeFocused();

      await usage.focus();
      await page.keyboard.press("ArrowRight");
      const diff = workspace.getByRole("region", { name: "File diff content" });
      await expect(diff).toBeFocused();
      await expect(diff).toContainText("navigation usage");
      await page.keyboard.press("ArrowLeft");
      await expect(usage).toBeFocused();

      const next = workspace.getByRole("button", { name: "Next changed file" });
      const previous = workspace.getByRole("button", { name: "Previous changed file" });
      await readme.click();
      const total = (await graphql(request, ModuleVersionControlDocument, { moduleId: changesModule.id })).module_version_control.checkout.files;
      expect(total.map((file) => file.path).sort()).toEqual(["README.md", "docs/guide/intro.md", "docs/guide/usage.md"]);
      const readmeIndex = total.findIndex((file) => file.path === "README.md");
      await next.click();
      await expect(heading).toHaveText(total[(readmeIndex + 1) % total.length]!.path);
      await previous.click();
      await expect(heading).toHaveText("README.md");

      // File selection is remembered per checkout while switching checkouts.
      await trigger.click();
      await checkoutOption(workspace.getByRole("listbox", { name: "Current worktree checkouts" }), items.review!).click();
      await expect(workspace.getByTestId("task-worktree-changes")).toBeVisible();
      await trigger.click();
      await workspace.getByRole("option", { name: "Open Module checkout Changes" }).click();
      await expect(heading).toHaveText("README.md");
      await expect(readme).toHaveAttribute("aria-pressed", "true");

      await page.reload();
      await openModuleTab(page, names.changesModule);
      await openChanges(page);
      for (const row of [directory, intro, usage, readme]) await expect(row).toBeVisible();
    } finally {
      await Promise.all(Object.entries(changed).map(([key, path]) => writeFile(path, originals[key]!)));
    }
  });

  test("shows binary, deleted and refused diffs in one stable reading region", { tag: "@case-changes-diff-states" }, async ({ page, request }) => {
    const binaryPath = join(changesFolder, "assets", "logo.bin");
    const retiredPath = join(changesFolder, "docs", "guide", "retired.md");
    const binary = await readFile(binaryPath);
    await writeFile(binaryPath, Buffer.from([0, 9, 8, 7, 0, 254, 253]));
    await rm(retiredPath);
    try {
      await openModuleTab(page, names.changesModule);
      const workspace = await openChanges(page);
      const files = workspace.getByRole("list", { name: "Module changed files" });
      const diff = workspace.getByRole("region", { name: "File diff content" });
      await expect(diff).toHaveText("Select a file to review its diff.");

      await files.getByRole("button", { name: "assets/logo.bin", exact: true }).click();
      await expect(diff).toContainText("Binary file; no text diff is available.");
      await expect(files.getByRole("listitem", { name: /^docs\/guide\/retired\.md: / })).toBeVisible();

      const refused = await refuseOperation(page, "ModuleFileDiff", "File diff refused");
      await files.getByRole("button", { name: "docs/guide/retired.md", exact: true }).click();
      await expect(diff.getByRole("alert")).toHaveText("Unable to load this file diff.");
      await expect(diff).toBeVisible();
      await refused.stop();
      await files.getByRole("button", { name: "assets/logo.bin", exact: true }).click();
      await expect(diff).toContainText("Binary file; no text diff is available.");
      await files.getByRole("button", { name: "docs/guide/retired.md", exact: true }).click();
      await expect(diff).toContainText("Retired guide");
      await expect(diff.getByRole("alert")).toHaveCount(0);

      const authoritative = (await graphql(request, ModuleFileDiffDocument, { moduleId: changesModule.id, path: "docs/guide/retired.md" })).module_file_diff;
      expect(authoritative.binary).toBe(false);
      expect(authoritative.patch).toContain("-Retired guide");
      const binaryDiff = (await graphql(request, ModuleFileDiffDocument, { moduleId: changesModule.id, path: "assets/logo.bin" })).module_file_diff;
      expect(binaryDiff.binary).toBe(true);

      await page.reload();
      await openModuleTab(page, names.changesModule);
      await openChanges(page);
      await files.getByRole("button", { name: "docs/guide/retired.md", exact: true }).click();
      await expect(diff).toContainText("Retired guide");
    } finally {
      await writeFile(binaryPath, binary);
      await git(changesFolder, "checkout", "--", "docs/guide/retired.md");
    }
  });
  test("keeps the review return path usable when the module checkout read fails", { tag: "@case-changes-read-recovery" }, async ({ page }) => {
    await openModuleTab(page, names.changesModule);
    await openWorkItem(page, names.origin);
    const refused = await refuseOperation(page, "ModuleVersionControl", "Module checkout read refused");
    const workspace = await openChanges(page);
    await expect(workspace.getByRole("alert").filter({ hasText: "Module checkout read refused" })).toBeVisible();
    await expect(workspace.getByTestId("changes-files-column")).toContainText("Loading changes...");
    await expect(workspace.getByRole("list", { name: "Module changed files" })).toHaveCount(0);
    expect(refused.count()).toBeGreaterThan(0);

    await page.getByRole("tablist", { name: "Project module tabs" }).getByRole("tab", { name: names.changesModule, exact: true }).click();
    await expect(workspace).toHaveCount(0);
    await expect(page.getByTestId("issue-name")).toContainText(names.origin);

    await refused.stop();
    await openChanges(page);
    await expect(workspace.getByRole("region", { name: "Module changed files empty" })).toHaveText("No module changes from the selected baseline.");
    await expect(workspace.getByRole("alert")).toHaveCount(0);
  });

  test("commits and pushes a confirmed stacked action to a real remote", { tag: "@case-changes-stacked-publish" }, async ({ page, request }) => {
    const publishFolder = await createRepository("changes-publish");
    const remote = await mkdtemp(join(tmpdir(), "ticketry-changes-remote-"));
    try {
      await git(remote, "init", "--bare", "-b", "main");
      await git(publishFolder, "remote", "add", "origin", remote);
      await git(publishFolder, "push", "-u", "origin", "main");
      const publishModule = `Changes publish ${run}`;
      await fixture.module(publishModule, publishFolder, request);
      await writeFile(join(publishFolder, "published.txt"), "Published through Changes\n");

      await openModuleTab(page, publishModule);
      const workspace = await openChanges(page);
      const primary = workspace.getByRole("button", { name: "Commit & push on main" });
      await primary.click();
      const confirmation = workspace.getByRole("dialog", { name: "Confirm Changes action" });
      await expect(confirmation).toContainText("will publish 1 commit");
      await confirmation.getByRole("button", { name: "Confirm" }).click();
      await expect(workspace.getByRole("status").filter({ hasText: "Committed and pushed." })).toBeVisible();
      await expect(confirmation).toHaveCount(0);
      await expect(workspace.getByRole("region", { name: "Module changed files empty" })).toBeVisible();
      await expect(primary).toBeDisabled();

      const local = (await git(publishFolder, "rev-parse", "HEAD")).trim();
      expect((await git(remote, "rev-parse", "main")).trim()).toBe(local);
      expect(await git(remote, "show", "--name-only", "--format=", "main")).toContain("published.txt");
      await page.reload();
      await openModuleTab(page, publishModule);
      await openChanges(page);
      await expect(workspace.getByRole("region", { name: "Module changed files empty" })).toBeVisible();
    } finally {
      await removeRepository(publishFolder);
      await removeRepository(remote);
    }
  });
});
