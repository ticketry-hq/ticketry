import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { PlanningGraphDocument } from "../features/planning-graph";
import { SprintSuggestionExecutionDocument, SprintSuggestionsDocument, UpdateSprintSuggestionDocument } from "../features/sprints/generated/sprints.documents";
import { studioApolloClient } from "../shared/apollo/client";
import { mountProposal, reviewProposal } from "./planSuggestionFixture";

it("[overhaul-832] Retry after another planner accepts and Undoes a rejected proposal reuses its retained Story", async () => {
  const plan = mountProposal({ freshProposal: true });
  const detail = await reviewProposal();
  fireEvent.change(detail.getByRole("textbox", { name: "Title" }), { target: { value: "  Edited release  " } });
  plan.failNextDecision();
  fireEvent.click(detail.getByRole("button", { name: "Create story" }));
  await screen.findByRole("button", { name: "Retry accepting Agent wording suggestion" });

  // A second planner uses the public update contract, then this visit receives
  // current authoritative reads while retaining its rejected decision feedback.
  const client = studioApolloClient();
  await act(async () => {
    await client.mutate({ mutation: UpdateSprintSuggestionDocument,
      variables: { id: "proposal", status: "accepted", proposedName: "Published release" } });
    await client.mutate({ mutation: UpdateSprintSuggestionDocument,
      variables: { id: "proposal", status: "waiting" } });
    await client.refetchQueries({ include: [PlanningGraphDocument, SprintSuggestionsDocument, SprintSuggestionExecutionDocument] });
  });
  const restored = await screen.findByRole("button", { name: "Accept Published release" });
  await waitFor(() => expect(restored).toBeEnabled());
  const current = client.readQuery({ query: SprintSuggestionsDocument, variables: { sprintId: "release" } })!;
  expect(current.worktrackerSprintSuggestion.nodes[0]).toMatchObject({
    id: "proposal", status: "waiting", issueId: "created-story", proposedName: null,
    issue: { id: "created-story", name: "Published release", sprintId: null },
  });

  const retry = screen.getByRole("button", { name: "Retry accepting Agent wording suggestion" });
  expect(retry).toBeEnabled();
  fireEvent.click(retry);
  await waitFor(() => expect(plan.decisions).toEqual([
    { id: "proposal", status: "accepted", proposedName: "Edited release" },
    { id: "proposal", status: "accepted", proposedName: "Published release" },
    { id: "proposal", status: "waiting" },
    { id: "proposal", status: "accepted" },
  ]));
  await waitFor(() => expect(within(screen.getByTestId("plan-sprint-items")).getByText("Published release")).toBeVisible());
  expect(await screen.findByText("Selected ticket created-story")).toBeVisible();
  const accepted = client.readQuery({ query: SprintSuggestionsDocument, variables: { sprintId: "release" } })!;
  expect(accepted.worktrackerSprintSuggestion.nodes[0]).toMatchObject({
    id: "proposal", status: "accepted", issueId: "created-story", proposedName: null,
    issue: { id: "created-story", name: "Published release", sprintId: "release" },
  });
  expect(screen.queryByRole("button", { name: /^Retry accepting/ })).not.toBeInTheDocument();
});
