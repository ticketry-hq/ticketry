import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { ModalHost } from "../app/modal";
import { useModalStore } from "../app/modal/modalStore";
import { getStorySprintFilterIntent, WorkTrackerWorkItemDocument } from "../features/work-items";
import { getModuleFolder } from "../features/module-links";
import { useClientStore } from "../state/clientStore";
import { useStudioStore } from "../features/projects";
import { projectOpenFixture } from "./projectOpenFixture";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { workItem } from "./seam";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

function moduleCreationBoundary({ failFolderOnce = false, holdCreate = false }: { failFolderOnce?: boolean; holdCreate?: boolean } = {}) {
  const f = storySprintModuleBoundary();
  f.http.workItems([workItem({ id: "module-type-seed", parent_id: null, state: null, issue_type: { id: "module-type", name: "Module", level: "module", color: null, sort_order: 0 } })]);
  let folderPending = false;
  let createPending = false;
  let releaseCreate!: () => void;
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  let releaseFolder!: () => void;
  const folderGate = new Promise<void>((resolve) => { releaseFolder = resolve; });
  const writes: Array<{ operation: string; variables: unknown }> = [];
  const execute: typeof f.execute = async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "CreateWorkTrackerWorkItem") {
      writes.push({ operation, variables });
      const projectId = (variables as { projectId: string }).projectId;
      const id = projectId === "project-1" ? "created-module" : "created-module-b";
      if (holdCreate && projectId === "project-1") { createPending = true; await createGate; }
      f.modules.push({ id, name: "Fresh module", project_id: projectId, sequence_id: 4, key: "PROJECT-4", is_archived: false, issue_type: "module-type" });
      f.presentations.push({ module_id: id, rank: "00000003", tab_hidden: false });
      f.http.tree(id, { rootIds: [], children: {}, order: [] });
      f.http.workItems([workItem({ id, project_id: projectId, name: "Fresh module", parent_id: null, state: null,
        issue_type: { id: "module-type", name: "Module", level: "module", color: null, sort_order: 0 } })]);
      const created = await f.http.executeGraphQl(WorkTrackerWorkItemDocument, { id });
      return { create_work_item: created.work_item.nodes[0] } as never;
    }
    if (operation === "SetModuleLink") {
      writes.push({ operation, variables });
      if (failFolderOnce) { failFolderOnce = false; throw new Error("Folder unavailable"); }
      folderPending = true; await folderGate;
      return { set_module_link: { __typename: "ModuleLinks", id: "created-link", ...(variables as { moduleId: string; path: string }) } } as never;
    }
    if (operation === "WorkTrackerProjectOpen" && (variables as { projectId: string }).projectId === "project-2") {
      const project = projectOpenFixture({ id: "project-2", name: "Other project", slug: "OTHER", description: "", manual_module_order: true }, f.modules.filter((module) => module.project_id === "project-2")).data;
      const catalog = await f.http.executeGraphQl(document, variables) as unknown as { issue_types: unknown };
      return { ...project, issue_types: catalog.issue_types } as never;
    }
    return f.execute(document, variables);
  };
  f.mount({ children: <ModalHost />, graphQlExecute: execute });
  return { ...f, writes, releaseFolder, releaseCreate, folderPending: () => folderPending, createPending: () => createPending };
}

async function startCreation() {
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active" });
  act(() => { useModalStore.getState().pushModal({ type: "add-module" }); });
  fireEvent.change(await screen.findByRole("textbox", { name: "Module name" }), { target: { value: "Fresh module" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Module folder" }), { target: { value: "/repos/new-module" } });
  fireEvent.click(screen.getByRole("button", { name: "Create module" }));
}

it("[overhaul-514] broadens to All only after canonical module creation and folder setup before selecting the new module", async () => {
  const f = moduleCreationBoundary(); await startCreation();
  await waitFor(() => expect(f.folderPending()).toBe(true));
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "active" });
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(f.writes[0]).toEqual({ operation: "CreateWorkTrackerWorkItem", variables: {
    projectId: "project-1", name: "Fresh module", issueTypeId: "module-type", parentId: null,
  } });
  await act(async () => { f.releaseFolder(); });
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("created-module"));
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "all" });
  expect(getModuleFolder("created-module")).toBe("/repos/new-module");
  expect(screen.getByRole("tab", { name: "Fresh module" })).toHaveAttribute("aria-selected", "true");
  expect(useModalStore.getState().modalStack).toHaveLength(0);
});

it("[overhaul-515] cancellation during folder saving preserves sprint intent and prevents late module selection", async () => {
  const f = moduleCreationBoundary(); await startCreation();
  await waitFor(() => expect(f.folderPending()).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(useModalStore.getState().modalStack).toHaveLength(0));
  await act(async () => { f.releaseFolder(); });
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "active" });
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  expect(screen.queryByRole("tab", { name: "Fresh module" })).not.toBeInTheDocument();
});

it("[overhaul-516] folder failure preserves filter intent and retries the canonical module without creating a duplicate", async () => {
  const f = moduleCreationBoundary({ failFolderOnce: true }); await startCreation();
  expect(await screen.findByRole("alert")).toHaveTextContent("Module created, but its folder could not be saved.");
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "active" });
  expect(useClientStore.getState().selectedModuleId).toBe("module-1");
  fireEvent.click(screen.getByRole("button", { name: "Save folder" }));
  await waitFor(() => expect(f.folderPending()).toBe(true));
  await act(async () => { f.releaseFolder(); });
  await waitFor(() => expect(useClientStore.getState().selectedModuleId).toBe("created-module"));
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "all" });
  expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(1);
});

it("[overhaul-519] a late canonical creation cannot reuse the old project's module id when submitting in the new project", async () => {
  const f = moduleCreationBoundary({ holdCreate: true }); await startCreation();
  await waitFor(() => expect(f.createPending()).toBe(true));
  await act(async () => { useStudioStore.setState({ selectedProjectId: "project-2" }); });
  await act(async () => { f.releaseCreate(); });
  await waitFor(() => expect(screen.getByRole("button", { name: "Create module" })).toBeEnabled());
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "active" });
  expect(f.writes.filter(({ operation }) => operation === "SetModuleLink")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Create module" }));
  await waitFor(() => expect(f.folderPending()).toBe(true));
  expect(f.writes.filter(({ operation }) => operation === "CreateWorkTrackerWorkItem")).toHaveLength(2);
  expect(f.writes.find(({ operation }) => operation === "SetModuleLink")?.variables).toEqual({ moduleId: "created-module-b", path: "/repos/new-module" });
  await act(async () => { f.releaseFolder(); });
  expect(useClientStore.getState().selectedModuleId).not.toBe("created-module");
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "active" });
});
