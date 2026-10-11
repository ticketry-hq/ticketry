import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { fixture, mountStudio } from "./seam";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import SprintsView from "../features/sprints/SprintsView";
import { useStorySprintHistory } from "../features/sprints/queries/useStorySprintHistory";
import SprintsList from "../features/sprints/SprintsList";
import { graphOf, sprint } from "../features/planning-graph/testGraph";

it("[overhaul-662] exposes sequence arrow controls only on planned sprint cards and disables the ends", () => {
  render(<SprintsList graph={graphOf([], [
    sprint({ id: "completed", status: "completed" }), sprint({ id: "active", status: "active" }),
    sprint({ id: "first" }), sprint({ id: "middle" }), sprint({ id: "last" }),
  ])} openStoryId={null} onOpenStory={vi.fn()} onOpenSprint={vi.fn()}
    onCreateSprint={vi.fn(async () => ({ kind: "missing" as const }))} onUpdateSprint={vi.fn(async () => true)}
    onReorderSprint={vi.fn(async () => {})} renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} />);
  for (const id of ["active", "completed"]) {
    expect(within(screen.getByTestId(`sprint-card-${id}`)).queryByRole("button", { name: "Move sprint earlier" })).toBeNull();
    expect(within(screen.getByTestId(`sprint-card-${id}`)).queryByRole("button", { name: "Move sprint later" })).toBeNull();
  }
  const first = within(screen.getByTestId("sprint-card-first"));
  const middle = within(screen.getByTestId("sprint-card-middle"));
  const last = within(screen.getByTestId("sprint-card-last"));
  expect(first.getByRole("button", { name: "Move sprint earlier" })).toBeDisabled();
  expect(first.getByRole("button", { name: "Move sprint later" })).toBeEnabled();
  expect(middle.getByRole("button", { name: "Move sprint earlier" })).toBeEnabled();
  expect(middle.getByRole("button", { name: "Move sprint later" })).toBeEnabled();
  expect(last.getByRole("button", { name: "Move sprint earlier" })).toBeEnabled();
  expect(last.getByRole("button", { name: "Move sprint later" })).toBeDisabled();
});

it("[overhaul-663] moves sprints both ways through the mutation and shares the authoritative order with sprint choices", async () => {
  const writes: unknown[] = [];
  let release = () => {};
  let gate = new Promise<void>((resolve) => { release = resolve; });
  const rows = [
    { ...sprint({ id: "completed", status: "completed", rank: "A" }), projectId: "project-1" },
    { ...sprint({ id: "active", status: "active", rank: "B" }), projectId: "project-1" },
    { ...sprint({ id: "first", rank: "C" }), projectId: "project-1" },
    { ...sprint({ id: "middle", rank: "D" }), projectId: "project-1" },
    { ...sprint({ id: "last", rank: "E" }), projectId: "project-1" },
  ];
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  mountStudio({ http, children: <><SprintsView projectId="project-1" renderSprintGoals={() => null}
    renderSuggestionAgentBox={() => null} /><PlannedChoices /></>, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "PlanningGraph") return {
      project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] }, states: { __typename: "WorktrackerStateConnection", nodes: [] },
      issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] }, modules: { __typename: "WorktrackerIssueConnection", nodes: [] }, workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
      sprints: { __typename: "WorktrackerSprintConnection", nodes: rows.map((row) => ({ ...row, __typename: "WorktrackerSprint" })) },
    } as never;
    if (operation === "SprintChoicePage") {
      const request = variables as { filters: { status: { eq: string } }; pagination: { offset: { offset: number } } };
      const selected = rows.filter((row) => row.status === request.filters.status.eq)
        .sort((a, b) => a.rank.localeCompare(b.rank));
      return { sprints: { __typename: "WorktrackerSprintConnection", nodes: selected.map((row) => ({ ...row, __typename: "WorktrackerSprint" })),
        paginationInfo: { __typename: "PaginationInfo", total: selected.length }, pageInfo: { __typename: "PageInfo", hasNextPage: false } } } as never;
    }
    if (operation === "ReorderSprint") {
      writes.push(variables);
      await gate;
      const moved = rows.find((row) => row.id === "middle")!;
      moved.rank = writes.length === 1 ? "BZ" : "D";
      return { reorder_sprint: { ...moved, __typename: "WorktrackerSprint" } } as never;
    }
    return http.executeGraphQl(document, variables);
  } });
  await screen.findByTestId("sprint-card-middle");
  await waitFor(() => expect(screen.getByLabelText("Planned sprint choices")).toHaveTextContent("first,middle,last"));
  fireEvent.click(within(screen.getByTestId("sprint-card-middle")).getByRole("button", { name: "Move sprint earlier" }));
  await waitFor(() => expect(writes).toEqual([{ sprintId: "middle", beforeId: "active", afterId: "first" }]));
  for (const arrow of screen.getAllByRole("button", { name: /^Move sprint (earlier|later)$/ })) expect(arrow).toBeDisabled();
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(plannedCardOrder()).toEqual(["middle", "first", "last"]));
  await waitFor(() => expect(screen.getByLabelText("Planned sprint choices")).toHaveTextContent("middle,first,last"));
  gate = new Promise<void>((resolve) => { release = resolve; });
  await waitFor(() => expect(within(screen.getByTestId("sprint-card-middle")).getByRole("button", { name: "Move sprint later" })).toBeEnabled());
  fireEvent.click(within(screen.getByTestId("sprint-card-middle")).getByRole("button", { name: "Move sprint later" }));
  await waitFor(() => expect(writes[1]).toEqual({ sprintId: "middle", beforeId: "first", afterId: "last" }));
  await act(async () => { release(); await gate; });
  await waitFor(() => expect(plannedCardOrder()).toEqual(["first", "middle", "last"]));
  await waitFor(() => expect(screen.getByLabelText("Planned sprint choices")).toHaveTextContent("first,middle,last"));
});

