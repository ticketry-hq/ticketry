import { QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/api/client", async () => {
  const actual = await vi.importActual<typeof import("../shared/api/client")>(
    "../shared/api/client",
  );
  return {
    ...actual,
    listModuleLinks: vi.fn().mockResolvedValue([]),
    listModulePresentations: vi.fn(),
    listModules: vi.fn(),
    reorderModulePresentation: vi.fn(),
    updateModulePresentation: vi.fn(),
  };
});

import { ModalHost } from "../app/modal/ModalHost";
import { useModalStore } from "../app/modal/modalStore";
import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { useStudioStore } from "../features/projects/store";
import * as api from "../shared/api/client";
import type { Module, ModulePresentation } from "../shared/api/types";
import { queryClient } from "../shared/query/queryClient";
import { useClientStore } from "../state/clientStore";

const PROJECT_ID = "project-1";
const listModules = vi.mocked(api.listModules);
const listPresentations = vi.mocked(api.listModulePresentations);
const updatePresentation = vi.mocked(api.updateModulePresentation);
const reorderPresentation = vi.mocked(api.reorderModulePresentation);

function module(id: string, name: string): Module {
  return {
    id,
    name,
    project_id: PROJECT_ID,
    key: id.toUpperCase(),
    sequence_id: 1,
    is_archived: false,
    issue_type: "module",
  } as unknown as Module;
}

function presentation(
  moduleId: string,
  tabHidden: boolean,
): ModulePresentation {
  return { module_id: moduleId, rank: "middle", tab_hidden: tabHidden };
}

function PickerSurface() {
  return (
    <QueryClientProvider client={queryClient}>
      <ModuleTabStrip />
      <ModalHost />
    </QueryClientProvider>
  );
}

function pickerChoices(): string[] {
  const picker = screen.getByRole("dialog", { name: "Module picker" });
  return within(picker)
    .queryAllByRole("option", { name: /^Restore .+ module tab$/ })
    .map((choice) => choice.textContent ?? "");
}

async function openPicker() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Open module picker" }),
  );
  return screen.getByRole("dialog", { name: "Module picker" });
}

function activateWithDesktopPointerSequence(
  picker: HTMLElement,
  choice: HTMLElement,
) {
  const search = within(picker).getByRole("combobox", {
    name: "Search modules",
  });

  const shouldMoveFocus = fireEvent.pointerDown(choice);
  if (shouldMoveFocus) fireEvent.blur(search, { relatedTarget: null });
  fireEvent.pointerUp(choice);
  fireEvent.click(choice);
}

