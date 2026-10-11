import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import {
  CreateWorkTrackerIssueTypeDocument,
  CreateWorkTrackerTransitionDocument,
  DeleteWorkTrackerIssueTypeDocument,
  SetWorkTrackerStartStateDocument,
} from "../src/features/workflows/generated/workflows.documents";
import { getWorkflowCatalog, graphql } from "./support";
import { fixture } from "./work-items-migration-support";

type Catalog = Awaited<ReturnType<typeof getWorkflowCatalog>>;
export type IssueTypeNode = Catalog["issue_types"]["nodes"][number];
export type LaunchBindingNode = IssueTypeNode["launch_bindings"]["nodes"][number];

/** A seeded state of the shared fixture project, by name. */
export function seededState(name: string) {
  const state = fixture.states.find((row) => row.name === name);
  expect(state, `the seeded ${name} state`).toBeTruthy();
  return state!;
}

/** The authoritative issue-type row, including its transitions and bindings. */
export async function issueTypeNode(
  request: APIRequestContext,
  typeId: string,
): Promise<IssueTypeNode> {
  const catalog = await getWorkflowCatalog(request, fixture.project.id);
  const row = catalog.issue_types.nodes.find((issueType) => issueType.id === typeId);
  expect(row, `issue type ${typeId}`).toBeTruthy();
  return row!;
}

/** The authoritative launch binding of one type and state, if any. */
export async function launchBinding(
  request: APIRequestContext,
  typeId: string,
  stateId: string,
): Promise<LaunchBindingNode | undefined> {
  return (await issueTypeNode(request, typeId)).launch_bindings.nodes
    .find((binding) => binding.state === stateId);
}

/** One edge of a type's published workflow, if present. */
export async function transition(
  request: APIRequestContext,
  typeId: string,
  fromStateId: string,
  toStateId: string,
) {
  return (await issueTypeNode(request, typeId)).transitions.nodes
    .find((edge) => edge.from_state === fromStateId && edge.to_state === toStateId);
}

/**
 * Create a disposable task-level type with a published start state and
 * human-only edges, so a case can change its policy without touching Story.
 */
export async function disposableTaskType(
  request: APIRequestContext,
  name: string,
  startStateId: string,
  edges: Array<[from: string, to: string]> = [],
): Promise<{ id: string; name: string; remove: () => Promise<void> }> {
  const created = (await graphql(request, CreateWorkTrackerIssueTypeDocument, {
    projectId: fixture.project.id,
    name,
    level: "task",
    color: "#0EA5E9",
  })).create_issue_type;
  await graphql(request, SetWorkTrackerStartStateDocument, {
    id: created.id,
    startStateId,
    workflowRevision: (await issueTypeNode(request, created.id)).workflow_revision,
  });
  for (const [fromStateId, toStateId] of edges) {
    await graphql(request, CreateWorkTrackerTransitionDocument, {
      issueTypeId: created.id,
      fromStateId,
      toStateId,
      agentAllowed: false,
      handoff: false,
      workflowRevision: (await issueTypeNode(request, created.id)).workflow_revision,
    });
  }
  return {
    id: created.id,
    name,
    remove: async () => {
      await graphql(request, DeleteWorkTrackerIssueTypeDocument, {
        id: created.id,
        reassignTo: fixture.storyType.id,
      }).catch(() => undefined);
    },
  };
}

/** Open a state's configuration overlay and select one issue-type tab. */
export async function openStatePolicy(
  page: Page,
  stateName: string,
  typeName = "Story",
): Promise<Locator> {
  await page.getByRole("button", { name: `Configure ${stateName} state`, exact: true }).click();
  const panel = page.getByRole("region", { name: `${stateName} state configuration` });
  await expect(panel).toBeVisible();
  const tab = panel.getByRole("tablist", { name: "Issue types" })
    .getByRole("tab", { name: typeName, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return panel;
}

export async function closeStatePolicy(page: Page, stateName: string): Promise<void> {
  const panel = page.getByRole("region", { name: `${stateName} state configuration` });
  await panel.getByRole("button", { name: `Close ${stateName} state configuration` }).click();
  await expect(panel).toHaveCount(0);
}

/** Resolve when the next browser write of one workflow operation answers. */
export function workflowWrite(page: Page, operationName: string) {
  return page.waitForResponse((response) =>
    response.url().endsWith("/graphql")
    && response.request().postDataJSON()?.operationName === operationName);
}

/** Install one skill directory, which is what a provider root search accepts. */
export async function installSkill(root: string, name: string): Promise<void> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: E2E fixture skill.\n---\n`);
}
