import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const projectReads = vi.hoisted(() => ({ readProjectOpen: vi.fn() }));

vi.mock("../features/projects/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/projects/queries/readTransport")),
  readProjectOpen: projectReads.readProjectOpen,
}));

import { setStorySprintFilterIntent } from "../features/work-items";
import { useModalStore } from "../app/modal/modalStore";
import { StudioFooter } from "../app/shell/StudioFooter";
import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import {
  getModulePresentationsSnapshot,
} from "../features/module-tabs";
import { seedModuleLinks } from "../features/module-links";
import { useStudioStore } from "../features/projects/store";
import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";
import type { Module, ModulePresentation, Project } from "../shared/api/types";
import { resetStudioApolloClient } from "../shared/apollo/client";
import { useClientStore } from "../state/clientStore";
import { projectOpenFixture } from "./projectOpenFixture";

const PROJECT_ID = "project-1";
const PROJECT: Project = {
  id: PROJECT_ID,
  name: "Project",
  slug: "PRJ",
  description: "",
};

function module(
  id: string,
  name: string,
  index: number,
  isArchived = false,
): Module {
  return {
    id,
    name,
    project_id: PROJECT_ID,
    key: "PRJ-" + (index + 1),
    sequence_id: index + 1,
    is_archived: isArchived,
    issue_type: "module-type",
  };
}

let modules: Module[] = [];
let presentations = new Map<string, ModulePresentation>();
let operationNames: string[] = [];
let visibilityVariables: Array<{ moduleId: string; tabHidden: boolean }> = [];

function projectOpenResult() {
  const result = projectOpenFixture(
    { ...PROJECT, manual_module_order: true },
    modules,
  );
  result.data.module_presentations.nodes = [...presentations.values()].map(
    (presentation) => ({
      __typename: "WorktrackerModulepresentation",
      ...presentation,
      module: {
        __typename: "WorktrackerIssue",
        id: presentation.module_id,
        project_id: PROJECT_ID,
      },
    }),
  );
  return result;
}

function installVisibilityTransport() {
  const browser = createBrowserRuntime({ environment: {} });
  initializeStudioRuntime({
    ...browser,
    graphQlTransport: () => ({
      graphql_execute: async (requestJson: string) => {
        const request = JSON.parse(requestJson) as {
          operationName: string;
          variables: { moduleId: string; tabHidden: boolean };
        };
        operationNames.push(request.operationName);
        visibilityVariables.push(request.variables);
        const current = presentations.get(request.variables.moduleId);
        const next: ModulePresentation = {
          module_id: request.variables.moduleId,
          rank: current?.rank ?? "",
          tab_hidden: request.variables.tabHidden,
        };
        presentations.set(next.module_id, next);
        return JSON.stringify({
          data: {
            update_module_presentation: {
              __typename: "WorktrackerModulepresentation",
              ...next,
            },
          },
        });
      },
      graphql_subscribe: async () => "subscription",
      graphql_unsubscribe: async () => true,
    }),
  });
}

function hide(moduleId: string, rank: string) {
  presentations.set(moduleId, {
    module_id: moduleId,
    rank,
    tab_hidden: true,
  });
}

function pickerChoices(): string[] {
  const picker = screen.getByRole("dialog", { name: "Module picker" });
  return within(picker)
    .queryAllByRole("option", { name: /^Restore .+ module tab$/ })
    .map((choice) => choice.textContent ?? "");
}

async function openPicker() {
  const trigger = await screen.findByRole("button", { name: "Open module picker" });
  fireEvent.click(trigger);
  return screen.getByRole("dialog", { name: "Module picker" });
}

