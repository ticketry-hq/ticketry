import { ApolloClient, ApolloLink, InMemoryCache, Observable } from "@apollo/client";
import { ApolloProvider } from "@apollo/client/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SprintGoals from "../features/sprints/goals/SprintGoals";

function goalsFixture(completed = false, failCreate = false) {
  let goals: { __typename: "WorktrackerSprintGoal"; id: string; text: string; position: number }[] = [];
  let nextId = 1;
  const client = new ApolloClient({ cache: new InMemoryCache(), link: new ApolloLink((operation) =>
    new Observable((observer) => {
      if (operation.operationName === "SprintGoals") {
        observer.next({ data: { worktrackerSprintGoal: { __typename: "WorktrackerSprintGoalConnection", nodes: goals } } });
      } else if (operation.operationName === "CreateSprintGoal") {
        if (failCreate) { observer.error(new Error("Goals service unavailable")); return; }
        const goal = { __typename: "WorktrackerSprintGoal" as const, id: `goal-${nextId++}`, text: String(operation.variables.text), position: goals.length + 1 };
        goals = [...goals, goal];
        observer.next({ data: { create_sprint_goal: goal } });
      } else if (operation.operationName === "DeleteSprintGoal") {
        goals = goals.filter((goal) => goal.id !== operation.variables.id);
        observer.next({ data: { delete_sprint_goal: true } });
      } else { observer.error(new Error(`Unexpected operation ${operation.operationName}`)); return; }
      observer.complete();
    })) });
  render(<ApolloProvider client={client}><SprintGoals sprintId="sprint-1" completed={completed} /></ApolloProvider>);
}

describe("Sprint card goal editor", () => {
  it("[overhaul-448] adds two numbered goals with Enter and removes one", async () => {
    goalsFixture();
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Goal" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "+ Goal" }));
    const input = screen.getByRole("textbox", { name: "New sprint goal" });
    fireEvent.change(input, { target: { value: "Deliver planning" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Deliver planning")).toBeInTheDocument());
    await waitFor(() => expect(input).toHaveValue(""));
    fireEvent.change(input, { target: { value: "Keep navigation" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Keep navigation")).toBeInTheDocument());
    expect(screen.getByText("G1")).toBeInTheDocument();
    expect(screen.getByText("G2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove goal: Deliver planning" }));
    await waitFor(() => expect(screen.queryByText("Deliver planning")).not.toBeInTheDocument());
    expect(screen.getByText("Keep navigation")).toBeInTheDocument();
  });

  it("[overhaul-449] keeps a failed goal draft and lets Escape cancel it", async () => {
    goalsFixture(false, true);
    await waitFor(() => expect(screen.getByRole("button", { name: "+ Goal" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "+ Goal" }));
    const input = screen.getByRole("textbox", { name: "New sprint goal" });
    fireEvent.change(input, { target: { value: "Try again" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Goals service unavailable");
    expect(input).toHaveValue("Try again");
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("[overhaul-450] offers no goal changes on completed sprints", async () => {
    goalsFixture(true);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "+ Goal" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
