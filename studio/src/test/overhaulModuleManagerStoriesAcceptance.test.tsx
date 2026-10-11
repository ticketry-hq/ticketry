import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { WorkTrackerWorkItemsDocument } from "../features/work-items";
import { useClientStore } from "../state/clientStore";
import { getStorySprintFilterIntent } from "../features/work-items";
import { workItem } from "./seam";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-639] lazily expands a hidden module into every ordinary Story page in canonical order without opening its tab", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.http.workItems([
    workItem({ id: "story-later", name: "Later ranked story", parent_id: "module-2", rank: "a", sequence_id: 42 }),
    workItem({ id: "story-first", name: "First ranked story", parent_id: "module-2", rank: "V", sequence_id: 41 }),
  ]);
  boundary.http.tree("module-2", { rootIds: ["story-first", "story-later"], children: {}, order: ["story-first", "story-later"] });
  const reads: Array<{ projectId: string; moduleId: string; offset: number; limit: number }> = [];
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) !== "ModuleManagerStories") return boundary.execute(document, variables);
    const input = variables as typeof reads[number]; reads.push(input);
    const data = await boundary.http.executeGraphQl(WorkTrackerWorkItemsDocument, { projectId: "project-1" });
    const ordered = data.work_items.nodes.filter((row) => row.id === "story-first" || row.id === "story-later").sort((left, right) => left.sequence_id - right.sequence_id);
    return { stories: { __typename: "WorktrackerIssueConnection", nodes: ordered.slice(input.offset, input.offset + 1),
      pageInfo: { __typename: "PageInfo", hasNextPage: input.offset === 0 },
      paginationInfo: { __typename: "PaginationInfo", total: 2 } } } as never;
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  expect(reads).toHaveLength(0);
  fireEvent.click(within(manager).getByRole("button", { name: "Expand bugs stories" }));
  const first = await within(manager).findByRole("treeitem", { name: /First ranked story/ });
  const later = within(manager).getByRole("treeitem", { name: /Later ranked story/ });
  expect(first.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(reads.map(({ offset }) => offset)).toEqual([0, 1]);
  expect(reads.every((read) => read.projectId === "project-1" && read.moduleId === "module-2" && read.limit === 100)).toBe(true);
  fireEvent.click(later);
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(screen.queryByRole("tab", { name: /bugs/ })).toBeNull();
  expect(boundary.calls.some(({ operation }) => operation.startsWith("Update"))).toBe(false);
  fireEvent.click(within(manager).getByRole("button", { name: "Collapse bugs stories" }));
  await waitFor(() => expect(within(manager).queryByRole("treeitem", { name: /First ranked story/ })).toBeNull());
});

it("[overhaul-641] routes Story arrows through the production keymap and discards abandoned expansion responses", async () => {
  const boundary = storySprintModuleBoundary();
  let holdNextRead = false;
  let fresh = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) !== "ModuleManagerStories") return boundary.execute(document, variables);
    const input = variables as { moduleId: string };
    const abandoned = holdNextRead;
    holdNextRead = false;
    const data = await boundary.http.executeGraphQl(WorkTrackerWorkItemsDocument, { projectId: "project-1" });
    const rows = data.work_items.nodes.filter((row) => row.parent_id === input.moduleId).map((row) => ({ ...row,
      name: abandoned ? "Abandoned story response" : fresh && row.id === "bugs-24" ? "Fresh inspection story" : row.name }));
    if (abandoned) await gate;
    return { stories: { __typename: "WorktrackerIssueConnection", nodes: rows,
      pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: 2 } } } as never;
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  const expand = within(manager).getByRole("button", { name: "Expand bugs stories" });
  expand.focus();
  fireEvent.keyDown(expand, { key: "ArrowRight" });
  const first = await within(manager).findByRole("treeitem", { name: /Bugs current story/ });
  fireEvent.keyDown(expand, { key: "ArrowDown" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  const later = within(manager).getByRole("treeitem", { name: /Bugs next story/ });
  expect(later).toHaveFocus();
  fireEvent.keyDown(later, { key: "ArrowUp" });
  expect(first).toHaveFocus();
  fireEvent.keyDown(first, { key: "ArrowLeft" });
  const inspect = within(manager).getByRole("button", { name: "Inspect bugs" });
  expect(inspect).toHaveFocus();
  expect(within(manager).queryByRole("treeitem", { name: /Bugs current story/ })).toBeNull();
  holdNextRead = true;
  fireEvent.keyDown(inspect, { key: "ArrowRight" });
  expect(await within(manager).findByText("Loading stories in bugs…")).toBeVisible();
  fresh = true;
  fireEvent.keyDown(inspect, { key: "ArrowLeft" });
  fireEvent.keyDown(inspect, { key: "ArrowRight" });
  expect(await within(manager).findByRole("treeitem", { name: /Fresh inspection story/ })).toBeVisible();
  await act(async () => release());
  expect(within(manager).queryByText("Abandoned story response")).toBeNull();
  expect(within(manager).getByRole("treeitem", { name: /Fresh inspection story/ })).toBeVisible();
  expect(screen.queryByRole("tab", { name: /bugs/ })).toBeNull();
});

