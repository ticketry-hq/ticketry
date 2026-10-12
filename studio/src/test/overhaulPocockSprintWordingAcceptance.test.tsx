import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";
import { ModuleTab } from "../app/shell/ticket-workspace/ModuleTab";
import { StoriesFilterEmptyState, StorySprintFilterController } from "../features/work-items";
import { setStorySprintFilterIntent } from "../features/work-items/internal/storySprintFilterStore";
import type { Module } from "../shared/api/types";

const SPRINT = /sprint/i;

/** Visible text plus the accessible names, titles and descriptions a user can reach. */
function sprintWordingIn(root: HTMLElement): string[] {
  const found: string[] = [];
  if (SPRINT.test(root.textContent ?? "")) found.push(`text: ${root.textContent}`);
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of ["title", "aria-label", "aria-description", "placeholder"]) {
      const value = element.getAttribute(attribute);
      if (value && SPRINT.test(value)) found.push(`${attribute}: ${value}`);
    }
  }
  return found;
}

const MODULE: Module = {
  id: "module-1", name: "Ticketry", project_id: "project-1", key: "PRJ-1",
  sequence_id: 1, is_archived: false, issue_type: "module-type",
};

it("[CODING-2863] Pocock module tab hide control never asks the user to show all sprints", () => {
  render(<ModuleTab module={MODULE} isSelected dropIntent={null} onSelect={vi.fn()}
    onHide={vi.fn()} registerRef={vi.fn()} canHide={false} />);
  const hide = screen.getByRole("button", { name: "Hide Ticketry tab" });
  expect(hide).toBeDisabled();
  expect(hide).not.toHaveAttribute("aria-description");
  expect(sprintWordingIn(hide.parentElement!)).toEqual([]);
});

it("[CODING-2863] Pocock Stories empty state uses edition-neutral wording without sprint recovery", () => {
  render(<StorySprintFilterController projectId="project-1"><StoriesFilterEmptyState /></StorySprintFilterController>);
  expect(screen.getByRole("status")).toHaveTextContent("No stories.");
  expect(screen.queryByRole("button", { name: "Show all sprints" })).toBeNull();
  expect(sprintWordingIn(document.body)).toEqual([]);
});

it("[CODING-2863] mounted Pocock shell shows no sprint wording on module tabs or in an empty Stories search", async () => {
  const f = editionAcceptanceFixture();
  f.mount();
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-24" }));
  const stories = await screen.findByTestId("tasks-pane-body");
  await within(stories).findByRole("treeitem", { name: /Roadmap current story/ });
  const tabs = screen.getByRole("tablist", { name: "Project module tabs" });
  const hideButtons = within(tabs).getAllByRole("button", { name: /^Hide .* tab$/ });
  expect(hideButtons.length).toBeGreaterThan(0);
  for (const hide of hideButtons) {
    expect(hide).toBeEnabled();
    expect(hide).toHaveAttribute("title", "Hide tab");
    expect(hide).not.toHaveAttribute("aria-description");
  }
  expect(sprintWordingIn(document.querySelector<HTMLElement>('[aria-label="Project modules"]')!)).toEqual([]);
  fireEvent.change(within(stories).getByRole("textbox", { name: "Search stories" }), { target: { value: "nothing matches this" } });
  expect(await within(stories).findByText('No stories match "nothing matches this".')).toBeVisible();
  expect(sprintWordingIn(stories)).toEqual([]);
});

it("[CODING-2863] mounted Pocock shell exposes no Plan, Find stories, epic planning or suggestion review surface", async () => {
  const f = editionAcceptanceFixture();
  f.mount();
  await screen.findByRole("treeitem", { name: /Roadmap current story/ });
  expect(screen.queryByTestId("workspace-tab-plan")).toBeNull();
  expect(screen.queryByRole("tab", { name: /Plan/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Find stories/i })).toBeNull();
  expect(screen.queryByText(/Find stories/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /epic/i })).toBeNull();
  expect(screen.queryByText("Retained suggestion")).toBeNull();
  expect(screen.queryByText("Ship retained goal")).toBeNull();
  expect(screen.queryByRole("region", { name: /suggestion/i })).toBeNull();
  expect(sprintWordingIn(document.body)).toEqual([]);
});

it("[CODING-2863] Pocock Module Manager has no sprint membership group", async () => {
  const f = editionAcceptanceFixture();
  f.mount({ selectedTaskId: null });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  expect(within(manager).getByRole("region", { name: "Open" })).toBeVisible();
  expect(within(manager).getByRole("region", { name: "Hidden" })).toBeVisible();
  expect(within(manager).getByRole("region", { name: "Archived" })).toBeVisible();
  expect(within(manager).queryByRole("region", { name: "Not in sprint" })).toBeNull();
  expect(sprintWordingIn(manager)).toEqual([]);
});
