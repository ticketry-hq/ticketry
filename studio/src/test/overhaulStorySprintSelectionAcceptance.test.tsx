import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useUpdateSprint } from "../features/sprints";
import { mountStudio } from "./seam";
import { storySprintPaginationBoundary } from "./storySprintPaginationBoundary";

function LifecycleControls() {
  const { update } = useUpdateSprint();
  return <><button onClick={() => void update({ id: "planned-01", status: "active" })}>Start chosen sprint</button>
    <button onClick={() => void update({ id: "planned-01", status: "completed" })}>Complete chosen sprint</button></>;
}

it("[overhaul-483] preserves explicit sprint identity through local lifecycle writes and failed lookups, then recovers after scoped absence", async () => {
  const boundary = storySprintPaginationBoundary();
  let failSelected = false;
  let selectedReads = 0;
  mountStudio({ http: boundary.http, children: <LifecycleControls />, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "StorySelectedSprint") {
      selectedReads++;
      if (failSelected) throw new Error("Temporary selected sprint outage");
    }
    if (operation === "UpdateSprint") {
      const input = variables as { id: string; status: string };
      const chosen = boundary.rows.find((row) => row.id === input.id)!;
      if (input.status === "active") boundary.rows.forEach((row) => {
        if (row.status === "active") row.status = "completed";
      });
      chosen.status = input.status;
      boundary.http.storySprints(boundary.rows);
      return { update_sprint: { __typename: "WorktrackerSprint", id: chosen.id,
        name: chosen.name, status: chosen.status, rank: chosen.rank, createdAt: chosen.createdAt } } as never;
    }
    return boundary.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Current cycle, Active" }));
  fireEvent.click(await screen.findByRole("option", { name: /Planned 01 planned/i }));
  await screen.findByRole("button", { name: "Sprint: Planned 01, Planned" });
  fireEvent.click(screen.getByRole("button", { name: "Start chosen sprint" }));
  await screen.findByRole("button", { name: "Sprint: Planned 01, Active" });
  const beforeComplete = selectedReads;
  fireEvent.click(screen.getByRole("button", { name: "Complete chosen sprint" }));
  await screen.findByRole("button", { name: "Sprint: Planned 01, Completed" });
  await waitFor(() => expect(selectedReads).toBeGreaterThan(beforeComplete));
  const beforeFailure = selectedReads;
  failSelected = true;
  await act(async () => fireEvent(window, new Event("focus")));
  await waitFor(() => expect(selectedReads).toBeGreaterThan(beforeFailure));
  await screen.findByRole("button", { name: "Retry" });
  expect(screen.getByRole("button", { name: "Sprint: Planned 01, Completed" })).toBeVisible();
  failSelected = false;
  boundary.http.storySprints(boundary.rows.filter((row) => row.id !== "planned-01"));
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Sprint: All sprints" });
  expect(screen.getByText("The selected sprint is no longer available. Showing all sprints.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Sprint: All sprints" }));
  fireEvent.click(await screen.findByRole("option", { name: /Planned 02 planned/i }));
  await screen.findByRole("button", { name: "Sprint: Planned 02, Planned" });
  boundary.rows.find((row) => row.id === "planned-02")!.projectId = "project-2";
  boundary.http.storySprints(boundary.rows);
  await act(async () => fireEvent(window, new Event("focus")));
  await screen.findByRole("button", { name: "Sprint: All sprints" });
  expect(screen.getByText("The selected sprint is no longer available. Showing all sprints.")).toBeVisible();
});
