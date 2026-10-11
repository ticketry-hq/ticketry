import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentExecutions, AgentTerminalSessions, WorktrackerIssue } from "../src/graphql-foundation/generated/schemaTypes";
import type { TypedDocumentNode } from "../src/graphql-foundation/typedDocument";
import { PlanningGraphDocument } from "../src/features/planning-graph/generated/planningGraph.documents";
import { SprintGoalsDocument } from "../src/features/sprints/goals/generated/goals.documents";
import { SprintSuggestionExecutionDocument, SprintSuggestionsDocument } from "../src/features/sprints/generated/sprints.documents";
import { configureCodexDefault, createModule, createWorkItem, getWorkflowCatalog, getWorkspace, graphql } from "./support";

type ExecutionEvidence = {
  agentExecutions: { nodes: Pick<AgentExecutions, "id" | "agentRunId" | "outputType" | "state" | "error" | "cancelRequested">[] };
  agentTerminalSessions: { nodes: Pick<AgentTerminalSessions, "agentRunId">[] };
  workItems: { nodes: (Pick<WorktrackerIssue, "id"> & { issueType?: Pick<NonNullable<WorktrackerIssue["issueType"]>, "name"> | null })[] };
};
const evidenceDocument: TypedDocumentNode<ExecutionEvidence, { sprintId: string }> = {
  kind: "Document", operationName: "SprintPlanningEvidence",
  source: `query SprintPlanningEvidence($sprintId:String!) {
      agentExecutions(filters:{sprintId:{eq:$sprintId}}) { nodes { id agentRunId outputType state error cancelRequested } }
      agentTerminalSessions { nodes { agentRunId } }
      workItems:worktrackerIssue { nodes { id issueType { name } } }
    }`,
};
export async function executionRecords(request: APIRequestContext, sprintId: string) {
  return graphql(request, evidenceDocument, { sprintId });
}

export async function planningFixture(request: APIRequestContext, { prefix = "Planning" } = {}) {
  await configureCodexDefault(request);
  const project = await getWorkspace(request);
  const catalog = await getWorkflowCatalog(request, project.id);
  const epicType = catalog.issue_types.nodes.find((row) => row.level === "module");
  const storyType = catalog.issue_types.nodes.find((row) => row.name === "Story");
  if (!epicType || !storyType) throw new Error("Missing provisioned planning types");
  const epic = await createModule(request, project.id, { name: `${prefix} epic`, issue_type_id: epicType.id });
  const stories = await Promise.all([`${prefix} existing`, `${prefix} ungrouped`, `${prefix} waiting`].map((name) =>
    createWorkItem(request, project.id, { name, issue_type_id: storyType.id,
      ...(name === `${prefix} ungrouped` ? {} : { parent_id: epic.id }),
    })));
  return { projectId: project.id, epic, stories, prefix };
}
export type PlanningFixture = Awaited<ReturnType<typeof planningFixture>>;

