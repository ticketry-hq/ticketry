import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  listModulePresentations: vi.fn(),
  listModules: vi.fn(),
  reorderModulePresentation: vi.fn(),
  updateModulePresentation: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ platform: "desktop" as "browser" | "desktop" }));

vi.mock("../shared/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/api/client")>()),
  ...api,
}));
vi.mock("../runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../runtime")>()),
  studioRuntime: () => runtime,
}));

import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import { useModalStore } from "../app/modal/modalStore";
import { ModuleTabStrip } from "../app/shell/ticket-workspace/ModuleTabStrip";
import { useModuleJumpBadges } from "../features/module-tabs";
import { useStudioStore } from "../features/projects/store";
import { notifyNativeTerminalKeyboardEngaged } from "../runtime/nativeTerminalKeyboard";
import { queryClient } from "../shared/query/queryClient";
import type { Module, ModulePresentation } from "../shared/api/types";
import { useClientStore } from "../state/clientStore";
import { dragTab } from "./moduleDragGestures";

const PROJECT_ID = "project-1";
const MODULES = Array.from({ length: 11 }, (_, index) => ({
  id: `module-${index + 1}`,
  name: `Module ${index + 1}`,
  project_id: PROJECT_ID,
  key: `PRJ-${index + 1}`,
  sequence_id: index + 1,
  is_archived: false,
  issue_type: "module",
})) as unknown as Module[];

function presentation(
  moduleId: string,
  tabHidden: boolean,
): ModulePresentation {
  return { module_id: moduleId, rank: "middle", tab_hidden: tabHidden };
}

function ModuleJumpSurface() {
  useGlobalKeymap();
  return (
    <QueryClientProvider client={queryClient}>
      <ModuleTabStrip />
    </QueryClientProvider>
  );
}

function ModuleJumpBadgeRenderProbe({
  enabled,
  onRender,
}: {
  enabled: boolean;
  onRender: () => void;
}) {
  useModuleJumpBadges(enabled);
  onRender();
  return null;
}

describe("overhaul acceptance - module jump badges", () => {
  beforeEach(() => {
    let modules = MODULES;
    let presentations: ModulePresentation[] = [];

    runtime.platform = "desktop";
    queryClient.clear();
    api.listModules.mockReset().mockImplementation(async () => modules);
    api.listModulePresentations
      .mockReset()
      .mockImplementation(async () => presentations);
    api.updateModulePresentation
      .mockReset()
      .mockImplementation(
        async (moduleId: string, body: { tab_hidden: boolean }) => {
          const updated = presentation(moduleId, body.tab_hidden);
          presentations = [
            ...presentations.filter((item) => item.module_id !== moduleId),
            updated,
          ];
          return updated;
        },
      );
    api.reorderModulePresentation
      .mockReset()
      .mockImplementation(async (moduleId: string) => {
        modules = [MODULES[10], ...MODULES.slice(0, 10)];
        return presentation(moduleId, false);
      });
    useStudioStore.setState({ selectedProjectId: PROJECT_ID, error: null });
    useModalStore.setState({ modalStack: [] });
    useClientStore.setState({
      modalStack: [],
      selectedModuleId: MODULES[0].id,
      selectModule: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("[overhaul-164] reveals truthful module jump badges only while the effective modifier is held", async () => {
    const view = render(<ModuleJumpSurface />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(11));

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });

    const badges = screen.getAllByTestId("module-jump-badge");
    expect(badges).toHaveLength(10);
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
    expect(
      within(screen.getByRole("tab", { name: "Module 11" })).queryByTestId(
        "module-jump-badge",
      ),
    ).not.toBeInTheDocument();
    expect(badges[0]).toHaveAttribute("aria-hidden", "true");
    expect(badges[0]).not.toHaveAttribute("tabindex");
    expect(badges[0]).toHaveClass(
      "pointer-events-none",
      "absolute",
      "right-1",
    );
    expect(screen.getByRole("tab", { name: "Module 1" })).toHaveClass(
      "relative",
      "pr-7",
    );
    expect(screen.getByRole("button", { name: "Hide Module 1 tab" })).toBeVisible();

    fireEvent.keyDown(window, { key: "2", metaKey: true });
    expect(useClientStore.getState().selectModule).toHaveBeenCalledWith("module-2");
    expect(screen.getAllByTestId("module-jump-badge")).toHaveLength(10);

    for (const modifier of [
      { key: "Shift", shiftKey: true },
      { key: "Control", ctrlKey: true },
      { key: "Alt", altKey: true },
    ]) {
      fireEvent.keyDown(window, { ...modifier, metaKey: true });
      expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);
      fireEvent.keyUp(window, { key: modifier.key, metaKey: true });
      expect(screen.getAllByTestId("module-jump-badge")).toHaveLength(10);
    }

    act(() => useModalStore.getState().openSettings());
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);
    fireEvent.keyUp(window, { key: "Meta" });
    act(() => useModalStore.getState().popModal());
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    act(() => useClientStore.setState({ modalStack: [{ type: "settings" }] }));
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);
    fireEvent.keyUp(window, { key: "Meta" });
    act(() => useClientStore.setState({ modalStack: [] }));
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Hide Module 1 tab" }));
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(10));
    dragTab("module-11", "module-2", "near");
    await waitFor(() =>
      expect(api.reorderModulePresentation).toHaveBeenCalledWith("module-11", {
        before_id: "module-1",
        after_id: "module-2",
        initial_order_ids: MODULES.map((module) => module.id),
      }),
    );

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    expect(
      within(screen.getByRole("tab", { name: "Module 11" })).getByTestId(
        "module-jump-badge",
      ),
    ).toHaveTextContent("⌘1");
    expect(
      within(screen.getByRole("tab", { name: "Module 2" })).getByTestId(
        "module-jump-badge",
      ),
    ).toHaveTextContent("⌘2");
    expect(
      within(screen.getByRole("tab", { name: "Module 10" })).getByTestId(
        "module-jump-badge",
      ),
    ).toHaveTextContent("⌘0");
    fireEvent.keyUp(window, { key: "Meta" });
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    fireEvent.blur(window);
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    act(() => notifyNativeTerminalKeyboardEngaged());
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    fireEvent.pointerDown(document);
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);

    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);

    view.unmount();
    runtime.platform = "browser";
    render(<ModuleJumpSurface />);
    await waitFor(() => expect(screen.getAllByRole("tab")).toHaveLength(10));
    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    expect(screen.queryAllByTestId("module-jump-badge")).toHaveLength(0);
  });

  it("[overhaul-167] does not re-render the module tab strip for unchanged modifier state", async () => {
    const onRender = vi.fn();
    const view = render(
      <ModuleJumpBadgeRenderProbe enabled onRender={onRender} />,
    );

    onRender.mockClear();
    for (const key of ["a", "b", "c", "d", "e"]) {
      fireEvent.keyDown(window, { key });
      fireEvent.keyUp(window, { key });
    }
    expect(onRender).not.toHaveBeenCalled();

    view.rerender(
      <ModuleJumpBadgeRenderProbe enabled={false} onRender={onRender} />,
    );
    onRender.mockClear();
    fireEvent.keyDown(window, { key: "Meta", metaKey: true });
    fireEvent.keyUp(window, { key: "Meta" });
    expect(onRender).not.toHaveBeenCalled();
  });
});
