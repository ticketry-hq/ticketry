import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { linkModuleFolder, openModule, openWorkItem, responseJson } from "./support";

/**
 * The real-browser acceptance path for shipping a checkout (CODING-961/985).
 *
 * Both checkout kinds are driven through the visible UI against a *real* git
 * repository and a *real* remote — a bare repository on disk that git dials and
 * transfers objects to — and afterwards the remote is asked what arrived. The
 * pull-request leg is deliberately not here: it would need the user's GitHub
 * login, which no hermetic suite can hold. It is covered by the backend's
 * `gh`-substituted cases and the numbered gate's `[overhaul-201]`.
 */

type ApiRow = { id: string; name: string };
type ProjectRow = ApiRow & { slug: string };
type ModuleRow = ApiRow & { sequence_id: number };
type WorkItemRow = ApiRow & { sequence_id: number };

const MODULE_NAME = "Source Control Module";
const WORK_ITEM_NAME = "Ship a worktree change";

function git(args: string[], cwd: string): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
}

/** What the bare remote's copy of ``branch`` points at, or "" if absent. */
function remoteSha(remote: string, branch: string): string {
  return git(
    ["for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`],
    remote,
  ).trim();
}

test.describe.serial("Source control — shipping a checkout", () => {
  let repo = "";
  let remote = "";
  let worktreePath = "";
  let moduleRow!: ModuleRow;
  let workItem!: WorkItemRow;

  test.beforeAll(async ({ request }) => {
    repo = await mkdtemp(join(tmpdir(), "ticketry-source-control-repo-"));
    remote = await mkdtemp(join(tmpdir(), "ticketry-source-control-remote-"));

    git(["init", "--bare", "-b", "main", "."], remote);
    git(["init", "-b", "main", "."], repo);
    git(["config", "user.email", "e2e@example.com"], repo);
    git(["config", "user.name", "Ticketry E2E"], repo);
    git(["config", "commit.gpgsign", "false"], repo);
    await writeFile(join(repo, "README.md"), "one\ntwo\nthree\n");
    git(["add", "."], repo);
    git(["commit", "-m", "init"], repo);
    git(["remote", "add", "origin", remote], repo);
    git(["push", "--quiet", "origin", "refs/heads/main:refs/heads/main"], repo);
    git(["remote", "set-head", "origin", "main"], repo);

    const projects = await responseJson<ProjectRow[]>(
      await request.get("/api/work-tracker/projects"),
    );
    const project =
      projects.find((row) => row.slug === "CDN") ??
      (await responseJson<ProjectRow>(
        await request.post("/api/work-tracker/projects", {
          data: { name: "Coding", slug: "CDN", description: "" },
        }),
      ));
    const issueTypes = await responseJson<ApiRow[]>(
      await request.get(
        `/api/work-tracker/projects/${project.id}/issue-types`,
      ),
    );
    const moduleType = issueTypes.find((row) => row.name === "Module");
    const storyType = issueTypes.find((row) => row.name === "Story");
    expect(moduleType, "the seeded module issue type").toBeTruthy();
    expect(storyType, "the seeded Story issue type").toBeTruthy();

    moduleRow = await responseJson<ModuleRow>(
      await request.post(`/api/work-tracker/projects/${project.id}/modules`, {
        data: { name: MODULE_NAME, issue_type_id: moduleType!.id },
      }),
    );
    workItem = await responseJson<WorkItemRow>(
      await request.post(
        `/api/work-tracker/projects/${project.id}/work-items`,
        {
          data: {
            name: WORK_ITEM_NAME,
            parent_id: moduleRow.id,
            issue_type_id: storyType!.id,
          },
        },
      ),
    );
    await linkModuleFolder(request, moduleRow.id, repo);
  });

  test.afterAll(async ({ request }) => {
    if (workItem) {
      await request.post(
        `/api/worktrees/${workItem.id}/discard?module_id=${moduleRow.id}`,
      );
    }
    for (const path of [repo, remote]) {
      if (path) await rm(path, { recursive: true, force: true });
    }
  });

  test("commits and pushes the module base checkout", async ({ page }) => {
    await writeFile(join(repo, "README.md"), "one\ntwo\nthree\nfour\n");
    await writeFile(join(repo, "release.sh"), "set -euo pipefail\n");

    await openModule(page, MODULE_NAME);
    await page.getByRole("tab", { name: "Changes" }).click();

    // The review reads the module's own folder: both changes, with counts.
    const panel = page.getByTestId("changes-panel");
    await expect(panel).toHaveAttribute("data-checkout", "module");
    await expect(page.getByRole("option", { name: /README\.md/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /release\.sh/ })).toBeVisible();

    // One file's working-tree diff, read in place.
    await page.getByRole("option", { name: /README\.md/ }).click();
    await expect(page.getByTestId("changes-panel")).toContainText("+four");

    // The module checkout leads with the sync flow.
    const footer = page.getByTestId("action-footer");
    await expect(footer).toHaveAttribute("data-primary-action", "commit_push");
    await footer.getByRole("button", { name: "Commit & push" }).click();

    // The confirmation shows this checkout's branch, remote, and count.
    const confirmation = page.getByTestId("push-confirmation");
    await expect(confirmation).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("push-confirmation-branch")).toHaveText("main");
    await expect(page.getByTestId("push-confirmation-remote")).toHaveText("origin");
    await expect(page.getByTestId("push-confirmation-commits")).toHaveText("1");
    await confirmation.getByRole("button", { name: "Push to origin" }).click();

    // Every step reports its own outcome, in the order it ran.
    for (const step of ["stage", "generate_message", "commit", "push"]) {
      await expect(page.getByTestId(`action-step-${step}`)).toHaveAttribute(
        "data-state",
        "ok",
      );
    }
    await expect(page.getByTestId("action-outcome")).toContainText(
      "pushed to origin/main",
    );

    // The remote is the witness: the commit really arrived on it, and it
    // carries both changed files.
    const head = git(["rev-parse", "HEAD"], repo).trim();
    expect(remoteSha(remote, "main")).toBe(head);
    expect(git(["show", "--name-only", "--format=", "HEAD"], repo)).toContain(
      "release.sh",
    );

    // The panel re-read the checkout it just rewrote.
    await expect(page.getByTestId("changes-panel")).toContainText(
      "This checkout matches its last commit.",
    );
  });

  test("commits and pushes a task worktree", async ({ page, request }) => {
    const created = await responseJson<{ path: string; branch: string }>(
      await request.post(`/api/worktrees/${workItem.id}/create`, {
        data: {
          module_id: moduleRow.id,
          ticket_seq: workItem.sequence_id,
          task_name: workItem.name,
        },
      }),
    );
    worktreePath = created.path;
    expect(worktreePath, "the worktree's path").toBeTruthy();
    await writeFile(join(worktreePath, "worktree-work.txt"), "agent output\n");

    await openModule(page, MODULE_NAME);
    await openWorkItem(page, WORK_ITEM_NAME);
    await page.getByRole("tab", { name: "Changes" }).click();

    const panel = page.getByTestId("changes-panel");
    await expect(panel).toHaveAttribute("data-checkout", "worktree");
    await expect(
      page.getByRole("option", { name: /worktree-work\.txt/ }),
    ).toBeVisible();

    // The worktree leads with the pull-request stack; the sync flow this test
    // can finish hermetically is one press away in its menu.
    const footer = page.getByTestId("action-footer");
    await expect(footer).toHaveAttribute("data-primary-action", "commit_push_pr");
    await footer.getByRole("button", { name: "Other actions" }).click();
    await page
      .getByTestId("action-menu")
      .getByRole("button", { name: "Commit & push" })
      .click();

    const confirmation = page.getByTestId("push-confirmation");
    await expect(confirmation).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("push-confirmation-branch")).toHaveText(
      created.branch,
    );
    await confirmation.getByRole("button", { name: "Push to origin" }).click();

    for (const step of ["stage", "generate_message", "commit", "push"]) {
      await expect(page.getByTestId(`action-step-${step}`)).toHaveAttribute(
        "data-state",
        "ok",
      );
    }

    // The worktree's branch arrived on the remote, and the module checkout the
    // other test pushed was left exactly where it was.
    const worktreeHead = git(["rev-parse", "HEAD"], worktreePath).trim();
    expect(remoteSha(remote, created.branch)).toBe(worktreeHead);
    expect(remoteSha(remote, "main")).toBe(git(["rev-parse", "main"], repo).trim());
  });
});
