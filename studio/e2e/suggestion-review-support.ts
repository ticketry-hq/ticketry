import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { selectEpic } from "./planning-module-support";
import { addGoal, executionCleaned, launchFromCard, planningFixture, providerMode, releaseProvider, sprintThroughUi } from "./sprint-planning-support";

/** Real typed-provider publication through the production discovery controls. */
export async function reviewReady(page: Page, request: APIRequestContext, prefix: string) {
  const fixture = await planningFixture(request, { prefix });
  const sprint = await sprintThroughUi(page, fixture, `${prefix} release`);
  await addGoal(sprint.card, `${prefix} goal`);
  await providerMode("success", false, { prefix });
  const execution = await launchFromCard(page, sprint.card, request, sprint.id, "Find stories for these goals");
  await releaseProvider(execution.id);
  await expect(sprint.card.getByText(/4 suggestions ready/)).toBeVisible();
  await executionCleaned(execution.id);
  await sprint.card.getByRole("button", { name: "Review in Plan →" }).click();
  await selectEpic(page, fixture.epic.name);
  return { fixture, ...sprint, execution };
}