function PlannedChoices() {
  const { planned } = useStorySprintHistory("project-1", "", true);
  return <output aria-label="Planned sprint choices">{planned.sprints.map((row) => row.id).join(",")}</output>;
}
function plannedCardOrder() {
  return within(screen.getByTestId("sprints-list")).getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent).filter((name) => ["first", "middle", "last"].includes(name ?? ""));
}

it("[overhaul-664] preserves the sprint sequence after a refused reorder, reports inline feedback and allows retry", async () => {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  const rows = [sprint({ id: "first", rank: "C" }), sprint({ id: "middle", rank: "D" }), sprint({ id: "last", rank: "E" })];
  let refuse = true;
  const writes: unknown[] = [];
  mountStudio({ http, children: <SprintsView projectId="project-1" renderSprintGoals={() => null}
    renderSuggestionAgentBox={() => null} />, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "PlanningGraph") return {
      project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
      states: { __typename: "WorktrackerStateConnection", nodes: [] }, issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
      modules: { __typename: "WorktrackerIssueConnection", nodes: [] }, workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
      sprints: { __typename: "WorktrackerSprintConnection", nodes: rows.map((row) => ({ ...row, __typename: "WorktrackerSprint" })) },
    } as never;
    if (operation === "ReorderSprint") {
      writes.push(variables);
      if (refuse) throw new Error("Project sequence is locked");
      const moved = rows.find((row) => row.id === "middle")!;
      moved.rank = "B";
      return { reorder_sprint: { ...moved, __typename: "WorktrackerSprint" } } as never;
    }
    return http.executeGraphQl(document, variables);
  } });
  const card = await screen.findByTestId("sprint-card-middle");
  fireEvent.click(within(card).getByRole("button", { name: "Move sprint earlier" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Project sequence is locked");
  expect(plannedCardOrder()).toEqual(["first", "middle", "last"]);
  await waitFor(() => expect(within(card).getByRole("button", { name: "Move sprint earlier" })).toBeEnabled());
  expect(writes).toEqual([{ sprintId: "middle", beforeId: null, afterId: "first" }]);
  refuse = false;
  fireEvent.click(within(card).getByRole("button", { name: "Move sprint earlier" }));
  await waitFor(() => expect(plannedCardOrder()).toEqual(["middle", "first", "last"]));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("[overhaul-668] identifies a committed reorder when its follow-up planning read fails", async () => {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  const rows = [sprint({ id: "first", rank: "C" }), sprint({ id: "middle", rank: "D" })];
  let committed = false;
  mountStudio({ http, children: <SprintsView projectId="project-1" renderSprintGoals={() => null}
    renderSuggestionAgentBox={() => null} />, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "PlanningGraph") {
      if (committed) throw new Error("Planning refresh unavailable");
      return {
        project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
        states: { __typename: "WorktrackerStateConnection", nodes: [] }, issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
        modules: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue", id: "module-1", name: "Module 1", sequenceId: 1, presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] } }] }, workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
        sprints: { __typename: "WorktrackerSprintConnection", nodes: rows.map((row) => ({ ...row, __typename: "WorktrackerSprint" })) },
      } as never;
    }
    if (operation === "ReorderSprint") {
      committed = true;
      return { reorder_sprint: { ...rows[1], rank: "B", __typename: "WorktrackerSprint" } } as never;
    }
    return http.executeGraphQl(document, variables);
  } });
  const card = await screen.findByTestId("sprint-card-middle");
  fireEvent.click(within(card).getByRole("button", { name: "Move sprint earlier" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sprint moved, but the view could not refresh: Planning refresh unavailable");
  await waitFor(() => expect(plannedCardOrder()).toEqual(["middle", "first"]));
  await waitFor(() => expect(within(card).getByRole("button", { name: "Move sprint later" })).toBeEnabled());
});
