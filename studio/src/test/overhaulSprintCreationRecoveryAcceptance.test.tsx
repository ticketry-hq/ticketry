import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import NewSprintButton from "../features/sprints/NewSprintButton";
import { useCreateSprint } from "../features/sprints/mutations";
import { PlanningGraphDocument } from "../features/planning-graph";

const saved = { id: "saved-sprint", name: "Release", status: "planned", rank: "V", createdAt: "2026-10-04" };
const graph = {
  project: { __typename: "WorktrackerProjectConnection", nodes: [] },
  states: { __typename: "WorktrackerStateConnection", nodes: [] },
  issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
  modules: { __typename: "WorktrackerIssueConnection", nodes: [] },
  workItems: { __typename: "WorktrackerIssueConnection", nodes: [] },
  sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", ...saved }] },
};

function fixture() {
  let failGraph = true;
  let heldOperation: string | null = null;
  let release = () => {};
  const operations: string[] = [];
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) => new Observable((observer) => {
    const name = operation.operationName ?? "";
    operations.push(name);
    const deliver = () => {
      if (name === "PlanningGraph" && failGraph) observer.error(new Error("Planner is offline"));
      else {
        observer.next({ data: name === "PlanningGraph" ? graph
          : { worktrackerSprintCreateOne: { __typename: "WorktrackerSprint", ...saved } } });
        observer.complete();
      }
    };
    if (heldOperation === name) { heldOperation = null; release = deliver; }
    else deliver();
  })) });
  return { client, operations, recover: () => { failGraph = false; },
    holdNext: (operation: string) => { heldOperation = operation; return () => release(); },
  };
}

function Creation({ onCreated }: { onCreated: (id: string) => void }) {
  const { create } = useCreateSprint("project");
  return <NewSprintButton sprints={[]} onCreate={create} onCreated={onCreated} />;
}

function createNamedSprint() {
  fireEvent.click(screen.getByRole("button", { name: "New sprint" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Sprint name" }), { target: { value: "Release" } });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
}

it("[overhaul-545] retries refresh of a committed sprint without creating it twice", async () => {
  const { client, operations, recover } = fixture();
  const onCreated = vi.fn();
  const view = render(<ApolloProvider client={client}><Creation onCreated={onCreated} /></ApolloProvider>);
  try {
    createNamedSprint();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sprint created, but the view could not refresh: Planner is offline");
    expect(screen.getByRole("textbox", { name: "Sprint name" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(operations.filter((name) => name === "PlanningGraph")).toHaveLength(2));
    await screen.findByRole("button", { name: "Retry refresh" });
    recover();
    fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("saved-sprint"));
    expect(operations.filter((name) => name === "CreateSprint")).toHaveLength(1);
    expect(client.readQuery({ query: PlanningGraphDocument, variables: { projectId: "project" } })?.sprints.nodes[0]?.id).toBe("saved-sprint");
  } finally { view.unmount(); client.stop(); }
});

it.each(["create", "refresh"])("[overhaul-546] does not navigate after the project view closes during %s", async (phase) => {
  const { client, operations, recover, holdNext } = fixture();
  const onCreated = vi.fn();
  let release = () => {};
  if (phase === "create") { recover(); release = holdNext("CreateSprint"); }
  const view = render(<ApolloProvider client={client}><Creation onCreated={onCreated} /></ApolloProvider>);
  try {
    createNamedSprint();
    if (phase === "refresh") {
      await screen.findByRole("button", { name: "Retry refresh" });
      recover();
      release = holdNext("PlanningGraph");
      fireEvent.click(screen.getByRole("button", { name: "Retry refresh" }));
    }
    view.unmount();
    await act(async () => { release(); });
    await waitFor(() => expect(client.readQuery({ query: PlanningGraphDocument, variables: { projectId: "project" } })?.sprints.nodes[0]?.id).toBe("saved-sprint"));
    expect(onCreated).not.toHaveBeenCalled();
    expect(operations.filter((name) => name === "CreateSprint")).toHaveLength(1);
  } finally { release(); view.unmount(); client.stop(); }
});