describe("restore-aware module picker acceptance", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(async () => {
    await resetStudioApolloClient();
    setStorySprintFilterIntent(PROJECT_ID, { mode: "all" });
    modules = [
      module("module-a", "Alpha", 0),
      module("module-b", "Bravo", 1),
      module("module-c", "Charlie", 2),
    ];
    presentations = new Map(
      modules.map((entry, index) => [
        entry.id,
        {
          module_id: entry.id,
          rank: String(index).padStart(8, "0"),
          tab_hidden: false,
        },
      ]),
    );
    operationNames = [];
    visibilityVariables = [];
    projectReads.readProjectOpen.mockReset().mockImplementation(async () => projectOpenResult());
    installVisibilityTransport();
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useModalStore.setState({ modalStack: [] });
    useClientStore.setState({
      selectedModuleId: null,
      selectModule: vi.fn(async (moduleId: string) => {
        useClientStore.setState({ selectedModuleId: moduleId });
      }),
      toasts: [],
    });
  });

  it("[overhaul-660] bounds a long picker below the top tabs while keeping search and the last choice usable", async () => {
    modules = Array.from({ length: 40 }, (_, index) =>
      module("module-" + index, "Module " + index, index));
    modules.forEach((entry, index) => hide(entry.id, String(index).padStart(8, "0")));
    render(<ModuleTabStrip />);
    const trigger = await screen.findByRole("button", { name: "Open module picker" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      bottom: 40, right: 300,
    } as DOMRect);
    fireEvent.click(trigger);
    const picker = screen.getByRole("dialog", { name: "Module picker" });
    const listbox = within(picker).getByRole("listbox", { name: "Module choices" });
    const search = within(picker).getByRole("combobox", { name: "Search modules" });

    expect(picker).toHaveStyle({ maxHeight: "min(24rem, calc(100dvh - 52px))" });
    expect(listbox).toHaveClass("min-h-0", "overflow-y-auto");
    expect(listbox).not.toContainElement(search);
    expect(search).toHaveClass("shrink-0");
    expect(within(listbox).getAllByRole("option")).toHaveLength(41);
    fireEvent.click(within(listbox).getByRole("option", { name: "Restore Module 39 module tab" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Module 39" }))
      .toHaveAttribute("aria-selected", "true"));
  });

  it("[overhaul-661] reveals keyboard choices in a long picker without moving search focus", async () => {
    modules = Array.from({ length: 40 }, (_, index) =>
      module("module-" + index, "Module " + index, index));
    modules.forEach((entry, index) => hide(entry.id, String(index).padStart(8, "0")));
    render(<ModuleTabStrip />);
    const picker = await openPicker();
    const search = within(picker).getByRole("combobox", { name: "Search modules" });
    const last = within(picker).getByRole("option", { name: "Restore Module 39 module tab" });
    const revealLast = vi.spyOn(last, "scrollIntoView");
    revealLast.mockClear();
    fireEvent.keyDown(search, { key: "ArrowUp" });

    expect(search).toHaveAttribute("aria-activedescendant", last.id);
    expect(search).toHaveFocus();
    expect(revealLast).toHaveBeenCalledWith({ block: "nearest" });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Module 39" }))
      .toHaveAttribute("aria-selected", "true"));
  });

  it("[overhaul-237] keeps the footer manager entry outside the scrolling module tabs and creation", async () => {
    render(
      <>
        <ModuleTabStrip />
        <StudioFooter />
      </>,
    );

    const strip = screen.getByLabelText("Project modules");
    const modulesToggle = screen.getByRole("button", {
      name: "Open Module Manager",
    });
    const tablist = screen.getByRole("tablist", {
      name: "Project module tabs",
    });
    const tabScroller = screen.getByLabelText("Scrollable project module tabs");
    const modulePicker = await screen.findByRole("button", {
      name: "Open module picker",
    });

    expect(document.querySelector("[data-studio-status-bar]")).toContainElement(modulesToggle);
    expect(strip).not.toContainElement(modulesToggle);
    expect(strip.firstElementChild).toBe(tabScroller);
    expect(tablist.nextElementSibling).toContainElement(modulePicker);
    expect(tabScroller).toContainElement(tablist);
    expect(tabScroller).toContainElement(modulePicker);
    expect(within(tablist).getAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id")).at(-1)).toHaveAccessibleName("Charlie");
    expect(tabScroller).toHaveClass("min-w-0", "flex-1", "overflow-x-auto");

    fireEvent.click(modulePicker);
    expect(screen.getByRole("dialog", { name: "Module picker" }).parentElement)
      .toBe(document.body);
  });

  it("opens creation as the first action and keeps the coach mark off the trigger", async () => {
    render(<ModuleTabStrip />);
    const picker = await openPicker();
    const trigger = screen.getByRole("button", { name: "Open module picker" });

    expect(trigger).not.toHaveAttribute("data-coach-anchor");
    expect(within(picker).getAllByRole("option")[0]).toHaveTextContent(
      "Create new module",
    );
    fireEvent.blur(
      within(picker).getByRole("combobox", { name: "Search modules" }),
      { relatedTarget: null },
    );
    fireEvent.click(
      within(picker).getByRole("option", { name: "Create new module" }),
    );

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    expect(useModalStore.getState().modalStack).toEqual([{ type: "add-module" }]);
  });

  it("selects a linked fallback when the active module tab is hidden", async () => {
    seedModuleLinks([{
      id: "link-charlie",
      moduleId: "module-c",
      path: "/repos/charlie",
    }]);
    useClientStore.setState({ selectedModuleId: "module-a" });
    render(<ModuleTabStrip />);

    fireEvent.click(await screen.findByRole("button", {
      name: "Hide Alpha tab",
    }));

    await waitFor(() =>
      expect(useClientStore.getState().selectModule).toHaveBeenCalledWith(
        "module-c", expect.objectContaining({ isCurrent: expect.any(Function) }),
      )
    );
    expect(useClientStore.getState().selectModule).not.toHaveBeenCalledWith(
      "module-b",
    );
    expect(useModalStore.getState().modalStack).toEqual([]);
  });

  it("searches hidden non-archived modules without changing canonical order", async () => {
    modules = [
      module("module-z", "Zinc", 0),
      module("module-a", "ALPACA", 1),
      module("module-v", "Visible", 2),
      module("module-r", "Archived alpha", 3, true),
      module("module-b", "Beta alpha", 4),
    ];
    hide("module-z", "00000000");
    hide("module-a", "00000001");
    hide("module-r", "00000003");
    hide("module-b", "00000004");
    render(<ModuleTabStrip />);
    const picker = await openPicker();

    expect(pickerChoices()).toEqual(["Zinc", "ALPACA", "Beta alpha"]);
    fireEvent.change(
      within(picker).getByRole("combobox", { name: "Search modules" }),
      { target: { value: "aLp" } },
    );
    expect(pickerChoices()).toEqual(["ALPACA", "Beta alpha"]);
  });

  it("restores before selection without changing rank or writing order", async () => {
    hide("module-b", "00000001");
    render(<ModuleTabStrip />);
    const picker = await openPicker();
    fireEvent.click(
      within(picker).getByRole("option", {
        name: "Restore Bravo module tab",
      }),
    );

    await waitFor(() =>
      expect(useClientStore.getState().selectModule).toHaveBeenCalledWith(
        "module-b", expect.objectContaining({ isCurrent: expect.any(Function) }),
      )
    );
    await waitFor(() =>
      expect(screen.getAllByRole("tab").filter((tab) => tab.hasAttribute("data-module-id")).map((tab) => tab.textContent)).toEqual([
        "Alpha",
        "Bravo",
        "Charlie",
      ]),
    );
    expect(visibilityVariables).toEqual([
      { moduleId: "module-b", tabHidden: false },
    ]);
    expect(operationNames).toEqual(["UpdateWorkTrackerModulePresentation"]);
    expect(
      getModulePresentationsSnapshot(PROJECT_ID).find(
        (presentation) => presentation.module_id === "module-b", expect.objectContaining({ isCurrent: expect.any(Function) }),
      ),
    ).toMatchObject({ rank: "00000001", tab_hidden: false });
  });

  it("keeps keyboard focus and active-choice ARIA valid through search and Escape", async () => {
    hide("module-b", "00000001");
    render(<ModuleTabStrip />);
    const picker = await openPicker();
    const trigger = screen.getByRole("button", { name: "Open module picker" });
    const search = within(picker).getByRole("combobox", { name: "Search modules" });
    const listbox = within(picker).getByRole("listbox", { name: "Module choices" });
    const create = within(listbox).getByRole("option", { name: "Create new module" });
    const restore = within(listbox).getByRole("option", {
      name: "Restore Bravo module tab",
    });

    expect(search).toHaveFocus();
    expect(search).toHaveAttribute("aria-controls", listbox.id);
    expect(search).toHaveAttribute("aria-activedescendant", create.id);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute("aria-activedescendant", restore.id);
    expect(restore).toHaveAttribute("aria-selected", "true");
    expect(search).toHaveFocus();

    fireEvent.change(search, { target: { value: "br" } });
    expect(search).toHaveAttribute("aria-activedescendant", create.id);
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    expect(screen.getByRole("combobox", { name: "Search modules" })).toHaveValue("");
  });

  it("[overhaul-338] closes when the open trigger is clicked again", async () => {
    render(<ModuleTabStrip />);
    const picker = await openPicker();
    const trigger = screen.getByRole("button", { name: "Open module picker" });
    const search = within(picker).getByRole("combobox", {
      name: "Search modules",
    });

    fireEvent.pointerDown(trigger);
    fireEvent.mouseDown(trigger);
    fireEvent.blur(search, { relatedTarget: trigger });
    trigger.focus();
    fireEvent.mouseUp(trigger);
    fireEvent.click(trigger);

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
  });

  it("restores the active hidden module with arrows and Enter", async () => {
    hide("module-b", "00000001");
    render(<ModuleTabStrip />);
    const picker = await openPicker();
    const search = within(picker).getByRole("combobox", {
      name: "Search modules",
    });

    fireEvent.change(search, { target: { value: "br" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    await waitFor(() =>
      expect(useClientStore.getState().selectModule).toHaveBeenCalledWith(
        "module-b", expect.objectContaining({ isCurrent: expect.any(Function) }),
      )
    );
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Bravo" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );
  });

  it("closes on outside click or focus leaving the picker", async () => {
    hide("module-b", "00000001");
    render(<ModuleTabStrip />);
    await openPicker();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();

    const picker = await openPicker();
    const choice = within(picker).getByRole("option", {
      name: "Restore Bravo module tab",
    });
    const tab = screen.getByRole("tab", { name: "Alpha" });
    choice.focus();
    fireEvent.blur(choice, { relatedTarget: tab });
    tab.focus();

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    expect(tab).toHaveFocus();
  });
});
