import { act, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { fixture, mountStudio, workItem } from "./seam";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { gql } from "@apollo/client";
import { studioApolloClient } from "../shared/apollo/client";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useStoriesTree } from "../features/work-items";

function ShellKeyboard() {
  const { rows } = useStoriesTree();
  useGlobalKeymap(rows);
  return null;
}

it("[overhaul-476] resolves Active by default and offers All and No sprint below Story search", async () => {
  const http = fixture();
  http.storySprints([{ id: "sprint-active", projectId: "project-1", name: "Sprint 24", status: "active" }]);
  const active = workItem({ id: "active-story", name: "Active Story", sprint_id: "sprint-active" });
  const unassigned = workItem({ id: "unassigned-story", name: "Unassigned Story", sprint_id: null, rank: "b" });
  http.tree("module-1", { rootIds: [active.id, unassigned.id], children: { [active.id]: [], [unassigned.id]: [] }, order: [active.id, unassigned.id] });
  http.workItems([active, unassigned]);
  mountStudio({ http });
  const stories = await screen.findByRole("region", { name: "Stories" });
  const trigger = await within(stories).findByRole("button", { name: "Sprint: Sprint 24, Active" });
  expect(await within(stories).findByRole("treeitem", { name: /Active Story/ })).toBeVisible();
  expect(within(stories).queryByRole("treeitem", { name: /Unassigned Story/ })).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: /No sprint/ }));
  expect(await within(stories).findByRole("treeitem", { name: /Unassigned Story/ })).toBeVisible();
  expect(within(stories).queryByRole("treeitem", { name: /Active Story/ })).toBeNull();
  fireEvent.click(within(stories).getByRole("button", { name: "Show all sprints" }));
  expect(await within(stories).findByRole("treeitem", { name: /Active Story/ })).toBeVisible();
  expect(within(stories).getByRole("treeitem", { name: /Unassigned Story/ })).toBeVisible();
  expect(http.items.get(active.id)?.sprint_id).toBe("sprint-active");
  expect(http.items.get(unassigned.id)?.sprint_id).toBeNull();
});

it("[overhaul-477] keeps whole eligible branches, searches only those roots and preserves excluded Details with other matches", async () => {
  const http = fixture();
  http.storySprints([{ id: "sprint-active", projectId: "project-1", name: "Sprint 24", status: "active" }]);
  const root = workItem({ id: "active-story", name: "Current root", sprint_id: "sprint-active", sub_issues_count: 1 });
  const child = workItem({ id: "active-child", name: "Shared child", parent_id: root.id, sprint_id: null });
  const outside = workItem({ id: "outside-story", name: "Outside root", sprint_id: null, rank: "b", sub_issues_count: 1 });
  const outsideChild = workItem({ id: "outside-child", name: "Shared excluded child", parent_id: outside.id, sprint_id: "sprint-active" });
  http.tree("module-1", { rootIds: [root.id, outside.id], children: { [root.id]: [child.id], [outside.id]: [outsideChild.id], [child.id]: [], [outsideChild.id]: [] }, order: [root.id, child.id, outside.id, outsideChild.id] });
  http.workItems([root, child, outside, outsideChild]);
  let failIndex = false;
  mountStudio({ http, selectedTaskId: outside.id, graphQlExecute: (document, variables) => {
    if (failIndex && documentOperationName(document) === "ProjectStorySprintIndex") {
      throw new FoundationGraphQlError("unknown", "Index refresh failed");
    }
    return http.executeGraphQl(document, variables);
  } });
  const stories = await screen.findByRole("region", { name: "Stories" });
  expect(await within(stories).findByRole("treeitem", { name: /Current root/ })).toBeVisible();
  expect(await screen.findByText("This story is outside the current results. It stays open here.")).toBeVisible();
  expect(screen.getByRole("region", { name: "Details" })).toHaveTextContent("Outside root");
  await within(stories).findByText("1 of 2 stories");
  failIndex = true;
  fireEvent.click(within(stories).getByRole("button", { name: "Sprint: Sprint 24, Active" }));
  await within(stories).findByRole("button", { name: "Retry" });
  expect(screen.getByText("This story is outside the current results. It stays open here.")).toBeVisible();
  fireEvent.keyDown(screen.getByRole("option", { name: /Sprint 24 Active/ }), { key: "Escape" });
  failIndex = false;
  fireEvent.click(within(stories).getByRole("button", { name: "Retry" }));
  await within(stories).findByText("1 of 2 stories");
  fireEvent.click(within(stories).getByRole("button", { name: "Expand subtasks" }));
  expect(await within(stories).findByRole("treeitem", { name: /Shared child/ })).toBeVisible();
  fireEvent.change(within(stories).getByRole("textbox", { name: "Search stories" }), { target: { value: "Shared" } });
  expect(within(stories).getByRole("treeitem", { name: /Current root/ })).toBeVisible();
  expect(within(stories).queryByRole("treeitem", { name: /Outside root/ })).toBeNull();
  expect(within(stories).queryByRole("treeitem", { name: /Shared excluded child/ })).toBeNull();
  expect(within(stories).getByText("1 of 2 stories")).toBeVisible();
  fireEvent.click(within(stories).getByRole("button", { name: "Show all sprints" }));
  expect(within(stories).getByRole("textbox", { name: "Search stories" })).toHaveValue("Shared");
  expect(await within(stories).findByRole("treeitem", { name: /Outside root/ })).toBeVisible();
  expect(screen.queryByText("This story is outside the current results. It stays open here.")).toBeNull();
});

