import { resolve } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  CODEX_TEST_MODEL,
  CODEX_TEST_REASONING,
  getWorkspace,
  getWorkItems,
  getWorkflowCatalog,
} from "./support";

/** Drive the production first-run tour and its workflow-guide entry. */
export async function proveTourWorkflowGuide({ page, request }: {
  page: Page;
  request: APIRequestContext;
}) {
  const workspace = await getWorkspace(request);
  expect(workspace.onboarding_required).toBe(true);
  await page.goto("/");
  await expect(page.getByTestId("onboarding-welcome")).toBeVisible();
  await page.getByRole("checkbox", { name: "I use codex" }).check();
  await page.getByRole("checkbox", { name: "I use claude" }).check();
  await page.getByRole("combobox", { name: "Agent/provider" }).selectOption("codex");
  await page.getByRole("combobox", { name: "Model", exact: true }).selectOption(CODEX_TEST_MODEL);
  await page.getByRole("combobox", { name: "Reasoning" }).selectOption(CODEX_TEST_REASONING);
  await page.getByRole("button", { name: /^(Continue|Get started)$/ }).click();
  await expect(page.getByTestId("onboarding-welcome")).toHaveCount(0);

  await page.getByRole("button", { name: "Open Module Manager", exact: true }).click();
  await page.getByRole("region", { name: "Module Manager", exact: true })
    .getByRole("button", { name: "New module", exact: true }).first().click();
  await page.getByTestId("onboarding-module-name-next").click();
  await page.getByTestId("onboarding-module-folder-done").click();
  const form = page.getByRole("form", { name: "Create module", exact: true });
  await form.getByRole("textbox", { name: "Module name", exact: true }).fill("Workflow tour module");
  await form.getByRole("textbox", { name: "Module folder", exact: true }).fill(resolve(".."));
  await form.getByRole("button", { name: "Create module", exact: true }).click();
  await expect(form).toHaveCount(0);
  const storyName = "Workflow tour captured Story";
  const idea = page.getByRole("textbox", { name: "Capture an idea" });
  await idea.fill(storyName);
  await idea.press("Enter");
  await expect(page.getByTestId("issue-name")).toContainText(storyName);
  const tour = page.getByRole("dialog", { name: "Your first story is ready", exact: true });
  await expect(tour).toBeVisible();
  const story = (await getWorkItems(request, workspace.id)).find((row) => row.name === storyName)!;
  expect(story).toBeTruthy();
  const catalog = await getWorkflowCatalog(request, workspace.id);
  const currentState = catalog.states.nodes.find((row) => row.id === story.state_id)!;
  expect(currentState).toBeTruthy();

  const mutations: string[] = [];
  const trackWrites = (sent: { url(): string; postDataJSON(): { query?: string; operationName?: string } | null }) => {
    if (!sent.url().endsWith("/graphql")) return;
    const body = sent.postDataJSON();
    if (body?.query?.trimStart().startsWith("mutation")) mutations.push(body.operationName ?? "");
  };
  page.on("request", trackWrites);
  await page.getByTestId("onboarding-story-workflow-guide").click();
  const guide = page.getByRole("dialog", { name: "Story workflow guide", exact: true });
  await expect(guide).toContainText(`For Story: ${storyName}`);
  await expect(guide.locator(`li[data-state-id="${currentState.id}"]`)).toContainText("Current state");
  await expect(guide).toContainText("This guide does not start work.");
  await expect(tour).toHaveCount(0);
  await guide.getByRole("button", { name: "Close", exact: true }).click();
  await expect(guide).toHaveCount(0);
  await expect(tour).toBeVisible();
  await expect(page.getByTestId("onboarding-story-workflow-guide")).toBeFocused();
  expect(mutations).toEqual([]);
  page.off("request", trackWrites);
  await page.getByTestId("onboarding-finish").click();
  await expect(tour).toHaveCount(0);
  expect((await getWorkspace(request)).onboarding_required).toBe(false);
  await page.reload();
  await expect(page.getByTestId("onboarding-welcome")).toHaveCount(0);
  await expect(page.getByTestId("issue-name")).toContainText(storyName);
  await page.getByRole("button", { name: "Story workflow guide", exact: true }).click();
  await expect(guide).toContainText(`For Story: ${storyName}`);
  expect((await getWorkItems(request, workspace.id)).find((row) => row.id === story.id)?.state_id)
    .toBe(currentState.id);
}
