import { act, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useStoriesTree } from "../features/work-items";
import { mountStudio } from "./seam";
import { storySprintPaginationBoundary } from "./storySprintPaginationBoundary";

function ShellKeyboard() {
  const { rows } = useStoriesTree();
  useGlobalKeymap(rows);
  return null;
}

it("[overhaul-484] browses separate five-sprint pages and retains each collection across switches and reopen", async () => {
  const boundary = storySprintPaginationBoundary();
  mountStudio({ http: boundary.http, graphQlExecute: boundary.execute });
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Current cycle, Active" }));
  const dialog = screen.getByRole("dialog", { name: "Choose sprint" });
  const planned = await within(dialog).findByRole("button", { name: /Planned.*5 of 14/ });
  expect(planned).toHaveAttribute("aria-expanded", "true");
  const completed = await within(dialog).findByRole("button", { name: /Completed.*23/ });
  expect(completed).toHaveAttribute("aria-expanded", "false");
  expect(within(dialog).getAllByRole("option")).toHaveLength(8);
  expect(within(dialog).queryByRole("option", { name: /foreign/ })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Load more planned sprints" }));
  await within(dialog).findByRole("button", { name: /Planned.*10 of 14/ });
  fireEvent.click(completed);
  expect(planned).toHaveAttribute("aria-expanded", "false");
  expect(within(dialog).getAllByRole("option")).toHaveLength(8);
  fireEvent.click(within(dialog).getByRole("button", { name: "Load more completed sprints" }));
  await within(dialog).findByRole("button", { name: /Completed.*10 of 23/ });
  fireEvent.click(planned);
  expect(within(dialog).getAllByRole("option")).toHaveLength(13);
  fireEvent.keyDown(within(dialog).getByRole("option", { name: /Planned 01 planned 0/i }), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Sprint: Current cycle, Active" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /Planned.*10 of 14/ })).toBeVisible());
  expect(screen.getByRole("option", { name: /Planned 10/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Completed.*10 of 23/ }));
  expect(await screen.findByRole("option", { name: /Completed 18/ })).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Load more completed sprints" })).toBeEnabled());
  expect(boundary.requests.slice(0, 2)).toEqual([
    { filters: { projectId: { eq: "project-1" }, status: { eq: "planned" } }, order: { rank: "ASC", id: "ASC" }, pagination: { offset: { limit: 5, offset: 0 } } },
    { filters: { projectId: { eq: "project-1" }, status: { eq: "completed" } }, order: { rank: "DESC", id: "DESC" }, pagination: { offset: { limit: 5, offset: 0 } } },
  ]);
  expect(boundary.requests.every((request) => request.filters.projectId.eq === "project-1" && request.pagination.offset.limit === 5)).toBe(true);
});

it("[overhaul-485] searches unloaded project history after 200ms, keeps Active pinned and clears independently of Story search", async () => {
  const boundary = storySprintPaginationBoundary();
  mountStudio({ http: boundary.http, graphQlExecute: boundary.execute });
  const storySearch = await screen.findByRole("textbox", { name: "Search stories" });
  fireEvent.change(storySearch, { target: { value: "Story" } });
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Current cycle, Active" }));
  const search = screen.getByRole("textbox", { name: "Search sprints" });
  await screen.findByRole("option", { name: /Planned 01/ });
  fireEvent.click(screen.getByRole("button", { name: "Load more planned sprints" }));
  await screen.findByRole("option", { name: /Planned 10/ });
  fireEvent.change(search, { target: { value: "  pLaNnEd 14  " } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(boundary.requests.some((request) => request.filters.name)).toBe(false);
  expect(await screen.findByRole("option", { name: /Planned 14/ })).toBeVisible();
  expect(screen.queryByRole("option", { name: /Planned 01/ })).toBeNull();
  expect(screen.getByRole("option", { name: /Current cycle Active/ })).toBeVisible();
  expect(boundary.requests.filter((request) => request.filters.name).map((request) => request.filters)).toEqual([
    { projectId: { eq: "project-1" }, status: { eq: "planned" }, name: { contains: "pLaNnEd 14" } },
    { projectId: { eq: "project-1" }, status: { eq: "completed" }, name: { contains: "pLaNnEd 14" } },
  ]);
  let releaseOld: () => void = () => {};
  const oldRequest = new Promise<void>((resolve) => { releaseOld = resolve; });
  boundary.beforePage(async (request) => {
    if (request.filters.name?.contains === "Planned 13") await oldRequest;
  });
  fireEvent.change(search, { target: { value: "Planned 13" } });
  await waitFor(() => expect(boundary.requests.some((request) => request.filters.name?.contains === "Planned 13")).toBe(true));
  fireEvent.change(search, { target: { value: "Planned 14" } });
  expect(await screen.findByRole("option", { name: /Planned 14/ })).toBeVisible();
  await act(async () => releaseOld());
  expect(screen.queryByRole("option", { name: /Planned 13/ })).toBeNull();
  expect(screen.getByRole("option", { name: /Planned 14/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Clear sprint search" }));
  expect(search).toHaveValue("");
  expect(await screen.findByRole("option", { name: /Planned 01/ })).toBeVisible();
  expect(storySearch).toHaveValue("Story");
  await screen.findByRole("button", { name: /Planned.*5 of 14/ });
  expect(screen.queryByRole("option", { name: /Planned 10/ })).toBeNull();
});


it("[overhaul-486] preserves choices and retry focus after a failed page, suppressing duplicate requests at the same offset", async () => {
  const boundary = storySprintPaginationBoundary();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let fail = true;
  boundary.beforePage(async (request) => {
    if (request.filters.status.eq === "planned" && request.pagination.offset.offset === 5 && fail) {
      await pending;
      throw new FoundationGraphQlError("unknown", "Next page failed");
    }
  });
  mountStudio({ http: boundary.http, graphQlExecute: boundary.execute });
  fireEvent.click(await screen.findByRole("button", { name: "Sprint: Current cycle, Active" }));
  await screen.findByRole("option", { name: /Planned 05/ });
  const load = screen.getByRole("button", { name: "Load more planned sprints" });
  load.focus();
  fireEvent.click(load);
  fireEvent.click(load);
  expect(load).toBeDisabled();
  expect(boundary.requests.filter((request) => request.pagination.offset.offset === 5)).toHaveLength(1);
  await act(async () => release());
  const retry = await screen.findByRole("button", { name: "Retry planned sprints" });
  expect(retry).toHaveFocus();
  expect(screen.getByRole("option", { name: /Planned 01/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /Planned.*5 of 14/ })).toBeVisible();
  fail = false;
  fireEvent.click(retry);
  expect(await screen.findByRole("option", { name: /Planned 06/ })).toHaveFocus();
  expect(boundary.requests.filter((request) => request.pagination.offset.offset === 5).map((request) => request.filters.status.eq)).toEqual(["planned", "planned"]);
});

it("[overhaul-487] owns section and paginated keyboard controls, announces appended choices and permits Tab exit", async () => {
  const boundary = storySprintPaginationBoundary();
  mountStudio({ http: boundary.http, graphQlExecute: boundary.execute, children: <ShellKeyboard /> });
  const trigger = await screen.findByRole("button", { name: "Sprint: Current cycle, Active" });
  fireEvent.click(trigger);
  expect(screen.getByRole("textbox", { name: "Search sprints" })).toHaveFocus();
  await screen.findByRole("option", { name: /Planned 05/ });
  const completed = screen.getByRole("button", { name: /Completed.*23/ });
  completed.focus();
  fireEvent.keyDown(completed, { key: "Enter" });
  expect(completed).toHaveAttribute("aria-expanded", "true");
  const load = screen.getByRole("button", { name: "Load more completed sprints" });
  load.focus();
  fireEvent.keyDown(load, { key: "Enter" });
  const appended = await screen.findByRole("option", { name: /Completed 18/ });
  expect(appended).toHaveFocus();
  expect(appended).toHaveAttribute("tabindex", "0");
  expect(screen.getByText("5 more completed sprints loaded.")).toBeInTheDocument();
  fireEvent.keyDown(appended, { key: "ArrowDown" });
  const next = screen.getByRole("option", { name: /Completed 17/ });
  expect(next).toHaveFocus();
  expect(next).toHaveAttribute("tabindex", "0");
  expect(appended).toHaveAttribute("tabindex", "-1");
  let releasePage: () => void = () => {};
  const delayedPage = new Promise<void>((resolve) => { releasePage = resolve; });
  boundary.beforePage(async (request) => {
    if (request.filters.status.eq === "completed" && request.pagination.offset.offset === 10) await delayedPage;
  });
  load.focus();
  fireEvent.keyDown(load, { key: "Enter" });
  const plannedToggle = screen.getByRole("button", { name: /Planned.*14/ });
  await act(async () => plannedToggle.focus());
  await act(async () => releasePage());
  await screen.findByRole("option", { name: /Completed 13/ });
  expect(plannedToggle).toHaveFocus();
  expect(screen.getByText("5 more completed sprints loaded.")).toBeInTheDocument();
  expect(fireEvent.keyDown(plannedToggle, { key: "Tab" })).toBe(true);
  await act(async () => trigger.focus());
  expect(screen.queryByRole("dialog", { name: "Choose sprint" })).toBeNull();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const active = screen.getByRole("option", { name: /Current cycle Active/ });
  expect(active).toHaveFocus();
  fireEvent.keyDown(active, { key: "Escape" });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: /Completed 18/ }));
  await screen.findByRole("button", { name: "Sprint: Completed 18, Completed" });
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(screen.getByRole("option", { name: /Completed 18/ })).toHaveFocus();
});
