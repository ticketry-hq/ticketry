import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { workItem } from "./seam";
import { studioApolloClient } from "../shared/apollo/client";
import { WorkTrackerWorkItemDocument } from "../features/work-items";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { publicWorktrackerId } from "../shared/api/generatedWorktracker";

function connection(nodes: unknown[], total: number, next = false) {
  return { __typename: nodes[0] && (nodes[0] as any).__typename === "Worktrees" ? "WorktreesConnection" : "WorktrackerIssueConnection", nodes, pageInfo: { __typename: "PageInfo", hasNextPage: next }, paginationInfo: { __typename: "PaginationInfo", total } };
}
export function inspectionStory(id: string, moduleId: string, sprint: { id: string; name: string } | null = null) {
  return { __typename: "WorktrackerIssue", id, projectId: "project-1", parentId: moduleId,
    moduleId, type: "task", stateRevision: 1, isArchived: false, updatedAt: "2026-01-01T00:00:00Z", sprintId: sprint?.id ?? null,
    sprint: sprint ? { __typename: "WorktrackerSprint", ...sprint } : null };
}

it("[overhaul-635] counts complete top-level Stories and current worktrees without opening hidden modules", async () => {
  const boundary = storySprintModuleBoundary();
  // Real Seaography UUID fields are returned in public, hyphenated form.
  const hiddenModuleId = "920ecc83ef9d4abb9bbabd75aa666a5f";
  boundary.modules[1] = { ...boundary.modules[1], id: hiddenModuleId };
  boundary.presentations[1] = { ...boundary.presentations[1], module_id: hiddenModuleId };
  const reads: Array<{ operation: string; variables: any }> = [];
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document); const input = variables as any;
    reads.push({ operation, variables });
    if (operation === "ModuleManagerInspectionStories") return { stories: connection([
      inspectionStory(`${input.moduleId}-story-${input.offset}`, publicWorktrackerId(input.moduleId), { id: "sprint-24", name: "Sprint 24" }),
    ], 2, input.offset === 0) } as never;
    if (operation === "ModuleManagerInspectionWorktrees") return { worktrees: connection(input.offset === 0 ? [{
      __typename: "Worktrees", id: `${input.moduleId}-tree`, moduleId: publicWorktrackerId(input.moduleId), projectId: publicWorktrackerId(input.projectId),
      status: "active", updatedAt: "2026-01-01T00:00:00Z",
    }] : [], 1) } as never;
    return boundary.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const row = (await screen.findByRole("button", { name: "Inspect bugs" })).closest("li")!;
  await waitFor(() => expect(within(row).getByText("2 stories")).toBeVisible());
  expect(within(row).getByText("1 worktree")).toBeVisible();
  expect(within(row).getByText(`/repos/${hiddenModuleId}`)).toBeVisible();
  expect(reads.filter(({ operation, variables }) => operation === "ModuleManagerInspectionStories" && variables.moduleId === hiddenModuleId).map(({ variables }) => variables.offset)).toEqual([0, 1]);
  fireEvent.click(within(row).getByRole("button", { name: "Inspect bugs" }));
  expect(await screen.findByText("Sprint 24", { selector: "li" })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  expect(boundary.calls.filter(({ operation }) => /^(Update|Reorder)/.test(operation))).toEqual([]);
});

it("[overhaul-636] shows a failed incomplete collection as unavailable and retries to authoritative empty without inventing activity", async () => {
  const boundary = storySprintModuleBoundary(); let failed = false;
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document); const input = variables as any;
    if (operation === "ModuleManagerInspectionStories") {
      if (input.moduleId === "module-2" && !failed) { failed = true; throw new Error("Story metadata offline"); }
      return { stories: connection([], 0) } as never;
    }
    if (operation === "ModuleManagerInspectionWorktrees") return { worktrees: { ...connection([], 0), __typename: "WorktreesConnection" } } as never;
    return boundary.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const row = (await screen.findByRole("button", { name: "Inspect bugs" })).closest("li")!;
  await waitFor(() => expect(within(row).getByText("Stories unavailable")).toBeVisible());
  expect(within(row).queryByText("0 stories")).toBeNull();
  fireEvent.click(within(row).getByRole("button", { name: "Retry bugs metadata" }));
  expect(await within(row).findByText("0 stories")).toBeVisible();
  expect(within(row).getByText("0 worktrees")).toBeVisible();
  expect(within(row).getByText("Activity unknown")).toBeVisible();
});

