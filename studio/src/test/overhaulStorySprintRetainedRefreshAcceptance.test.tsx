import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { mountStudio } from "./seam";
import { storySprintPaginationBoundary } from "./storySprintPaginationBoundary";

it("[overhaul-592] refreshes retained later-page names and membership on reopen while keeping loaded choices available", async () => {
  const boundary = storySprintPaginationBoundary();
  mountStudio({ http: boundary.http, graphQlExecute: boundary.execute });
  const trigger = await screen.findByRole("button", { name: "Sprint: Current cycle, Active" });
  fireEvent.click(trigger);
  await screen.findByRole("option", { name: /Planned 05/ });
  fireEvent.click(screen.getByRole("button", { name: "Load more planned sprints" }));
  await screen.findByRole("option", { name: /Planned 10/ });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Search sprints" }), { key: "Escape" });

  boundary.rows.find((row) => row.id === "planned-07")!.name = "Renamed externally";
  const replaced = boundary.rows.findIndex((row) => row.id === "planned-08");
  boundary.rows[replaced] = { ...boundary.rows[replaced]!, id: "replacement-sprint", name: "Replacement sprint" };
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  boundary.beforePage(async () => pending);

  fireEvent.click(trigger);
  expect(screen.getByRole("option", { name: /Planned 07/ })).toBeVisible();
  expect(screen.getByRole("option", { name: /Planned 10/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Planned.*10 of 14/ })).toBeVisible();
  await act(async () => release());

  expect(await screen.findByRole("option", { name: /Renamed externally/ })).toBeVisible();
  expect(await screen.findByRole("option", { name: /Replacement sprint/ })).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("option", { name: /Planned 08/ })).toBeNull());
  expect(screen.queryByRole("option", { name: /Planned 07/ })).toBeNull();
  expect(screen.getByRole("option", { name: /Planned 10/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Planned.*10 of 14/ })).toBeVisible();
});

it("[overhaul-593] preserves retained choices after a later-page reopen failure and refreshes them through Retry", async () => {
  const boundary = storySprintPaginationBoundary();
  mountStudio({ http: boundary.http, graphQlExecute: boundary.execute });
  const trigger = await screen.findByRole("button", { name: "Sprint: Current cycle, Active" });
  fireEvent.click(trigger);
  await screen.findByRole("option", { name: /Planned 05/ });
  fireEvent.click(screen.getByRole("button", { name: "Load more planned sprints" }));
  await screen.findByRole("option", { name: /Planned 10/ });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Search sprints" }), { key: "Escape" });

  boundary.rows.find((row) => row.id === "planned-07")!.name = "Renamed externally";
  let fail = true;
  boundary.beforePage((request) => {
    if (fail && request.filters.status.eq === "planned" && request.pagination.offset.offset === 5) {
      throw new FoundationGraphQlError("unknown", "Retained page unavailable");
    }
  });
  fireEvent.click(trigger);
  const retry = await screen.findByRole("button", { name: "Retry planned sprints" });
  expect(screen.getByRole("option", { name: /Planned 07/ })).toBeVisible();
  expect(screen.getByRole("option", { name: /Planned 10/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Planned.*10 of 14/ })).toBeVisible();

  fail = false;
  fireEvent.click(retry);
  expect(await screen.findByRole("option", { name: /Renamed externally/ })).toBeVisible();
  expect(screen.queryByRole("option", { name: /Planned 07/ })).toBeNull();
  expect(screen.getByRole("option", { name: /Planned 10/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Planned.*10 of 14/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Retry planned sprints" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load more planned sprints" }));
  expect(await screen.findByRole("option", { name: /Planned 14/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Planned.*14 of 14/ })).toBeVisible();
});