describe("module picker acceptance", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(() => {
    queryClient.clear();
    listModules.mockReset();
    listPresentations.mockReset();
    updatePresentation.mockReset().mockImplementation(
      async (moduleId: string, body: { tab_hidden: boolean }) =>
        presentation(moduleId, body.tab_hidden),
    );
    reorderPresentation.mockReset();
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useClientStore.setState({ selectedModuleId: null, toasts: [] });
    useModalStore.setState({ modalStack: [] });
  });

  it("[overhaul-170] opens the picker before the existing creation flow", async () => {
    listModules.mockResolvedValue([module("module-a", "Alpha")]);
    listPresentations.mockResolvedValue([]);
    render(<PickerSurface />);

    const picker = await openPicker();

    expect(useModalStore.getState().modalStack).toEqual([]);
    expect(within(picker).getByRole("combobox", { name: "Search modules" }))
      .toBeVisible();
    expect(within(picker).getAllByRole("option")[0]).toHaveTextContent(
      "Create new module",
    );

    activateWithDesktopPointerSequence(
      picker,
      within(picker).getByRole("option", { name: "Create new module" }),
    );

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    expect(useModalStore.getState().modalStack).toEqual([
      { type: "add-module" },
    ]);
    expect(await screen.findByPlaceholderText("Module name")).toBeVisible();
  });

  it("[overhaul-171] filters eligible choices without changing canonical order", async () => {
    listModules.mockResolvedValue([
      module("module-z", "Zinc"),
      module("module-a", "ALPACA"),
      module("module-v", "Visible"),
      module("module-b", "Beta alpha"),
    ]);
    listPresentations.mockResolvedValue([
      presentation("module-z", true),
      presentation("module-a", true),
      presentation("module-r", true),
      presentation("module-b", true),
    ]);
    render(<PickerSurface />);

    const picker = await openPicker();
    expect(pickerChoices()).toEqual(["Zinc", "ALPACA", "Beta alpha"]);

    fireEvent.change(
      within(picker).getByRole("combobox", { name: "Search modules" }),
      { target: { value: "aLp" } },
    );

    expect(pickerChoices()).toEqual(["ALPACA", "Beta alpha"]);
    expect(
      within(picker).getByRole("option", { name: "Create new module" }),
    ).toBeVisible();

    fireEvent.change(
      within(picker).getByRole("combobox", { name: "Search modules" }),
      { target: { value: "no match" } },
    );
    expect(pickerChoices()).toEqual([]);
    expect(
      within(picker).getByRole("option", { name: "Create new module" }),
    ).toBeVisible();
  });

  it("[overhaul-172] restores and selects a hidden Module without writing order", async () => {
    let presentations = [presentation("module-b", true)];
    listModules.mockResolvedValue([
      module("module-a", "Alpha"),
      module("module-b", "Bravo"),
      module("module-c", "Charlie"),
    ]);
    listPresentations.mockImplementation(async () => presentations);
    updatePresentation.mockImplementation(async (moduleId, body) => {
      presentations = [presentation(moduleId, body.tab_hidden)];
      return presentations[0];
    });
    const selectModule = vi.fn(async (moduleId: string) => {
      useClientStore.setState({ selectedModuleId: moduleId });
    });
    useClientStore.setState({ selectModule });
    render(<PickerSurface />);

    const picker = await openPicker();
    activateWithDesktopPointerSequence(
      picker,
      within(picker).getByRole("option", {
        name: "Restore Bravo module tab",
      }),
    );

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    expect(selectModule).toHaveBeenCalledWith("module-b");
    await waitFor(() =>
      expect(updatePresentation).toHaveBeenCalledWith("module-b", {
        tab_hidden: false,
      }),
    );
    expect(updatePresentation).toHaveBeenCalledTimes(1);
    expect(selectModule).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Alpha",
        "Bravo",
        "Charlie",
      ]),
    );
    expect(screen.getByRole("tab", { name: "Bravo" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(reorderPresentation).not.toHaveBeenCalled();
  });

  it("[overhaul-173] shows no Module choices when every eligible tab is visible", async () => {
    listModules.mockResolvedValue([
      module("module-a", "Alpha"),
      module("module-b", "Bravo"),
    ]);
    listPresentations.mockResolvedValue([]);
    render(<PickerSurface />);

    const picker = await openPicker();

    expect(pickerChoices()).toEqual([]);
    expect(within(picker).getByRole("combobox", { name: "Search modules" }))
      .toBeVisible();
    expect(
      within(picker).getByRole("option", { name: "Create new module" }),
    ).toBeVisible();
  });

  it("[overhaul-174] shows no choices when the modules endpoint excludes archived hidden Modules", async () => {
    // listModules omits archived Modules by contract. Presentation rows can
    // still identify their hidden tabs, so the picker must join against [].
    listModules.mockResolvedValue([]);
    listPresentations.mockResolvedValue([
      presentation("module-a", true),
      presentation("module-b", true),
    ]);
    render(<PickerSurface />);

    const picker = await openPicker();

    expect(pickerChoices()).toEqual([]);
    expect(within(picker).getByRole("combobox", { name: "Search modules" }))
      .toBeVisible();
    expect(
      within(picker).getByRole("option", { name: "Create new module" }),
    ).toBeVisible();
  });

  it("[overhaul-175] focuses named picker controls and resets search after Escape", async () => {
    listModules.mockResolvedValue([module("module-b", "Bravo")]);
    listPresentations.mockResolvedValue([presentation("module-b", true)]);
    render(<PickerSurface />);

    const trigger = await screen.findByRole("button", {
      name: "Open module picker",
    });
    const picker = await openPicker();
    const search = within(picker).getByRole("combobox", {
      name: "Search modules",
    });

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-controls", picker.id);
    expect(search).toHaveFocus();
    expect(
      within(picker).getByRole("option", { name: "Create new module" }),
    ).toBeVisible();
    expect(
      within(picker).getByRole("option", {
        name: "Restore Bravo module tab",
      }),
    ).toBeVisible();

    fireEvent.change(search, { target: { value: "br" } });
    fireEvent.keyDown(search, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);
    const reopenedSearch = screen.getByRole("combobox", {
      name: "Search modules",
    });
    expect(reopenedSearch).toHaveValue("");
    expect(reopenedSearch).toHaveFocus();
  });

  it("[overhaul-176] arrows through filtered choices and enters creation", async () => {
    listModules.mockResolvedValue([
      module("module-a", "Alpha"),
      module("module-b", "Bravo"),
    ]);
    listPresentations.mockResolvedValue([
      presentation("module-a", true),
      presentation("module-b", true),
    ]);
    render(<PickerSurface />);

    const picker = await openPicker();
    const search = within(picker).getByRole("combobox", {
      name: "Search modules",
    });
    fireEvent.change(search, { target: { value: "br" } });

    const choicesList = within(picker).getByRole("listbox", {
      name: "Module choices",
    });
    const createChoice = within(choicesList).getByRole("option", {
      name: "Create new module",
    });
    const restoreChoice = within(choicesList).getByRole("option", {
      name: "Restore Bravo module tab",
    });
    expect(search).toHaveAttribute("aria-expanded", "true");
    expect(search).toHaveAttribute("aria-controls", choicesList.id);
    expect(search).not.toHaveAttribute("aria-owns");
    expect(search).toHaveAttribute("aria-activedescendant", createChoice.id);
    expect(createChoice).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search).toHaveAttribute("aria-activedescendant", restoreChoice.id);
    expect(createChoice).toHaveAttribute("aria-selected", "false");
    expect(restoreChoice).toHaveAttribute("aria-selected", "true");
    expect(search).toHaveFocus();

    fireEvent.keyDown(search, { key: "ArrowUp" });
    expect(search).toHaveAttribute("aria-activedescendant", createChoice.id);
    expect(createChoice).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(search, { key: "Enter" });

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    expect(useModalStore.getState().modalStack).toEqual([
      { type: "add-module" },
    ]);
    expect(await screen.findByPlaceholderText("Module name")).toBeVisible();
  });

  it("[overhaul-177] enters restoration from the active Module choice", async () => {
    let presentations = [presentation("module-b", true)];
    listModules.mockResolvedValue([module("module-b", "Bravo")]);
    listPresentations.mockImplementation(async () => presentations);
    updatePresentation.mockImplementation(async (moduleId, body) => {
      presentations = [presentation(moduleId, body.tab_hidden)];
      return presentations[0];
    });
    const selectModule = vi.fn(async (moduleId: string) => {
      useClientStore.setState({ selectedModuleId: moduleId });
    });
    useClientStore.setState({ selectModule });
    render(<PickerSurface />);

    const picker = await openPicker();
    const search = within(picker).getByRole("combobox", {
      name: "Search modules",
    });
    fireEvent.change(search, { target: { value: "br" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    await waitFor(() =>
      expect(updatePresentation).toHaveBeenCalledWith("module-b", {
        tab_hidden: false,
      }),
    );
    expect(selectModule).toHaveBeenCalledWith("module-b");
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Bravo" })).toHaveAttribute(
        "aria-selected",
        "true",
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open module picker" }),
    );
    expect(screen.getByRole("combobox", { name: "Search modules" }))
      .toHaveValue("");
  });

  it("[overhaul-178] closes the picker when focus moves to a Module tab", async () => {
    listModules.mockResolvedValue([
      module("module-a", "Alpha"),
      module("module-b", "Bravo"),
    ]);
    listPresentations.mockResolvedValue([
      presentation("module-b", true),
    ]);
    render(<PickerSurface />);

    const picker = await openPicker();
    const restoreChoice = within(picker).getByRole("option", {
      name: "Restore Bravo module tab",
    });
    const visibleTab = screen.getByRole("tab", { name: "Alpha" });

    restoreChoice.focus();
    fireEvent.blur(restoreChoice, { relatedTarget: visibleTab });
    visibleTab.focus();

    expect(screen.queryByRole("dialog", { name: "Module picker" })).toBeNull();
    expect(visibleTab).toHaveFocus();
  });
});
