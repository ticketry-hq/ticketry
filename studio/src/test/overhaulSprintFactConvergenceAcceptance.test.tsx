import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { statusStreamFeed } from "../features/agents/status/stream/statusStreamFeed";
import SprintsView from "../features/sprints/SprintsView";
import { useStorySprintHistory } from "../features/sprints/queries/useStorySprintHistory";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { mountStudio } from "./seam";
import { storySprintPaginationBoundary } from "./storySprintPaginationBoundary";
import { statusFeedTransport } from "./statusStreamFeedFixture";

const PROJECT = "project-1";
afterEach(() => statusStreamFeed.stop());

function PlannedChoices({ projectId = PROJECT }: { projectId?: string }) {
  const { planned } = useStorySprintHistory(projectId, "", true);
  return <ol aria-label="Planned choices">{planned.sprints.map((sprint) =>
    <li key={sprint.id}>{sprint.name}</li>)}</ol>;
}

function boundary(selectedProjectId = PROJECT) {
  const server = storySprintPaginationBoundary();
  server.rows.forEach((row) => { if (row.projectId === PROJECT) row.projectId = selectedProjectId; });
  const graphReads: string[] = [];
  const execute: typeof server.execute = async (document, variables) => {
    if (documentOperationName(document) !== "PlanningGraph") return server.execute(document, variables);
    const { projectId } = variables as { projectId: string };
    graphReads.push(projectId);
    return {
      project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: projectId, name: "Planner", slug: "PLAN" }] },
      states: { __typename: "WorktrackerStateConnection", nodes: [] },
      issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
      sprints: { __typename: "WorktrackerSprintConnection", nodes: server.rows.filter((row) => row.projectId === projectId)
        .map((row) => ({ __typename: "WorktrackerSprint", ...row })) },
      modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
      workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
    } as never;
  };
  const content = <><SprintsView projectId={selectedProjectId} renderSprintGoals={() => null} renderSuggestionAgentBox={() => null} /><PlannedChoices projectId={selectedProjectId} /></>;
  const mount = () => mountStudio({ http: server.http, graphQlExecute: execute, children: content });
  return { ...server, mount, content, graphReads,
    reorder: () => { server.rows.find((row) => row.id === "planned-02")!.rank = "a005"; } };
}

function sprintFact(cursor: number, projectId = PROJECT, frameProjectId = PROJECT) {
  return { __typename: "RunStatusEvent", cursor, event_id: `sprint-event-${cursor}`,
    project_id: frameProjectId, event_kind: "sprint.changed", payload_version: 1,
    subject_kind: "sprint", subject_id: "planned-02", agent_run_id: null,
    automation_attempt_id: null, work_item_id: null,
    payload: { projectId, sprintId: "planned-02", changeKind: "reordered", rank: "a005", revision: 5 },
    committed_at: "2026-10-09T10:00:00Z" };
}

async function connect(projectId = PROJECT) {
  const transport = statusFeedTransport();
  statusStreamFeed.resetCursors(projectId);
  statusStreamFeed.start(projectId, { createProxy: transport.createProxy });
  await waitFor(() => expect(transport.ready()).toBe(true));
  return transport;
}

function plannedOrder() {
  return within(screen.getByTestId("sprints-list")).getAllByRole("heading", { level: 2 })
    .filter((heading) => heading.textContent?.startsWith("Planned"))
    .map((heading) => heading.textContent);
}

it("[overhaul-665] external sprint reorder updates visible cards and sprint choices once per fact batch", async () => {
  const server = boundary();
  server.mount();
  await screen.findByTestId("sprint-card-planned-01");
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Planned choices" })).getAllByRole("listitem")).toHaveLength(5));
  const transport = await connect();
  const readsBefore = server.graphReads.length;
  server.reorder();
  act(() => { transport.send(sprintFact(101)); transport.send(sprintFact(102)); });
  await waitFor(() => expect(plannedOrder().slice(0, 2)).toEqual(["Planned 02", "Planned 01"]));
  expect(within(screen.getByRole("list", { name: "Planned choices" })).getAllByRole("listitem").slice(0, 2)
    .map((row) => row.textContent)).toEqual(["Planned 02", "Planned 01"]);
  expect(server.graphReads.slice(readsBefore)).toEqual([PROJECT]);
});

it("[overhaul-666] external sprint reorder repairs a closed cached planning view and its retained choices", async () => {
  const server = boundary();
  const mounted = server.mount();
  await screen.findByTestId("sprint-card-planned-01");
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Planned choices" })).getAllByRole("listitem")).toHaveLength(5));
  const transport = await connect();
  mounted.rerender(<StudioApolloProvider><p>Planning closed</p></StudioApolloProvider>);
  server.reorder();
  act(() => transport.send(sprintFact(101)));
  await waitFor(() => expect(server.graphReads).toHaveLength(2));
  mounted.rerender(<StudioApolloProvider>{server.content}</StudioApolloProvider>);
  await waitFor(() => expect(plannedOrder().slice(0, 2)).toEqual(["Planned 02", "Planned 01"]));
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Planned choices" })).getAllByRole("listitem").slice(0, 2)
    .map((row) => row.textContent)).toEqual(["Planned 02", "Planned 01"]));
});

it("[overhaul-667] an unavailable replay cursor repairs sprint order from authoritative reads", async () => {
  const server = boundary();
  server.mount();
  await screen.findByTestId("sprint-card-planned-01");
  const transport = await connect();
  server.reorder();
  act(() => {
    transport.send({ __typename: "RunStatusSnapshot", project_id: PROJECT, cursor: 150,
      at: "2026-10-09T10:00:00Z", runs: [], automation_attempts: [] });
    transport.send({ __typename: "RunStatusResetRequired", project_id: PROJECT, cursor: 150,
      reason: "cursor_unavailable" });
  });
  await waitFor(() => expect(plannedOrder().slice(0, 2)).toEqual(["Planned 02", "Planned 01"]));
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Planned choices" })).getAllByRole("listitem").slice(0, 2)
    .map((row) => row.textContent)).toEqual(["Planned 02", "Planned 01"]));
});

it("[overhaul-669] a public-project sprint fact repairs a closed graph cached under compact project identity", async () => {
  const compactId = "11111111111111111111111111111111";
  const publicId = "11111111-1111-1111-1111-111111111111";
  const server = boundary(compactId);
  const mounted = server.mount();
  await screen.findByTestId("sprint-card-planned-01");
  const transport = await connect(publicId);
  mounted.rerender(<StudioApolloProvider><p>Planning closed</p></StudioApolloProvider>);
  server.reorder();
  const readsBefore = server.graphReads.length;
  act(() => transport.send(sprintFact(101, compactId, publicId)));
  await waitFor(() => expect(server.graphReads.slice(readsBefore)).toEqual([compactId]));
  mounted.rerender(<StudioApolloProvider>{server.content}</StudioApolloProvider>);
  await waitFor(() => expect(plannedOrder().slice(0, 2)).toEqual(["Planned 02", "Planned 01"]));
});
