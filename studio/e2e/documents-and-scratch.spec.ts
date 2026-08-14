import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  openModule,
  openWorkItem,
  responseJson,
  selectModuleForProfile,
} from "./support";

type ApiRow = {
  id: string;
  name: string;
};

type ProjectRow = ApiRow & {
  slug: string;
};

type ModuleRow = ApiRow & {
  sequence_id: number;
};

type WorkItemRow = ApiRow & {
  sequence_id: number;
};

test.describe.serial("Documents and Local scratch workspace", () => {
  let moduleFolder = "";
  let moduleRow!: ModuleRow;
  let workItem!: WorkItemRow;

  test.beforeAll(async ({ request }) => {
    moduleFolder = await mkdtemp(join(tmpdir(), "ticketry-documents-e2e-"));

    const projects = await responseJson<ProjectRow[]>(await request.get(
      "/api/work-tracker/projects",
    ));
    const project = projects.find((row) => row.slug === "CDN")
      ?? await responseJson<ProjectRow>(await request.post(
        "/api/work-tracker/projects",
        {
          data: {
            name: "Coding",
            slug: "CDN",
            description: "",
          },
        },
      ));
    const issueTypes = await responseJson<ApiRow[]>(await request.get(
      `/api/work-tracker/projects/${project.id}/issue-types`,
    ));
    const moduleType = issueTypes.find((row) => row.name === "Module");
    const storyType = issueTypes.find((row) => row.name === "Story");
    expect(moduleType, "the seeded module issue type").toBeTruthy();
    expect(storyType, "the seeded Story issue type").toBeTruthy();

    moduleRow = await responseJson<ModuleRow>(await request.post(
      `/api/work-tracker/projects/${project.id}/modules`,
      {
        data: {
          name: "Documents Module",
          issue_type_id: moduleType!.id,
        },
      },
    ));
    workItem = await responseJson<WorkItemRow>(await request.post(
      `/api/work-tracker/projects/${project.id}/work-items`,
      {
        data: {
          name: "Document persistence task",
          parent_id: moduleRow.id,
          issue_type_id: storyType!.id,
        },
      },
    ));

    await selectModuleForProfile(
      request,
      project.id,
      moduleRow.id,
      moduleFolder,
    );

    const designDirectory = join(
      moduleFolder,
      "spec",
      `documents-module--${moduleRow.id.slice(0, 8)}`,
      `T${workItem.sequence_id}--document-persistence-task`,
    );
    await mkdir(designDirectory, { recursive: true });
    await writeFile(
      join(designDirectory, "DESIGN.md"),
      "# Canonical design\n\nInitial document body.\n",
      "utf8",
    );
  });

  test.afterAll(async () => {
    if (moduleFolder) {
      await rm(moduleFolder, { recursive: true, force: true });
    }
  });

  test("[overhaul-web-11] discovers, preserves, and saves a task document across tab switches", async ({
    page,
  }) => {
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);

    const workspaceTabs = page.getByRole("tablist", {
      name: "Workspace tabs",
    });
    const detailsTab = workspaceTabs.getByRole("tab", { name: "Details" });
    const documentTab = workspaceTabs.getByRole("tab", { name: "DESIGN" });
    await expect(documentTab).toBeVisible();
    await documentTab.click();

    const editor = page.getByTestId("rich-markdown-editor-shell");
    const editable = editor.getByRole("textbox", { name: "editable markdown" });
    await expect(editable).toContainText("Initial document body.");
    await editable.click();
    await editable.press("ControlOrMeta+A");
    await editable.pressSequentially("Unsaved Playwright document draft");
    const actionRow = page.getByTestId("document-editor-action-row");
    await expect(actionRow.getByText("Unsaved changes")).toBeVisible();

    await detailsTab.click();
    await expect(detailsTab).toHaveAttribute("aria-selected", "true");
    await expect(editor).not.toBeVisible();
    await documentTab.click();
    await expect(editable).toContainText("Unsaved Playwright document draft");
    await expect(actionRow.getByText("Unsaved changes")).toBeVisible();

    await actionRow.getByRole("button", { name: "Save document" }).click();
    await expect(actionRow.getByText("Unsaved changes")).toHaveCount(0);

    await page.reload();
    await openModule(page, moduleRow.name);
    await openWorkItem(page, workItem.name);
    const reloadedWorkspaceTabs = page.getByRole("tablist", {
      name: "Workspace tabs",
    });
    await reloadedWorkspaceTabs.getByRole("tab", { name: "DESIGN" }).click();
    await expect(
      page
        .getByTestId("rich-markdown-editor-shell")
        .getByRole("textbox", { name: "editable markdown" }),
    ).toContainText("Unsaved Playwright document draft");
  });

  test("[web-scratch-01] exposes scratch modes and Escape restores launcher focus", async ({
    page,
  }) => {
    await openModule(page, moduleRow.name);
    await page
      .getByRole("treeitem", { name: /Local scratch workspace/ })
      .click();

    const workspaceTabs = page.getByRole("tablist", {
      name: "Workspace tabs",
    });
    const launch = workspaceTabs.getByRole("button", { name: "＋ Agent" });
    await expect(launch).toBeEnabled();
    await launch.click();

    const menu = page.getByRole("menu", { name: "Launch agent" });
    const plan = menu.getByRole("menuitem", { name: "Plan" });
    await expect(plan).toBeFocused();
    await expect(menu.getByRole("menuitem", { name: "Instant" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(launch).toBeFocused();
    await expect(workspaceTabs.getByRole("tab")).toHaveCount(1);
    await expect(page.getByText("No active Scratch runs.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
