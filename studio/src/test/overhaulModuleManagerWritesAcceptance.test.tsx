import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { useStudioStore } from "../features/projects";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { projectOpenFixture } from "./projectOpenFixture";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-619] rolls back a failed presentation write, retries explicitly and ignores late completion after a project switch", async () => {
  const boundary = storySprintModuleBoundary();
  const writes: Array<{ moduleId: string; tabHidden: boolean }> = [];
  let releaseFailure: () => void = () => {};
  let releaseLate: () => void = () => {};
  const failure = new Promise<void>((resolve) => { releaseFailure = resolve; });
  const late = new Promise<void>((resolve) => { releaseLate = resolve; });
  let blockLate = false;
  const otherProject = { id: "project-2", name: "Other project", slug: "OTHER", description: "" };
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "ModuleManagerArchivedModules") return { modules: {
      __typename: "WorktrackerIssueConnection", nodes: [], pageInfo: { __typename: "PageInfo", hasNextPage: false },
      paginationInfo: { __typename: "PaginationInfo", total: 0 },
    } } as never;
    if (operation === "WorkTrackerProjectOpen" && (variables as { projectId: string }).projectId === "project-2") {
      const data = projectOpenFixture(otherProject, []).data;
      return { ...data, provider_catalog: { ...data.provider_catalog, __typename: "WorktrackerProviderCatalog", codex_profiles: [] } } as never;
    }
    if (operation === "UpdateWorkTrackerModulePresentation") {
      writes.push(variables as { moduleId: string; tabHidden: boolean });
      if (writes.length === 1) { await failure; throw new Error("Presentation offline"); }
      if (blockLate) await late;
    }
    return boundary.execute(document, variables);
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  const closeTab = await within(manager).findByRole("button", { name: "Close Roadmap tab" });
  await waitFor(() => expect(closeTab).toBeEnabled());
  fireEvent.click(closeTab);
  await waitFor(() => expect(writes).toEqual([{ moduleId: "module-1", tabHidden: true }]));
  expect(screen.queryByRole("tab", { name: "Roadmap" })).toBeNull();
  expect(within(manager).getByRole("button", { name: "Restore Roadmap" })).toBeDisabled();
  await act(async () => { releaseFailure(); await failure; });
  expect(await within(manager).findByText(/Module action could not be completed/)).toBeVisible();
  expect(screen.getByRole("tab", { name: "Roadmap" })).toBeVisible();
  fireEvent.click(within(manager).getByRole("button", { name: "Close Roadmap tab" }));
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Restore Roadmap" })).toBeEnabled());
  expect(screen.queryByRole("tab", { name: "Roadmap" })).toBeNull();
  fireEvent.click(within(manager).getByRole("button", { name: "Restore Roadmap" }));
  await waitFor(() => expect(within(manager).getByRole("button", { name: "Close Roadmap tab" })).toBeEnabled());
  expect(screen.getByRole("tab", { name: "Roadmap" })).toHaveAttribute("aria-selected", "false");
  expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  expect(writes).toEqual([
    { moduleId: "module-1", tabHidden: true }, { moduleId: "module-1", tabHidden: true },
    { moduleId: "module-1", tabHidden: false },
  ]);

  blockLate = true;
  fireEvent.click(within(manager).getByRole("button", { name: "Close Roadmap tab" }));
  await waitFor(() => expect(writes).toHaveLength(4));
  await act(async () => { await useStudioStore.getState().selectProject("project-2"); });
  await waitFor(() => expect(within(screen.getByRole("region", { name: "Module Manager" })).getByText("Other project")).toBeVisible());
  await act(async () => { releaseLate(); await late; });
  expect(screen.getByRole("region", { name: "Module Manager" })).toBeVisible();
  expect(within(screen.getByRole("region", { name: "Module Manager" })).getByText("Other project")).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Roadmap" })).toBeNull();
  expect(within(screen.getByRole("region", { name: "Module Manager" })).queryByRole("button", { name: "Inspect Roadmap" })).toBeNull();
  expect(boundary.calls.some(({ operation }) => operation === "UpdateWorkTrackerIssue")).toBe(false);
});