it("[overhaul-478] owns chooser arrows, Enter, Space and Escape with trigger focus return", async () => {
  const http = fixture();
  http.tree("module-1", { rootIds: ["story-1"], children: { "story-1": [] }, order: ["story-1"] });
  http.workItems([workItem()]);
  mountStudio({ http, children: <ShellKeyboard /> });
  const trigger = await screen.findByRole("button", { name: "Sprint: All sprints" });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const activeOption = screen.getByRole("option", { name: /Active sprint/ });
  expect(activeOption).toHaveFocus();
  fireEvent.keyDown(activeOption, { key: "ArrowUp" });
  const none = screen.getByRole("option", { name: /No sprint/ });
  expect(none).toHaveFocus();
  fireEvent.keyDown(none, { key: " " });
  expect(screen.queryByRole("dialog", { name: "Choose sprint" })).toBeNull();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAccessibleName("Sprint: No sprint");
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("option", { name: /No sprint/ }), { key: "Escape" });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("[overhaul-479] keeps collapse usable under sprint restriction and restores drag only for All with empty search", async () => {
  const http = fixture();
  http.storySprints([{ id: "sprint-active", projectId: "project-1", name: "Sprint 24", status: "active" }]);
  http.tree("module-1", { rootIds: ["story-1"], children: { "story-1": ["child-1"], "child-1": [] }, order: ["story-1", "child-1"] });
  http.workItems([workItem({ sprint_id: "sprint-active", sub_issues_count: 1 }), workItem({ id: "child-1", parent_id: "story-1", name: "Context child" })]);
  mountStudio({ http, selectedTaskId: "child-1" });
  const stories = await screen.findByRole("region", { name: "Stories" });
  const row = await within(stories).findByRole("treeitem", { name: /Story/ });
  expect(row).not.toHaveAttribute("draggable", "true");
  fireEvent.click(within(row).getByRole("button", { name: "Expand subtasks" }));
  expect(await within(stories).findByRole("treeitem", { name: /Context child/ })).toBeVisible();
  fireEvent.click(within(row).getByRole("button", { name: "Collapse subtasks" }));
  expect(within(stories).queryByRole("treeitem", { name: /Context child/ })).toBeNull();
  expect(screen.queryByText("This story is outside the current results. It stays open here.")).toBeNull();
  fireEvent.click(within(stories).getByRole("button", { name: "Show all sprints" }));
  expect(row).toHaveAttribute("draggable", "true");
  fireEvent.change(within(stories).getByRole("textbox", { name: "Search stories" }), { target: { value: "Story" } });
  expect(row).not.toHaveAttribute("draggable", "true");
  fireEvent.click(within(stories).getByRole("button", { name: "Clear search" }));
  expect(row).toHaveAttribute("draggable", "true");
});

it("[overhaul-480] distinguishes unresolved loading and read failure from empty results and retries without clearing Story search", async () => {
  const http = fixture();
  http.storySprints([{ id: "sprint-active", projectId: "project-1", name: "Sprint 24", status: "active" }]);
  http.tree("module-1", { rootIds: ["story-1"], children: { "story-1": [] }, order: ["story-1"] });
  http.workItems([workItem({ sprint_id: "sprint-active" })]);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let fail = true;
  mountStudio({ http, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "StoryActiveSprint" && fail) {
      await gate;
      throw new FoundationGraphQlError("unknown", "Sprint read failed");
    }
    return http.executeGraphQl(document, variables);
  } });
  expect(await screen.findByText("Loading sprint stories…")).toBeVisible();
  expect(screen.queryByText("No stories in this sprint.")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Search stories" }), { target: { value: "Story" } });
  await act(async () => release());
  const retry = await screen.findByRole("button", { name: "Retry" });
  expect(screen.queryByText("No stories in this sprint.")).toBeNull();
  expect(screen.queryByText("0 of 1 stories")).toBeNull();
  expect(screen.getByRole("textbox", { name: "Search stories" })).toHaveValue("Story");
  fail = false;
  fireEvent.click(retry);
  expect(await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Search stories" })).toHaveValue("Story");
  expect(await screen.findByText("1 of 1 stories")).toBeVisible();
});

it("[overhaul-481] reacts to normalized sprint membership and optimistic rollback without reopening the module", async () => {
  const http = fixture();
  http.storySprints([{ id: "sprint-active", projectId: "project-1", name: "Sprint 24", status: "active" }]);
  http.tree("module-1", { rootIds: ["story-1"], children: { "story-1": [] }, order: ["story-1"] });
  http.workItems([workItem({ sprint_id: "sprint-active" })]);
  let moduleReads = 0;
  mountStudio({ http, graphQlExecute: (document, variables) => {
    if (documentOperationName(document) === "WorkTrackerModuleOpen") moduleReads++;
    return http.executeGraphQl(document, variables);
  } });
  await screen.findByRole("treeitem", { name: /Story/ });
  const client = studioApolloClient();
  const fragment = gql`fragment AcceptanceSprintMembership on WorktrackerIssue { id sprint_id: sprintId }`;
  const id = client.cache.identify({ __typename: "WorktrackerIssue", id: "story-1" });
  await act(async () => client.cache.recordOptimisticTransaction((cache) => {
    cache.writeFragment({ id, fragment, data: { __typename: "WorktrackerIssue", id: "story-1", sprint_id: null } });
  }, "acceptance-membership"));
  await waitFor(() => expect(screen.queryByRole("treeitem", { name: /Story/ })).toBeNull());
  expect(screen.getByText("0 of 1 stories")).toBeVisible();
  await act(async () => client.cache.removeOptimistic("acceptance-membership"));
  expect(await screen.findByRole("treeitem", { name: /Story/ })).toBeVisible();
  expect(screen.getByText("1 of 1 stories")).toBeVisible();
  expect(moduleReads).toBe(1);
});

it("[overhaul-482] counts unopened module roots project-wide and each recovery clears only its own filter axis", async () => {
  const http = fixture();
  http.storySprints([{ id: "sprint-active", projectId: "project-1", name: "Sprint 24", status: "active" }]);
  http.tree("module-1", { rootIds: ["story-1"], children: { "story-1": [] }, order: ["story-1"] });
  http.tree("module-2", { rootIds: ["unopened-root"], children: { "unopened-root": [] }, order: ["unopened-root"] });
  http.workItems([workItem({ sprint_id: "sprint-active" }), workItem({ id: "unopened-root", parent_id: "module-2", name: "Unopened Story", sprint_id: "sprint-active" })]);
  mountStudio({ http });
  const stories = await screen.findByRole("region", { name: "Stories" });
  const trigger = await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  await within(stories).findByText("1 of 1 stories");
  fireEvent.click(trigger);
  expect(screen.getByRole("option", { name: /Sprint 24 Active 2/ })).toBeVisible();
  fireEvent.keyDown(screen.getByRole("option", { name: /Sprint 24 Active 2/ }), { key: "Escape" });
  fireEvent.change(within(stories).getByRole("textbox", { name: "Search stories" }), { target: { value: "missingword" } });
  const clearText = await within(stories).findByRole("button", { name: "Clear story search" });
  fireEvent.click(clearText);
  expect(trigger).toHaveAccessibleName("Sprint: Sprint 24, Active");
  expect(await within(stories).findByRole("treeitem", { name: /Story/ })).toBeVisible();
  fireEvent.change(within(stories).getByRole("textbox", { name: "Search stories" }), { target: { value: "missingword" } });
  fireEvent.click(within(stories).getAllByRole("button", { name: "Show all sprints" })[0]!);
  expect(trigger).toHaveAccessibleName("Sprint: All sprints");
  expect(within(stories).getByRole("textbox", { name: "Search stories" })).toHaveValue("missingword");
  expect(within(stories).queryByRole("treeitem", { name: /Story/ })).toBeNull();
});
