import { fireEvent, screen, within } from "@testing-library/react";
import { DialogHost } from "../app/shell/DialogHost";
import { ModalHost } from "../app/modal/ModalHost";
import { WorkTrackerWorkItemDocument } from "../features/work-items";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { initializeStudioRuntime, studioRuntime, type StudioRuntime } from "../runtime";
import { projectOpenFixture } from "./projectOpenFixture";
import { workItem } from "./seam";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

type Options = { wrapExecute?: (execute: ReturnType<typeof storySprintModuleBoundary>["execute"]) => ReturnType<typeof storySprintModuleBoundary>["execute"]; failCreate?: boolean; failLink?: boolean; holdCreate?: boolean; holdLink?: boolean;
  trust?: StudioRuntime["prepareDirectoryTrust"]; pickFolder?: StudioRuntime["pickFolder"] };

/** The approved shell seam: generated GraphQL plus profile-local host/trust adapters. */
export function moduleManagerCreationBoundary(options: Options = {}) {
  const f = storySprintModuleBoundary();
  f.http.workItems([workItem({ id: "module-type-seed", parent_id: null, state: null,
    issue_type: { id: "module-type", name: "Module", level: "module", color: null, sort_order: 0 } })]);
  const writes: Array<{ operation: string; variables: unknown }> = [];
  let createPending = false;
  let linkPending = false;
  let releaseCreate!: () => void;
  let releaseLink!: () => void;
  const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
  const linkGate = new Promise<void>((resolve) => { releaseLink = resolve; });
  const execute: typeof f.execute = async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "CreateWorkTrackerWorkItem") {
      writes.push({ operation, variables });
      if (options.failCreate) { options.failCreate = false; throw new Error("Creation unavailable"); }
      createPending = true;
      if (options.holdCreate) await createGate;
      const { projectId, name } = variables as { projectId: string; name: string };
      const id = projectId === "project-1" ? "created-module" : "other-created-module";
      f.modules.push({ id, name, project_id: projectId, sequence_id: 4, key: "PROJECT-4",
        is_archived: false, issue_type: "module-type" });
      f.presentations.push({ module_id: id, rank: "00000003", tab_hidden: false });
      f.http.tree(id, { rootIds: [], children: {}, order: [] });
      f.http.workItems([workItem({ id, project_id: projectId, name, parent_id: null, state: null,
        issue_type: { id: "module-type", name: "Module", level: "module", color: null, sort_order: 0 } })]);
      const created = await f.http.executeGraphQl(WorkTrackerWorkItemDocument, { id });
      return { create_work_item: created.work_item.nodes[0] } as never;
    }
    if (operation === "SetModuleLink") {
      writes.push({ operation, variables });
      if (options.failLink) { options.failLink = false; throw new Error("Folder unavailable"); }
      linkPending = true;
      if (options.holdLink) await linkGate;
      return { set_module_link: { __typename: "ModuleLinks", id: "created-link",
        ...(variables as { moduleId: string; path: string }) } } as never;
    }
    if (operation === "WorkTrackerProjectOpen" && (variables as { projectId: string }).projectId === "project-2") {
      const base = await f.http.executeGraphQl(document, variables);
      const project = projectOpenFixture({ id: "project-2", name: "Other project", slug: "OTHER",
        description: "", manual_module_order: true }, f.modules.filter((module) => module.project_id === "project-2")).data;
      return { ...base, ...project } as never;
    }
    const data = await f.execute(document, variables);
    const payload = data as Record<string, unknown>;
    if (options.trust && payload.provider_catalog) {
      return { ...payload, provider_catalog: { ...(payload.provider_catalog as Record<string, unknown>),
        configurable_providers: [{ __typename: "WorktrackerProvider", id: "codex", slug: "codex",
          name: "Codex", activated: true, supports_unattended: true }] } } as never;
    }
    return data;
  };
  f.mount({ shell: true, selectedTaskId: null, children: <><ModalHost /><DialogHost /></>, graphQlExecute: options.wrapExecute?.(execute) ?? execute });
  if (options.trust || options.pickFolder) initializeStudioRuntime({ ...studioRuntime(),
    ...(options.trust ? { prepareDirectoryTrust: options.trust } : {}),
    ...(options.pickFolder ? { pickFolder: options.pickFolder,
      capabilities: { ...studioRuntime().capabilities, nativeFolderPicker: true } } : {}) });
  return { ...f, writes, releaseCreate, releaseLink,
    createPending: () => createPending, linkPending: () => linkPending };
}

export async function openModuleCreation() {
  await screen.findByRole("button", { name: "Sprint: Sprint 24, Active", hidden: true });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  const header = manager.querySelector("header")!;
  fireEvent.click(within(header).getByRole("button", { name: "New module" }));
  return manager;
}

export function fillModuleCreation(manager: HTMLElement, name = "Fresh module", folder = "/repos/new-module") {
  fireEvent.change(within(manager).getByRole("textbox", { name: "Module name" }), { target: { value: name } });
  fireEvent.change(within(manager).getByRole("textbox", { name: "Module folder" }), { target: { value: folder } });
}