export async function sprintThroughUi(page: Page, fixture: PlanningFixture, name: string) {
  await page.goto("/");
  const module = page.getByRole("tab", { name: fixture.epic.name, exact: true }).last();
  await expect(module).toBeVisible();
  const plan = page.getByTestId("workspace-tab-plan");
  await module.focus();
  await expect(module).toBeFocused();
  await module.press("Home");
  await expect(plan).toBeFocused();
  await plan.press("Enter");
  await expect(page.getByTestId("plan-sprint").or(page.getByTestId("sprints-list"))).toBeVisible();
  if (await page.getByRole("button", { name: "Back to sprints" }).count()) {
    await page.getByRole("button", { name: "Back to sprints" }).click();
  }
  await page.getByRole("button", { name: "New sprint", exact: true }).click();
  await page.getByRole("textbox", { name: "Sprint name" }).fill(name);
  await page.getByRole("textbox", { name: "Sprint name" }).press("Enter");
  await expect(page.getByTestId("plan-sprint").getByRole("heading", { name, exact: true, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Back to sprints" }).click();
  const card = page.locator('[data-testid^="sprint-card-"]').filter({ has: page.getByRole("heading", { name, exact: true }) });
  const testId = await card.getAttribute("data-testid");
  if (!testId) throw new Error("Missing sprint identity on card");
  return { id: testId.replace("sprint-card-", ""), card };
}

export async function addGoal(card: Locator, text: string) {
  const field = card.getByRole("textbox", { name: "New sprint goal" });
  if (!await field.count()) await card.getByRole("button", { name: "+ Goal", exact: true }).click();
  await field.fill(text);
  await field.press("Enter");
  await expect(card.getByText(text, { exact: true })).toBeVisible();
  await expect(field).toHaveValue("");
}

export async function reopenSprints(page: Page) {
  await page.reload();
  await page.getByTestId("workspace-tab-plan").click();
  await expect(page.getByTestId("plan-sprint").or(page.getByTestId("sprints-list"))).toBeVisible();
  const back = page.getByRole("button", { name: "Back to sprints" });
  if (await back.count()) await back.click();
  await expect(page.getByTestId("sprints-list")).toBeVisible();
}

export async function addEpic(page: Page, name: string, waiting: number) {
  await page.getByRole("button", { name: "Add epic", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(`^${name}, .*${waiting} waiting suggestions$`) }).click();
  await expect(page.getByRole("tab", { name: new RegExp(`^${name},`) })).toHaveAttribute("aria-selected", "true");
}

export async function suggestions(request: APIRequestContext, sprintId: string) {
  return (await graphql(request, SprintSuggestionsDocument, { sprintId })).worktrackerSprintSuggestion.nodes;
}
export async function sprintState(request: APIRequestContext, sprintId: string) {
  return (await graphql(request, SprintSuggestionExecutionDocument, { sprintId })).worktrackerSprint.nodes[0];
}
export async function goals(request: APIRequestContext, sprintId: string) {
  return (await graphql(request, SprintGoalsDocument, { sprintId })).worktrackerSprintGoal.nodes;
}
export async function plannedStories(request: APIRequestContext, projectId: string) {
  return (await graphql(request, PlanningGraphDocument, { projectId })).workItems.nodes;
}

const providerDirectory = () => {
  const directory = process.env.TICKETRY_E2E_PROVIDER_DIR;
  if (!directory) throw new Error("Run with studio/playwright.config.ts and its disposable provider fixture");
  return directory;
};
export async function providerMode(kind: "success" | "failure" | "delayed", refresh = false, { prefix = "Planning", empty = false } = {}) {
  await writeFile(join(providerDirectory(), "control.json"), JSON.stringify({ kind, refresh, prefix, empty }));
}
export async function providerStarted(id: string) {
  await expect.poll(async () => {
    try { await access(join(providerDirectory(), `${id}.started.json`)); return true; }
    catch { return false; }
  }).toBe(true);
}
export async function releaseProvider(id: string) {
  await writeFile(join(providerDirectory(), `${id}.release`), "");
}
export async function executionCleaned(id: string) {
  const directory = process.env.TICKETRY_E2E_DATA_DIR;
  if (!directory) throw new Error("Missing isolated data directory");
  await expect.poll(async () => {
    const rows = await readdir(join(directory, "executions"));
    return rows.includes(id);
  }).toBe(false);
  const started: unknown = JSON.parse(await readFile(join(providerDirectory(), `${id}.started.json`), "utf8"));
  if (!started || typeof started !== "object" || !("pid" in started) || typeof started.pid !== "number") {
    throw new Error("Fixture process identity missing");
  }
  const pid = started.pid;
  await expect.poll(() => {
    try { process.kill(pid, 0); return false; }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return true;
      throw error;
    }
  }).toBe(true);
}

export async function launchFromCard(page: Page, card: Locator, request: APIRequestContext, sprintId: string, label: string) {
  const launch = page.waitForRequest((request) => request.postDataJSON()?.operationName === "CreateSprintSuggestionExecution");
  await card.getByRole("button", { name: label, exact: true }).click();
  await launch;
  await expect(card.getByRole("status")).toHaveText("An agent is looking for stories…");
  await expect(card.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  const records = await executionRecords(request, sprintId);
  const execution = records.agentExecutions.nodes.find((row) => row.state === "running" || row.state === "queued");
  if (!execution) throw new Error("No real running execution");
  await providerStarted(execution.id);
  return execution;
}
