import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { moduleManagerCreationBoundary, openModuleCreation, fillModuleCreation } from "./moduleManagerCreationBoundary";
import { getStorySprintFilterIntent, setStorySprintFilterIntent } from "../features/work-items";
import { getModuleFolder } from "../features/module-links";
import { useClientStore } from "../state/clientStore";
import { useStudioStore } from "../features/projects";

const host = vi.hoisted(() => ({ invoke: vi.fn(), valid: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: host.invoke, isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
beforeEach(() => {
  host.valid = true;
  host.invoke.mockReset().mockImplementation(async (command: string) => command === "desktop_validate_module_folder"
    ? { valid: host.valid, reason: host.valid ? null : "module_folder_missing" } : null);
});

it("[overhaul-623] header and Open entry start the same inline edit and Escape cancels it before the manager", async () => {
  const f = storySprintModuleBoundary();
  f.mount({ shell: true, selectedTaskId: null });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager.querySelector("header")!).getByRole("button", { name: "New module" }));
  const name = within(manager).getByRole("textbox", { name: "Module name" });
  expect(name).toHaveFocus();
  fireEvent.change(name, { target: { value: "Keep my caret" } });
  expect(fireEvent.keyDown(name, { key: "ArrowLeft" })).toBe(true);
  fireEvent.keyDown(name, { key: "Escape" });
  expect(manager).toBeVisible();
  await waitFor(() => expect(within(manager.querySelector("header")!).getByRole("button", { name: "New module" })).toHaveFocus());
  expect(within(manager).queryByRole("textbox", { name: "Module name" })).toBeNull();
  const open = within(manager).getByRole("region", { name: "Open" });
  fireEvent.click(within(open).getByRole("button", { name: "New module" }));
  expect(within(open).getByRole("textbox", { name: "Module name" })).toHaveFocus();
  fireEvent.click(within(open).getByRole("button", { name: "Cancel" }));
  expect(within(manager).queryByRole("textbox", { name: "Module name" })).toBeNull();
  expect(f.calls.filter(({ operation }) => /^(Create|SetModuleLink)/.test(operation))).toEqual([]);
});

it("[overhaul-624] refuses an unusable folder before trust and lets trust Escape cancel without creating a module", async () => {
  const trust = vi.fn(async (_provider: string, directory: string) => ({ status: "approval_required" as const, directory, approval: "approval" }));
  const f = moduleManagerCreationBoundary({ trust });
  const manager = await openModuleCreation();
  fillModuleCreation(manager);
  host.valid = false;
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  expect(await within(manager).findByRole("alert")).toHaveTextContent("does not exist");
  expect(trust).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
  host.valid = true;
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  const dialog = await screen.findByRole("dialog", { name: "Trust module folder?" });
  expect(dialog).toHaveTextContent("Codex");
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Trust module folder?" })).toBeNull());
  expect(manager).toBeVisible();
  expect(within(manager).getByRole("textbox", { name: "Module name" })).toHaveValue("Fresh module");
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Create module" })).toBeEnabled());
  expect(f.writes).toEqual([]);
});

it("[overhaul-625] retries folder saving against one created identity and only then clears sprint intent and selects the appended module", async () => {
  const f = moduleManagerCreationBoundary({ failLink: true, holdLink: true });
  const manager = await openModuleCreation();
  fillModuleCreation(manager);
  const create = within(manager).getByRole("button", { name: "Create module" });
  fireEvent.click(create);
  fireEvent.click(create);
  expect(await within(within(manager).getByRole("form", { name: "Create module" })).findByRole("alert")).toHaveTextContent("Module created, but its folder could not be saved");
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "active" });
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(within(manager).getByRole("textbox", { name: "Module name" })).toBeDisabled();
  const openGroup = within(manager).getByRole("region", { name: "Open" });
  fireEvent.click(within(openGroup).getByRole("button", { name: /^Open .*modules$/ }));
  expect(within(manager).getByRole("textbox", { name: "Module name" })).toBeDisabled();
  fireEvent.click(within(manager).getByRole("button", { name: "Save folder" }));
  await waitFor(() => expect(f.linkPending()).toBe(true));
  expect(within(manager).getByRole("form", { name: "Create module" })).toHaveAttribute("aria-busy", "true");
  expect(within(manager).getByRole("button", { name: "Save folder" })).toBeDisabled();
  expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
  expect(f.writes.filter(({ operation }) => operation === "SetModuleLink").map(({ variables }) => variables)).toEqual([
    { moduleId: "created-module", path: "/repos/new-module" },
    { moduleId: "created-module", path: "/repos/new-module" },
  ]);
  await act(async () => { f.releaseLink(); });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "all" });
  expect(getModuleFolder("created-module")).toBe("/repos/new-module");
  expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
  const tabs = screen.getAllByRole("tab");
  expect(tabs.indexOf(screen.getByRole("tab", { name: "Fresh module" }))).toBeGreaterThan(tabs.indexOf(screen.getByRole("tab", { name: "0.2.0" })));
  await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  expect(screen.getByRole("button", { name: "Open Module Manager" })).toHaveTextContent("4");
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  expect(screen.getByRole("button", { name: "Inspect Fresh module" })).toBeVisible();
});

