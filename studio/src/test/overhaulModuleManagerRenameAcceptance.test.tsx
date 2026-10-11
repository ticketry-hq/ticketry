import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { workItem } from "./seam";
import { projectOpenFixture } from "./projectOpenFixture";
import { useClientStore } from "../state/clientStore";
import { useStudioStore } from "../features/projects";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-644] keeps refused module renames editable, prevents duplicate submits and converges manager, picker and tabs after retry", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.http.workItems([workItem({ ...boundary.modules[1]!, parent_id: null,
    issue_type: { id: "module", name: "Module", level: "module", color: null, sort_order: 0 } })]);
  const writes: Array<{ id: string; name: string }> = [];
  let release!: () => void;
  const refusal = new Promise<void>((resolve) => { release = resolve; });
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) === "UpdateWorkTrackerWorkItemDetails") {
      writes.push(variables as { id: string; name: string });
      if (writes.length === 1) { await refusal; throw new Error("Module name refused by server"); }
      const module = boundary.modules.find((row) => row.id === (variables as { id: string }).id)!;
      module.name = (variables as { name: string }).name;
    }
    return boundary.execute(document, variables);
  } });
  const footer = await screen.findByRole("button", { name: "Open Module Manager" });
  footer.focus();
  fireEvent.click(footer);
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager).getByRole("button", { name: "Rename bugs" }));
  const editor = within(manager).getByRole("form", { name: "Rename bugs" });
  const name = within(editor).getByRole("textbox", { name: "Module name" });
  fireEvent.change(name, { target: { value: "Rejected bugs" } });
  expect(fireEvent.keyDown(name, { key: "Enter" })).toBe(true);
  fireEvent.submit(editor);
  fireEvent.submit(editor);
  await waitFor(() => expect(writes).toEqual([{ id: "module-2", name: "Rejected bugs" }]));
  expect(within(editor).getByRole("button", { name: "Save module name" })).toBeDisabled();
  await act(async () => { release(); await refusal; });
  expect(await within(editor).findByRole("alert")).toHaveTextContent("Module name refused by server");
  expect(name).toHaveValue("Rejected bugs");
  expect(name).toBeEnabled();
  fireEvent.change(name, { target: { value: "Bugs revised" } });
  fireEvent.submit(editor);
  expect(await within(manager).findByRole("button", { name: "Inspect Bugs revised" })).toBeVisible();
  expect(writes).toEqual([{ id: "module-2", name: "Rejected bugs" }, { id: "module-2", name: "Bugs revised" }]);
  expect(screen.queryByRole("tab", { name: "Bugs revised" })).toBeNull();
  fireEvent.click(within(manager).getByRole("button", { name: "Close Module Manager" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Open Module Manager" })).toHaveFocus());
  fireEvent.click(screen.getByRole("button", { name: "Open module picker" }));
  expect(await screen.findByRole("option", { name: "Restore Bugs revised module tab" })).toBeVisible();
  fireEvent.click(screen.getByRole("option", { name: "Restore Bugs revised module tab" }));
  expect(await screen.findByRole("tab", { name: "Bugs revised" })).toBeVisible();
});

it("[overhaul-646] shares explicit presentation controls in module details, preserves selection and keeps archived records inspection-only", async () => {
  const boundary = storySprintModuleBoundary();
  const archived = { ...boundary.modules[0]!, id: "archive-actions", name: "Retired module", is_archived: true };
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    if (documentOperationName(document) !== "ModuleManagerArchivedModules") return boundary.execute(document, variables);
    const nodes = projectOpenFixture({ id: "project-1", name: "Project", slug: "PROJECT", description: "" }, [archived]).data.modules.nodes;
    return { modules: { __typename: "WorktrackerIssueConnection", nodes: nodes.map((row) => ({ ...row, state_revision: 1 })),
      pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: 1 } } } as never;
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Restore bugs" })).toBeEnabled());
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect bugs" }));
  const detail = within(manager).getByRole("region", { name: "Module details: bugs" });
  expect(within(detail).getByRole("button", { name: "Rename bugs" })).toBeVisible();
  expect(within(detail).getByRole("button", { name: "Archive bugs" })).toBeVisible();
  expect(boundary.calls.filter(({ operation }) => /^(Update|Archive)/.test(operation))).toEqual([]);
  fireEvent.click(within(detail).getByRole("button", { name: "Restore bugs" }));
  expect(await screen.findByRole("tab", { name: "bugs" })).toHaveAttribute("aria-selected", "false");
  await waitFor(() => expect(within(detail).getByRole("button", { name: "Close bugs tab" })).toBeEnabled());
  fireEvent.click(within(detail).getByRole("button", { name: "Close bugs tab" }));
  await waitFor(() => expect(within(detail).getByRole("button", { name: "Restore bugs" })).toBeEnabled());
  expect(screen.queryByRole("tab", { name: "bugs" })).toBeNull();
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(screen.getByRole("button", { name: "Sprint: Sprint 24, Active", hidden: true })).toBeInTheDocument();
  expect(boundary.calls.filter(({ operation }) => operation === "UpdateWorkTrackerModulePresentation")).toEqual([
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-2", tabHidden: false } },
    { operation: "UpdateWorkTrackerModulePresentation", variables: { moduleId: "module-2", tabHidden: true } },
  ]);
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect 0.2.0" }));
  expect(within(within(manager).getByRole("region", { name: "Module details: 0.2.0" }))
    .getByText("Clears sprint filter to show all modules")).toBeVisible();
  fireEvent.change(within(manager).getByRole("searchbox", { name: "Search modules" }), { target: { value: "Retired" } });
  fireEvent.click(await within(manager).findByRole("button", { name: "Inspect Retired module" }));
  const archivedDetail = within(manager).getByRole("region", { name: "Module details: Retired module" });
  expect(within(archivedDetail).getByText("Archived · inspection only")).toBeVisible();
  for (const name of ["Open Retired module", "Restore Retired module", "Close Retired module tab", "Rename Retired module", "Archive Retired module"])
    expect(within(manager).queryByRole("button", { name })).toBeNull();
  expect(boundary.calls.some(({ operation }) => operation === "UpdateWorkTrackerWorkItemDetails")).toBe(false);
});

