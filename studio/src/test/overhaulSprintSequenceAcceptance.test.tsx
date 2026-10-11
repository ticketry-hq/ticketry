import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { mountStudio } from "./seam";
import { storySprintPaginationBoundary } from "./storySprintPaginationBoundary";

it("[overhaul-658] offers planned sprints by ascending rank and history by descending rank despite creation time", async () => {
  const boundary = storySprintPaginationBoundary();
  // Creation timestamps stay untouched while rank determines the sprint sequence.
  boundary.rows.find((row) => row.id === "planned-14")!.rank = "Z0";
  boundary.rows.find((row) => row.id === "completed-01")!.rank = "T0";
  mountStudio({ http: boundary.http, graphQlExecute: boundary.execute });
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Current cycle, Active" }));
  const chooser = screen.getByRole("dialog", { name: "Choose sprint" });
  await within(chooser).findByRole("option", { name: /Planned 14/ });
  expect(within(chooser).getAllByRole("option").slice(3).map((option) => option.textContent)).toEqual([
    "Planned 14planned0", "Planned 01planned0", "Planned 02planned0", "Planned 03planned0", "Planned 04planned0",
  ]);
  fireEvent.click(await within(chooser).findByRole("button", { name: /Completed.*23/ }));
  await waitFor(() => expect(within(chooser).getAllByRole("option").slice(3).map((option) => option.textContent)).toEqual([
    "Completed 01completed0", "Completed 23completed0", "Completed 22completed0", "Completed 21completed0", "Completed 20completed0",
  ]));
  expect(boundary.requests.slice(0, 2).map((request) => request.order)).toEqual([
    { rank: "ASC", id: "ASC" }, { rank: "DESC", id: "DESC" },
  ]);
});
