import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { PlanningGraphDocument } from "../src/features/planning-graph/generated/planningGraph.documents";
import { graphql, createModule, createWorkItem, getModules, getWorkflowCatalog } from "./support";
import { TransitionWorkTrackerWorkItemDocument } from "../src/features/work-items/generated/workItems.documents";
import { planningFixture, plannedStories, reopenSprints, sprintThroughUi, type PlanningFixture } from "./sprint-planning-support";

export async function moduleFixture(request: APIRequestContext, prefix: string) {
  const fixture = await planningFixture(request, { prefix });
  const catalog = await getWorkflowCatalog(request, fixture.projectId);
  const epicType = catalog.issue_types.nodes.find((row) => row.level === "module");
  const storyType = catalog.issue_types.nodes.find((row) => row.name === "Story");
  if (!epicType || !storyType) throw new Error("Planning types are not provisioned");
  const secondEpic = await createModule(request, fixture.projectId, { name: `${prefix} other epic`, issue_type_id: epicType.id });
  const other = await createWorkItem(request, fixture.projectId, {
    name: `${prefix} other story`, issue_type_id: storyType.id, parent_id: secondEpic.id,
  });
  return { ...fixture, secondEpic, other, storyType, catalog };
}

export const cardNamed = (page: Page, name: string) => page.locator('[data-testid^="sprint-card-"]')
  .filter({ has: page.getByRole("heading", { name, exact: true }) });

export async function createSprint(page: Page, name: string) {
  await page.getByRole("button", { name: "New sprint", exact: true }).click();
  await page.getByRole("textbox", { name: "Sprint name" }).fill(name);
  await page.getByRole("textbox", { name: "Sprint name" }).press("Enter");
  await expect(page.getByTestId("plan-sprint").getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Back to sprints" }).click();
  const card = cardNamed(page, name);
  const testId = await card.getAttribute("data-testid");
  if (!testId) throw new Error("Sprint card has no identity");
  return { id: testId.replace("sprint-card-", ""), card };
}

export async function openSprint(page: Page, name: string) {
  await cardNamed(page, name).getByRole("button", { name: "Plan", exact: true }).click();
  await expect(page.getByTestId("plan-sprint").getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
}

export async function selectEpic(page: Page, name: string) {
  const tab = page.getByRole("tab", { name: new RegExp(`^${name},`) });
  if (!await tab.count()) {
    await page.getByRole("button", { name: "Add epic", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${name},`) }).click();
  } else await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return tab;
}

export const storyRow = (pane: Locator, name: string) => pane.locator('[data-testid^="plan-item-"]')
  .filter({ hasText: name });

export async function inlineStory(pane: Locator, name: string) {
  const input = pane.getByRole("textbox", { name: "Story title" });
  if (!await input.count()) await pane.getByRole("button", { name: "Add story", exact: true }).click();
  await input.fill(name);
  await input.press("Enter");
  await expect(storyRow(pane, name.trim())).toBeVisible();
  await expect(input).toHaveValue("");
}

export async function storyNamed(request: APIRequestContext, projectId: string, name: string) {
  return (await plannedStories(request, projectId)).find((row) => row.name === name);
}

export async function epicNamed(request: APIRequestContext, projectId: string, name: string) {
  return (await getModules(request, projectId)).find((row) => row.name === name);
}

export async function stateFixture(request: APIRequestContext, fixture: Awaited<ReturnType<typeof moduleFixture>>, name: string, targetStateId: string, epicId?: string) {
  const row = await createWorkItem(request, fixture.projectId, { name, issue_type_id: fixture.storyType.id, parent_id: epicId });
  const queue = [{ state: row.state_id!, path: [] as string[] }];
  const visited = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (current.state === targetStateId) {
      for (const targetStateId of current.path) await graphql(request, TransitionWorkTrackerWorkItemDocument, { id: row.id, targetStateId });
      return row;
    }
    if (visited.has(current.state)) continue;
    visited.add(current.state);
    for (const transition of fixture.storyType.transitions.nodes.filter((edge) => edge.from_state === current.state)) {
      queue.push({ state: transition.to_state, path: [...current.path, transition.to_state] });
    }
  }
  throw new Error(`No public workflow path to fixture state ${targetStateId}`);
}

export async function graph(request: APIRequestContext, projectId: string) {
  return graphql(request, PlanningGraphDocument, { projectId });
}

export async function emptyVisit(page: Page, fixture: PlanningFixture, name: string) {
  const sprint = await sprintThroughUi(page, fixture, name);
  await openSprint(page, name);
  for (const close of await page.getByRole("button", { name: /^Close .+ epic$/ }).all()) await close.click();
  await expect(page.getByTestId("plan-backlog").getByText("No epic open. Use + Add epic to plan another one.")).toBeVisible();
  return sprint;
}

export async function reloadPlan(page: Page, sprintName: string, epicName: string) {
  await reopenSprints(page);
  await openSprint(page, sprintName);
  await selectEpic(page, epicName);
}