it("[overhaul-637] refreshes Story and worktree metadata when authoritative subscription facts change their membership", async () => {
  const boundary = storySprintModuleBoundary(); let deliver!: (value: string) => void;
  let storyCount = 0; let worktreeCount = 0;
  boundary.mount({ shell: true, selectedTaskId: null, onGraphQlSubscribe: async (_id, request, onEvent) => {
    if (JSON.parse(request).operationName === "RunStatusStream") deliver = onEvent;
    return '{"type":"accepted"}';
  }, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document); const input = variables as any;
    if (operation === "ModuleManagerInspectionStories") return { stories: connection(input.moduleId === "module-2" && storyCount ? [inspectionStory("new-top-story", "module-2")] : [], input.moduleId === "module-2" ? storyCount : 0) } as never;
    if (operation === "ModuleManagerInspectionWorktrees") return { worktrees: { ...connection(input.moduleId === "module-2" && worktreeCount ? [{
      __typename: "Worktrees", id: "new-worktree", projectId: "project-1", moduleId: "module-2", status: "active", updatedAt: "2026-01-01T00:00:00Z",
    }] : [], input.moduleId === "module-2" ? worktreeCount : 0), __typename: "WorktreesConnection" } } as never;
    return boundary.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  await screen.findByRole("button", { name: "Inspect bugs" });
  const row = () => screen.getByRole("button", { name: "Inspect bugs" }).closest("li")!;
  expect(await within(row()).findByText("0 stories")).toBeVisible();
  await waitFor(() => expect(deliver).toBeDefined());
  const send = (frame: unknown) => deliver(JSON.stringify({ type: "next", payload: { data: { run_status_stream: frame } } }));
  act(() => send({ __typename: "RunStatusSnapshot", project_id: "project-1", cursor: 100,
    at: "2026-10-09T00:00:00Z", runs: [], automation_attempts: [] }));
  storyCount = 1;
  act(() => send({ __typename: "RunStatusEvent", cursor: 101, event_id: "metadata-story-event", project_id: "project-1",
    event_kind: "work_item.changed", payload_version: 1, subject_kind: "work_item", subject_id: "new-top-story",
    agent_run_id: null, automation_attempt_id: null, work_item_id: "new-top-story", committed_at: "2026-10-09T00:00:01Z",
    payload: { workItemId: "new-top-story", projectId: "project-1", moduleId: "module-2", itemKind: "task", membershipChanged: true } }));
  await waitFor(() => expect(within(row()).getByText("1 story")).toBeVisible());
  worktreeCount = 1;
  act(() => send({ __typename: "RunStatusEvent", cursor: 102, event_id: "metadata-tree-event", project_id: "project-1",
    event_kind: "worktree.changed", payload_version: 1, subject_kind: "worktree", subject_id: "new-worktree",
    agent_run_id: null, automation_attempt_id: null, work_item_id: "new-top-story", committed_at: "2026-10-09T00:00:02Z",
    payload: { topLevelTaskId: "new-top-story", projectId: "project-1" } }));
  await waitFor(() => expect(within(row()).getByText("1 worktree")).toBeVisible());
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
});

it("[overhaul-638] discards metadata reads from a closed manager when a new inspection scope has completed", async () => {
  const boundary = storySprintModuleBoundary(); let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; }); let first = true; let started = false; let freshCount = 0;
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document); const input = variables as any;
    if (operation === "ModuleManagerInspectionStories") {
      if (input.moduleId === "module-2" && first) {
        first = false; started = true; await pending;
        return { stories: connection([inspectionStory("stale-metadata", "module-2")], 1) } as never;
      }
      return { stories: connection(Array.from({ length: freshCount }, (_, index) => inspectionStory(`${input.moduleId}-fresh-story-${index}`, input.moduleId)), freshCount) } as never;
    }
    if (operation === "ModuleManagerInspectionWorktrees") return { worktrees: { ...connection([], 0), __typename: "WorktreesConnection" } } as never;
    return boundary.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  await waitFor(() => expect(started).toBe(true));
  fireEvent.click(within(screen.getByRole("region", { name: "Module Manager" })).getByRole("button", { name: "Close Module Manager" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  const row = (await screen.findByRole("button", { name: "Inspect bugs" })).closest("li")!;
  expect(await within(row).findByText("0 stories")).toBeVisible();
  await act(async () => { release(); await pending; });
  expect(within(row).getByText("0 stories")).toBeVisible();
  expect(within(row).queryByText("1 story")).toBeNull();
  fireEvent.click(within(screen.getByRole("region", { name: "Module Manager" })).getByRole("button", { name: "Close Module Manager" }));
  freshCount = 2;
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  const reopened = (await screen.findByRole("button", { name: "Inspect bugs" })).closest("li")!;
  expect(await within(reopened).findByText("2 stories")).toBeVisible();
});


it("does not let a buffered metadata page resurrect an archived Story with a newer canonical revision", async () => {
  const boundary = storySprintModuleBoundary(); let release!: () => void; let started = false;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  boundary.http.workItems([workItem({ id: "metadata-archived-story", name: "Archived elsewhere", parent_id: "module-2" })]);
  boundary.http.tree("module-2", { rootIds: ["metadata-archived-story"], children: { "metadata-archived-story": [] }, order: ["metadata-archived-story"] });
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document); const input = variables as any;
    if (operation === "ModuleManagerInspectionStories") {
      if (input.moduleId !== "module-2") return { stories: connection([], 0) } as never;
      if (!input.offset) return { stories: connection([inspectionStory("metadata-archived-story", "module-2")], 2, true) } as never;
      started = true; await pending;
      return { stories: connection([inspectionStory("metadata-other-story", "module-2")], 2) } as never;
    }
    if (operation === "ModuleManagerInspectionWorktrees") return { worktrees: { ...connection([], 0), __typename: "WorktreesConnection" } } as never;
    return boundary.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  await waitFor(() => expect(started).toBe(true));
  boundary.http.revise("metadata-archived-story", { is_archived: true });
  await act(async () => {
    await studioApolloClient().query({ query: WorkTrackerWorkItemDocument, variables: { id: "metadata-archived-story" }, fetchPolicy: "network-only" });
    release(); await pending;
  });
  const row = () => screen.getByRole("button", { name: "Inspect bugs" }).closest("li")!;
  await waitFor(() => expect(within(row()).getByText("1 story")).toBeVisible());
  expect(within(row()).queryByText("2 stories")).toBeNull();
});

it("reports malformed required metadata as unavailable without repeating reads until the user retries", async () => {
  const boundary = storySprintModuleBoundary(); let reads = 0;
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document); const input = variables as any;
    if (operation === "ModuleManagerInspectionStories") {
      if (input.moduleId !== "module-2") return { stories: connection([], 0) } as never;
      reads += 1;
      if (reads > 2) throw new Error("Unexpected repeated metadata read");
      const { stateRevision: _revision, ...malformed } = inspectionStory("missing-metadata-revision", "module-2");
      return { stories: connection([malformed], 1) } as never;
    }
    if (operation === "ModuleManagerInspectionWorktrees") return { worktrees: { ...connection([], 0), __typename: "WorktreesConnection" } } as never;
    return boundary.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const row = (await screen.findByRole("button", { name: "Inspect bugs" })).closest("li")!;
  expect(await within(row).findByText("Stories unavailable")).toBeVisible();
  expect(reads).toBe(1);
  expect(within(row).queryByText("1 story")).toBeNull();
});