it("[overhaul-642] adopts new expanded Story membership from the real status subscription with complete pagination", async () => {
  const boundary = storySprintModuleBoundary();
  let deliver: ((encoded: string) => void) | undefined;
  let newStory = false;
  let removedStory = false;
  let releaseRefresh!: () => void;
  const refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  boundary.mount({ shell: true, selectedTaskId: null, onGraphQlSubscribe: async (_id, request, onEvent) => {
    if (JSON.parse(request).operationName === "RunStatusStream") deliver = onEvent;
    return '{"type":"accepted"}';
  }, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) !== "ModuleManagerStories") return boundary.execute(document, variables);
    const input = variables as { moduleId: string; offset: number };
    const data = await boundary.http.executeGraphQl(WorkTrackerWorkItemsDocument, { projectId: "project-1" });
    const rows = data.work_items.nodes.filter((row) => row.parent_id === input.moduleId && (newStory || row.id !== "new-bugs-story")
      && (!removedStory || row.id !== "bugs-24"));
    if (newStory && input.offset === 0) await refreshGate;
    return { stories: { __typename: "WorktrackerIssueConnection", nodes: rows.slice(input.offset, input.offset + 1),
      pageInfo: { __typename: "PageInfo", hasNextPage: input.offset + 1 < rows.length },
      paginationInfo: { __typename: "PaginationInfo", total: rows.length } } } as never;
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager).getByRole("button", { name: "Expand bugs stories" }));
  expect(await within(manager).findByRole("treeitem", { name: /Bugs next story/ })).toBeVisible();
  const focusedStory = within(manager).getByRole("treeitem", { name: /Bugs current story/ });
  focusedStory.focus();
  await waitFor(() => expect(deliver).toBeDefined());
  boundary.http.workItems([workItem({ id: "new-bugs-story", name: "Externally added story", parent_id: "module-2", rank: "c" })]);
  boundary.http.tree("module-2", { rootIds: ["bugs-24", "bugs-25", "new-bugs-story"], children: {}, order: ["bugs-24", "bugs-25", "new-bugs-story"] });
  newStory = true;
  act(() => deliver!(JSON.stringify({ type: "next", payload: { data: { run_status_stream: {
    __typename: "RunStatusEvent", cursor: 1, event_id: "new-story-member", project_id: "project-1", event_kind: "work_item.changed",
    payload_version: 1, subject_kind: "work_item", subject_id: "new-bugs-story", work_item_id: "new-bugs-story",
    agent_run_id: null, automation_attempt_id: null, committed_at: "2026-10-09T06:00:00Z",
    payload: { workItemId: "new-bugs-story", projectId: "project-1", moduleId: "module-2", itemKind: "task", membershipChanged: true },
  } } } })));
  await within(manager).findByText("Loading stories in bugs…");
  try {
    expect(focusedStory).toHaveFocus();
    expect(within(manager).getAllByRole("treeitem")).toHaveLength(2);
  } finally { await act(async () => releaseRefresh()); }
  expect(await within(manager).findByRole("treeitem", { name: /Externally added story/ })).toBeVisible();
  expect(within(manager).getAllByRole("treeitem")).toHaveLength(3);
  await waitFor(() => expect(within(manager).getByRole("treeitem", { name: /Bugs current story/ })).toHaveFocus());
  removedStory = true;
  act(() => deliver!(JSON.stringify({ type: "next", payload: { data: { run_status_stream: {
    __typename: "RunStatusEvent", cursor: 2, event_id: "removed-story-member", project_id: "project-1", event_kind: "work_item.changed",
    payload_version: 1, subject_kind: "work_item", subject_id: "bugs-24", work_item_id: "bugs-24",
    agent_run_id: null, automation_attempt_id: null, committed_at: "2026-10-09T06:01:00Z",
    payload: { workItemId: "bugs-24", projectId: "project-1", moduleId: "module-2", itemKind: "task", membershipChanged: true },
  } } } })));
  await waitFor(() => expect(within(manager).queryByRole("treeitem", { name: /Bugs current story/ })).toBeNull());
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Inspect bugs" })).toHaveFocus());
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(within(manager).getByRole("treeitem", { name: /Bugs next story/ })).toHaveFocus();
  expect(screen.queryByRole("tab", { name: /bugs/ })).toBeNull();
});

it("[overhaul-640] shows per-module loading and incomplete pagination errors, then retries every page without changing sprint intent", async () => {
  const boundary = storySprintModuleBoundary();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let fail = true;
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) !== "ModuleManagerStories") return boundary.execute(document, variables);
    const input = variables as { moduleId: string; offset: number };
    const data = await boundary.http.executeGraphQl(WorkTrackerWorkItemsDocument, { projectId: "project-1" });
    const rows = data.work_items.nodes.filter((row) => row.parent_id === input.moduleId);
    if (input.offset === 0) await gate;
    return { stories: { __typename: "WorktrackerIssueConnection", nodes: input.offset === 0 ? rows.slice(0, 1) : fail ? [] : rows.slice(1),
      pageInfo: { __typename: "PageInfo", hasNextPage: input.offset === 0 },
      paginationInfo: { __typename: "PaginationInfo", total: 2 } } } as never;
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  const originalIntent = getStorySprintFilterIntent("project-1");
  fireEvent.click(within(manager).getByRole("button", { name: "Expand bugs stories" }));
  expect(await within(manager).findByText("Loading stories in bugs…")).toBeVisible();
  await act(async () => release());
  expect(await within(manager).findByText("Story pagination is incomplete. Retry the module.")).toBeVisible();
  expect(within(manager).queryByRole("treeitem", { name: /Bugs current story/ })).toBeNull();
  fail = false;
  fireEvent.click(within(manager).getByRole("button", { name: "Retry stories in bugs" }));
  expect(await within(manager).findByRole("treeitem", { name: /Bugs current story/ })).toBeVisible();
  expect(within(manager).getByRole("treeitem", { name: /Bugs next story/ })).toBeVisible();
  expect(getStorySprintFilterIntent("project-1")).toEqual(originalIntent);
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
});