it("[overhaul-645] gives module name editing caret and Escape precedence over manager navigation and restores action focus without a write", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.mount({ shell: true, selectedTaskId: null });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager).getByRole("button", { name: "Rename Roadmap" }));
  const input = within(manager).getByRole("textbox", { name: "Module name" });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "Uncommitted draft" } });
  expect(fireEvent.keyDown(input, { key: "ArrowLeft" })).toBe(true);
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(manager).toBeVisible();
  expect(within(manager).queryByRole("textbox", { name: "Module name" })).toBeNull();
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Rename Roadmap" })).toHaveFocus());
  expect(boundary.calls.filter(({ operation }) => /^(Update|Archive)/.test(operation))).toEqual([]);
  fireEvent.click(within(manager).getByRole("button", { name: "Rename Roadmap" }));
  expect(within(manager).getByRole("textbox", { name: "Module name" })).toHaveValue("Roadmap");
  fireEvent.click(within(manager).getByRole("button", { name: "Cancel module rename" }));
  fireEvent.click(within(manager).getByRole("button", { name: "Inspect Roadmap" }));
  const detail = within(manager).getByRole("region", { name: "Module details: Roadmap" });
  fireEvent.click(within(detail).getByRole("button", { name: "Rename Roadmap" }));
  expect(within(manager).getAllByRole("textbox", { name: "Module name" })).toHaveLength(1);
  fireEvent.keyDown(within(detail).getByRole("textbox", { name: "Module name" }), { key: "Escape" });
  await waitFor(() => expect(within(detail).getByRole("button", { name: "Rename Roadmap" })).toHaveFocus());
  expect(manager).toBeVisible();
});

it("preserves a new module rename draft and focus when an earlier project visit completes its write", async () => {
  const boundary = storySprintModuleBoundary();
  boundary.http.workItems([workItem({ ...boundary.modules[1]!, parent_id: null,
    issue_type: { id: "module", name: "Module", level: "module", color: null, sort_order: 0 } })]);
  const otherProject = { id: "project-2", name: "Other project", slug: "OTHER", description: "" };
  let release!: () => void;
  const firstWrite = new Promise<void>((resolve) => { release = resolve; });
  let writes = 0;
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "WorkTrackerProjectOpen" && (variables as { projectId: string }).projectId === "project-2") {
      const data = projectOpenFixture(otherProject, []).data;
      return { ...data, provider_catalog: { ...data.provider_catalog, __typename: "WorktrackerProviderCatalog", codex_profiles: [] } } as never;
    }
    if (operation === "UpdateWorkTrackerWorkItemDetails") {
      writes += 1;
      if (writes === 1) await firstWrite;
      boundary.modules[1]!.name = (variables as { name: string }).name;
    }
    return boundary.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  let manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(within(manager).getByRole("button", { name: "Rename bugs" }));
  fireEvent.change(within(manager).getByRole("textbox", { name: "Module name" }), { target: { value: "Earlier visit name" } });
  fireEvent.submit(within(manager).getByRole("form", { name: "Rename bugs" }));
  await waitFor(() => expect(writes).toBe(1));
  await act(async () => { await useStudioStore.getState().selectProject("project-2"); });
  expect(within(screen.getByRole("region", { name: "Module Manager" })).getByText("Other project")).toBeVisible();
  await act(async () => { await useStudioStore.getState().selectProject("project-1"); });
  manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.click(await within(manager).findByRole("button", { name: "Rename bugs" }));
  const currentInput = within(manager).getByRole("textbox", { name: "Module name" });
  fireEvent.change(currentInput, { target: { value: "Current visit draft" } });
  await act(async () => { release(); await firstWrite; });
  expect(await within(manager).findByRole("button", { name: "Inspect Earlier visit name" })).toBeVisible();
  expect(currentInput).toHaveValue("Current visit draft");
  expect(currentInput).toHaveFocus();
  expect(currentInput).toBeEnabled();
  expect(within(manager).queryByText(/Module rename failed/)).toBeNull();
  fireEvent.submit(within(manager).getByRole("form", { name: "Rename bugs" }));
  expect(await within(manager).findByRole("button", { name: "Inspect Current visit draft" })).toBeVisible();
  expect(writes).toBe(2);
});