it("[overhaul-626] a refused create keeps the inline draft editable and retries only on explicit submission", async () => {
  const f = moduleManagerCreationBoundary({ failCreate: true });
  const manager = await openModuleCreation();
  fillModuleCreation(manager);
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  const form = within(manager).getByRole("form", { name: "Create module" });
  expect(await within(form).findByRole("alert")).toHaveTextContent("Failed to create module");
  expect(within(form).getByRole("textbox", { name: "Module name" })).toBeEnabled();
  expect(f.writes.filter(({ operation }) => operation === "SetModuleLink")).toHaveLength(0);
  expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
  fillModuleCreation(manager, "Recovered module");
  fireEvent.click(within(form).getByRole("button", { name: "Create module" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(screen.getByRole("tab", { name: "Recovered module" })).toHaveAttribute("aria-selected", "true");
  expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(2);
});

it("[overhaul-627] a create finishing after a project switch cannot save a link or select into the new project", async () => {
  const f = moduleManagerCreationBoundary({ holdCreate: true });
  const manager = await openModuleCreation();
  fillModuleCreation(manager);
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  await waitFor(() => expect(f.createPending()).toBe(true));
  await act(async () => { useStudioStore.setState({ selectedProjectId: "project-2" }); });
  await act(async () => { f.releaseCreate(); });
  await waitFor(() => expect(f.modules.some(({ id }) => id === "created-module")).toBe(true));
  expect(useClientStore.getState().selectedModuleId).not.toBe("created-module");
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "active" });
  expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  expect(f.writes.filter(({ operation }) => operation === "SetModuleLink")).toHaveLength(0);
});

it("[overhaul-628] cancellation during link saving cannot select or close a reopened manager", async () => {
  const f = moduleManagerCreationBoundary({ holdLink: true });
  const manager = await openModuleCreation();
  fillModuleCreation(manager);
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  await waitFor(() => expect(f.linkPending()).toBe(true));
  fireEvent.click(within(manager).getByRole("button", { name: "Cancel" }));
  fireEvent.click(within(manager).getByRole("button", { name: "Close Module Manager" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Module Manager" }));
  const reopened = screen.getByRole("region", { name: "Module Manager" });
  await act(async () => { f.releaseLink(); });
  expect(reopened).toBeVisible();
  expect(within(reopened).getByRole("searchbox", { name: "Search modules" })).toHaveFocus();
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "active" });
});

it("[overhaul-629] a changed sprint intent invalidates late create navigation and retains the same identity for folder retry", async () => {
  const f = moduleManagerCreationBoundary({ holdCreate: true });
  const manager = await openModuleCreation();
  fillModuleCreation(manager);
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  await waitFor(() => expect(f.createPending()).toBe(true));
  act(() => setStorySprintFilterIntent("project-1", { mode: "id", sprintId: "sprint-25" }));
  await act(async () => { f.releaseCreate(); });
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Save folder" })).toBeEnabled());
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "id", sprintId: "sprint-25" });
  expect(f.writes.filter(({ operation }) => operation === "SetModuleLink")).toHaveLength(0);
  fireEvent.click(within(manager).getByRole("button", { name: "Save folder" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
  expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
});

it("[overhaul-643] native folder-picker cancellation writes nothing and approved trust precedes inline model creation", async () => {
  const picker = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("/repos/picked");
  const trust = vi.fn(async (_provider: string, directory: string, approval: string | null) => {
    expect(host.invoke).toHaveBeenCalledWith("desktop_validate_module_folder", { path: "/repos/picked" });
    expect(f.writes).toEqual([]);
    return { status: approval ? "prepared" as const : "approval_required" as const,
      directory, approval: approval ? null : "codex-approval" };
  });
  const f = moduleManagerCreationBoundary({ pickFolder: picker, trust });
  const manager = await openModuleCreation();
  const name = within(manager).getByRole("textbox", { name: "Module name" });
  fireEvent.change(name, { target: { value: "Picked module" } });
  expect(name).toHaveAttribute("data-coach-anchor", "module-name");
  expect(manager.querySelector('[data-coach-anchor="module-folder"]')).not.toBeNull();
  fireEvent.click(within(manager).getByRole("button", { name: "Pick Folder" }));
  await waitFor(() => expect(picker).toHaveBeenCalledTimes(1));
  expect(within(manager).getByRole("textbox", { name: "Module folder" })).toHaveValue("");
  expect(within(manager).getByRole("button", { name: "Create module" })).toBeDisabled();
  expect(f.writes).toEqual([]);
  fireEvent.click(within(manager).getByRole("button", { name: "Pick Folder" }));
  await waitFor(() => expect(within(manager).getByRole("textbox", { name: "Module folder" })).toHaveValue("/repos/picked"));
  fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
  const dialog = await screen.findByRole("dialog", { name: "Trust module folder?" });
  expect(f.writes).toEqual([]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Trust folder" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
  expect(trust).toHaveBeenLastCalledWith("codex", "/repos/picked", "codex-approval");
  expect(screen.getByRole("tab", { name: "Picked module" })).toHaveAttribute("aria-selected", "true");
  expect(getModuleFolder("created-module")).toBe("/repos/picked");
});

for (const surface of ["plan", "changes"] as const) {
  it(`creation opened over ${surface} selects the new module workspace after successful folder setup`, async () => {
    const f = moduleManagerCreationBoundary();
    await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
    fireEvent.click(screen.getByTestId(`workspace-tab-${surface}`));
    await waitFor(() => expect(screen.getByTestId(`workspace-tab-${surface}`)).toHaveAttribute("aria-selected", "true"));
    const manager = await openModuleCreation();
    fillModuleCreation(manager);
    fireEvent.click(within(manager).getByRole("button", { name: "Create module" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Module Manager" })).toBeNull());
    expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId(`workspace-tab-${surface}`)).toHaveAttribute("aria-selected", "false");
  });
}
