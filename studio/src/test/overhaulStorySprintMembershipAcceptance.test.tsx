import { gql, type ApolloCache } from "@apollo/client";
import { act, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { usePlanWorkItem } from "../features/work-items";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { studioApolloClient } from "../shared/apollo/client";
import { workItem } from "./seam";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

const membership = gql`fragment AcceptanceProjectSprintMembership on WorktrackerIssue { id sprint_id: sprintId }`;

function assign(cache: ApolloCache, id: string, sprint_id: string | null) {
  cache.writeFragment({ id: cache.identify({ __typename: "WorktrackerIssue", id }), fragment: membership,
    data: { __typename: "WorktrackerIssue", id, sprint_id } });
}

function moduleTabs() {
  return screen.queryAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id"))
    .map((tab) => tab.getAttribute("aria-label"));
}

it("[overhaul-520] canonical and optimistic existing-root membership repaint branches, project counts and unopened tabs without crossing projects", async () => {
  const f = storySprintModuleBoundary();
  f.presentations[1] = { ...f.presentations[1]!, tab_hidden: false };
  const anchor = workItem({ id: "roadmap-anchor", name: "Roadmap anchor story", sprint_id: "sprint-24", rank: "b" });
  const foreign = workItem({ id: "foreign-root", name: "Foreign root", project_id: "project-2", parent_id: "foreign-module", sprint_id: null });
  f.http.workItems([anchor, foreign]);
  f.http.tree("module-1", { rootIds: ["roadmap-24", anchor.id], children: { "roadmap-24": [], [anchor.id]: [] }, order: ["roadmap-24", anchor.id] });
  f.http.tree("foreign-module", { rootIds: [foreign.id], children: { [foreign.id]: [] }, order: [foreign.id] });
  let release!: () => void;
  let fail = true;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  f.mount({ graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "PlanWorkItem") {
      await pending;
      if (fail) throw new Error("Assignment rejected");
    }
    return f.execute(document, variables);
  } });
  const { result } = renderHook(() => usePlanWorkItem());
  await screen.findByRole("treeitem", { name: /Roadmap current story/ });
  await waitFor(() => expect(moduleTabs()).toEqual(["Roadmap", "bugs"]));
  fireEvent.click(screen.getByRole("button", { name: "Sprint: Sprint 24, Active" }));
  await screen.findByRole("option", { name: /Sprint 24 Active 3/ });
  const client = studioApolloClient();
  const rootReads = () => f.calls.filter((call) => call.operation === "ProjectStorySprintIndex").length;
  const readsBeforeWrites = rootReads();

  // Existing canonical root membership changes require no collection fact or module open.
  await act(async () => {
    assign(client.cache, "release-25", "sprint-24");
    assign(client.cache, foreign.id, "sprint-24");
  });
  await waitFor(() => expect(moduleTabs()).toEqual(["Roadmap", "bugs", "0.2.0"]));
  expect(screen.getByRole("option", { name: /Sprint 24 Active 4/ })).toBeVisible();
  expect(screen.queryByText("Foreign root")).toBeNull();

  let roadmapWrite!: Promise<boolean>;
  let bugsWrite!: Promise<boolean>;
  act(() => {
    roadmapWrite = result.current("roadmap-24", null);
    bugsWrite = result.current("bugs-24", null);
  });
  await waitFor(() => expect(moduleTabs()).toEqual(["Roadmap", "0.2.0"]));
  expect(screen.queryByRole("treeitem", { name: /Roadmap current story/ })).toBeNull();
  expect(screen.getByRole("treeitem", { name: /Roadmap anchor story/ })).toBeVisible();
  expect(screen.getByRole("option", { name: /Sprint 24 Active 2/ })).toBeVisible();
  expect(client.cache.readFragment({ id: client.cache.identify({ __typename: "WorktrackerIssue", id: "roadmap-24" }),
    fragment: membership, optimistic: false })).toMatchObject({ sprint_id: "sprint-24" });

  await act(async () => {
    release();
    expect(await roadmapWrite).toBe(false);
    expect(await bugsWrite).toBe(false);
  });
  await waitFor(() => expect(moduleTabs()).toEqual(["Roadmap", "bugs", "0.2.0"]));
  expect(screen.getByRole("treeitem", { name: /Roadmap current story/ })).toBeVisible();
  expect(screen.getByRole("option", { name: /Sprint 24 Active 4/ })).toBeVisible();
  expect(client.cache.readFragment({ id: client.cache.identify({ __typename: "WorktrackerIssue", id: "release-25" }),
    fragment: membership })).toMatchObject({ sprint_id: "sprint-24" });
  fail = false;
  await act(async () => { expect(await result.current("bugs-24", null)).toBe(true); });
  await waitFor(() => expect(moduleTabs()).toEqual(["Roadmap", "0.2.0"]));
  expect(screen.getByRole("option", { name: /Sprint 24 Active 3/ })).toBeVisible();
  expect(client.cache.readFragment({ id: client.cache.identify({ __typename: "WorktrackerIssue", id: "bugs-24" }),
    fragment: membership, optimistic: false })).toMatchObject({ sprint_id: null });
  expect(rootReads()).toBe(readsBeforeWrites);
  expect(f.calls.filter((call) => call.operation === "WorkTrackerModuleOpen").map((call) =>
    (call.variables as { moduleId: string }).moduleId)).toEqual(["module-1"]);
  expect(f.calls.some((call) => call.operation === "UpdateWorkTrackerModulePresentation")).toBe(false);
});
