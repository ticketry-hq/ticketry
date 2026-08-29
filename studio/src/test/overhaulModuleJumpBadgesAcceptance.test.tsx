import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const projectReads = vi.hoisted(() => ({ readProjectOpen: vi.fn() }));
const runtime = vi.hoisted(() => ({
  platform: "desktop" as "browser" | "desktop",
}));

vi.mock("../features/projects/queries/readTransport", async () => ({
  ...(await vi.importActual("../features/projects/queries/readTransport")),
  readProjectOpen: projectReads.readProjectOpen,
}));

vi.mock("../runtime", async () => ({
  ...(await vi.importActual("../runtime")),
  studioRuntime: () => runtime,
}));

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useModalStore } from "../app/modal/modalStore";
import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { useModuleJumpBadges } from "../features/module-tabs";
import { useStudioStore } from "../features/projects/store";
import { notifyNativeTerminalKeyboardEngaged } from "../runtime/nativeTerminalKeyboard";
import type { Module, Project } from "../shared/api/types";
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
const MODULES = Array.from({ length: 13 }, (_, index): Module => ({
  id: `module-${index + 1}`,
  name: `Module ${index + 1}`,
  project_id: PROJECT_ID,
  key: `PRJ-${index + 1}`,
  sequence_id: index + 1,
  is_archived: index === 3,
  issue_type: "module-type",
}));

function projectOpenResult() {
  const result = projectOpenFixture(
    { ...PROJECT, manual_module_order: true },
    MODULES,
  );
  const hidden = result.data.module_presentations.nodes.find(
    (presentation) => presentation.module_id === "module-2",
  );
  if (hidden) hidden.tab_hidden = true;
  return result;
}

function ModuleJumpSurface() {
  useGlobalKeymap();
  return <ModuleTabStrip />;
}

function ModuleJumpBadgeRenderProbe({ onRender }: { onRender: () => void }) {
  useModuleJumpBadges();
  onRender();
  return null;
}

describe("overhaul acceptance - module jump badges", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  beforeEach(async () => {
    await resetStudioApolloClient();
    runtime.platform = "desktop";
    projectReads.readProjectOpen.mockReset().mockImplementation(async () =>
      projectOpenResult()
    );
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useModalStore.setState({ modalStack: [] });
    useClientStore.setState({
      selectedModuleId: "module-1",
      selectModule: vi.fn(async (moduleId: string) => {
        useClientStore.setState({ selectedModuleId: moduleId });
      }),
    });
  });

  it("numbers only visible canonical tabs without changing tab width", async () => {
    render(<ModuleJumpSurface />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(11));

    const firstTab = screen.getByRole("tab", { name: "Module 1" });
    const firstTabClass = firstTab.className;
    fireEvent.keyDown(window, { key: "Meta", metaKey: true });

    const badges = screen.getAllByTestId("module-jump-badge");
    expect(badges.map((badge) => badge.textContent)).toEqual([
      "⌘1",
      "⌘2",
      "⌘3",
      "⌘4",
      "⌘5",
      "⌘6",
      "⌘7",
      "⌘8",
      "⌘9",
      "⌘0",
    ]);
    expect(firstTab.className).toBe(firstTabClass);
    expect(firstTab.parentElement).toHaveClass("shrink-0", "max-w-64");
    expect(badges[0]).toHaveClass("absolute", "pointer-events-none");
    expect(badges[0]).toHaveAttribute("aria-hidden", "true");
    expect(
      within(screen.getByRole("tab", { name: "Module 3" }))
        .getByTestId("module-jump-badge"),
    ).toHaveTextContent("⌘2");
    expect(
      within(screen.getByRole("tab", { name: "Module 13" }))
        .queryByTestId("module-jump-badge"),
    ).toBeNull();
    expect(screen.queryByRole("tab", { name: "Module 2" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Module 4" })).toBeNull();

    fireEvent.keyDown(window, { key: "2", code: "Digit2", metaKey: true });
    expect(useClientStore.getState().selectModule).toHaveBeenCalledWith(
      "module-3",
    );
  });

  it("clears stale modifier state at every keyboard ownership boundary", async () => {
    render(<ModuleJumpSurface />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(11));

    const reveal = () => {
      fireEvent.keyDown(window, { key: "Meta", metaKey: true });
      expect(screen.getAllByTestId("module-jump-badge")).toHaveLength(10);
    };
    const expectCleared = () =>
      expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);

    reveal();
    fireEvent.blur(window);
    expectCleared();

    reveal();
    fireEvent(document, new Event("visibilitychange"));
    expectCleared();

    reveal();
    act(() => useModalStore.getState().openSettings());
    expectCleared();
    act(() => useModalStore.getState().popModal());
    expectCleared();

    reveal();
    act(() => notifyNativeTerminalKeyboardEngaged());
    expectCleared();

    reveal();
    fireEvent.pointerDown(document);
    expectCleared();

    reveal();
    fireEvent.keyDown(window, { key: "Shift", metaKey: true, shiftKey: true });
    expectCleared();
    fireEvent.keyUp(window, { key: "Shift", metaKey: true });
    expect(screen.getAllByTestId("module-jump-badge")).toHaveLength(10);
    fireEvent.keyUp(window, { key: "Meta" });
    expectCleared();
  });

  it("ignores key events that do not change modifier state", () => {
    const onRender = vi.fn();
    render(<ModuleJumpBadgeRenderProbe onRender={onRender} />);

    onRender.mockClear();
    for (const key of ["a", "b", "c", "d"]) {
      fireEvent.keyDown(window, { key });
      fireEvent.keyUp(window, { key });
    }

    expect(onRender).not.toHaveBeenCalled();
  });
});
