import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  acknowledgeOnboarding,
  createModule,
  createProject,
  createWorkItem,
  getModules,
  getProjects,
  getWorkflowCatalog,
  openModule,
  selectModuleForProfile,
} from "./support";

const moduleName = "Rich description Tab";
const storyName = "Tab through a rich description";
let moduleFolder = "";

test.beforeAll(async ({ request }) => {
  await acknowledgeOnboarding(request);
  const project = (await getProjects(request)).find((row) => row.slug === "CDN")
    ?? await createProject(request, { name: "Coding", slug: "CDN" });
  const issueTypes = (await getWorkflowCatalog(request, project.id)).issue_types.nodes;
  const moduleType = issueTypes.find((type) => type.level === "module");
  const storyType = issueTypes.find((type) => type.name === "Story");
  expect(moduleType).toBeTruthy();
  expect(storyType).toBeTruthy();
  const module = (await getModules(request, project.id))
    .find((row) => row.name === moduleName)
    ?? await createModule(request, project.id, {
      name: moduleName,
      issue_type_id: moduleType!.id,
    });
  moduleFolder = await mkdtemp(join(tmpdir(), "ticketry-rich-tab-e2e-"));
  await selectModuleForProfile(request, project.id, module.id, moduleFolder);
  await createWorkItem(request, project.id, {
    name: storyName,
    parent_id: module.id,
    issue_type_id: storyType!.id,
    description: "A plain description paragraph",
  });
});

test.afterAll(async () => {
  if (moduleFolder) await rm(moduleFolder, { recursive: true, force: true });
});

for (const viewport of [
  { label: "desktop", width: 1280, height: 800 },
  { label: "narrow", width: 700, height: 520 },
]) {
  test(`Tab leaves prose in the rich Details description (${viewport.label})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await openModule(page, moduleName);
    await page.getByRole("treeitem", { name: new RegExp(storyName) }).click();
    const editor = page.getByTestId("issue-description")
      .locator('.mdxeditor-root-contenteditable [contenteditable="true"]');
    await expect(editor).toBeVisible();
    await editor.focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => {
      const focused = document.activeElement;
      return focused instanceof HTMLElement
        && focused !== document.body
        && !focused.closest('[data-testid="issue-description"]');
    })).toBe(true);
  });
}
