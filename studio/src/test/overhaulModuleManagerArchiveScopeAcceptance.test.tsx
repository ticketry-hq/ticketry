import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { useStudioStore } from "../features/projects";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { projectOpenFixture } from "./projectOpenFixture";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

it("[overhaul-614] discards a late archive read across project visits before normalization or inspection", async () => {
  const boundary = storySprintModuleBoundary();
  let releaseFirst: () => void = () => {};
  let releaseCurrent: () => void = () => {};
  const firstRead = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const currentRead = new Promise<void>((resolve) => { releaseCurrent = resolve; });
  const reads: string[] = [];
  const otherProject = { id: "project-2", name: "Other project", slug: "OTHER", description: "" };
  boundary.mount({ shell: true, selectedTaskId: null, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    const input = variables as { projectId: string };
    if (operation === "WorkTrackerProjectOpen" && input.projectId === "project-2") {
      const data = projectOpenFixture(otherProject, []).data;
      return { ...data, provider_catalog: { ...data.provider_catalog, __typename: "WorktrackerProviderCatalog", codex_profiles: [] } } as never;
    }
    if (operation !== "ModuleManagerArchivedModules") return boundary.execute(document, variables);
    reads.push(input.projectId);
    const visit = reads.filter((projectId) => projectId === "project-1").length;
    if (input.projectId === "project-1") await (visit === 1 ? firstRead : currentRead);
    const archived = input.projectId === "project-1" ? [{ ...boundary.modules[0]!, id: "archive-1",
      name: visit === 1 ? "Retired obsolete name" : "Retired current name", sequence_id: 20,
      key: "PROJECT-20", is_archived: true }] : [];
    const nodes = projectOpenFixture(input.projectId === "project-1"
      ? { id: "project-1", name: "Project", slug: "PROJECT", description: "" } : otherProject,
    archived).data.modules.nodes;
    return { modules: { __typename: "WorktrackerIssueConnection", nodes: nodes.map((row) => ({ ...row, state_revision: 1 })),
      pageInfo: { __typename: "PageInfo", hasNextPage: false },
      paginationInfo: { __typename: "PaginationInfo", total: nodes.length } } } as never;
  } });
  fireEvent.click(await screen.findByRole("button", { name: "Open Module Manager" }));
  await waitFor(() => expect(reads).toEqual(["project-1"]));
  await act(async () => { await useStudioStore.getState().selectProject("project-2"); });
  await waitFor(() => expect(reads).toEqual(["project-1", "project-2"]));
  expect(within(screen.getByRole("region", { name: "Module Manager" })).getByText("Other project")).toBeVisible();
  await act(async () => { releaseFirst(); await firstRead; });
  expect(screen.queryByRole("button", { name: "Inspect Retired obsolete name" })).toBeNull();

  await act(async () => { await useStudioStore.getState().selectProject("project-1"); });
  await waitFor(() => expect(reads).toEqual(["project-1", "project-2", "project-1"]));
  const manager = screen.getByRole("region", { name: "Module Manager" });
  fireEvent.change(within(manager).getByRole("searchbox", { name: "Search modules" }), { target: { value: "Retired" } });
  expect(within(manager).queryByRole("button", { name: "Inspect Retired obsolete name" })).toBeNull();
  expect(within(manager).queryByRole("button", { name: "Inspect Retired current name" })).toBeNull();
  await act(async () => { releaseCurrent(); await currentRead; });
  expect(await within(manager).findByRole("button", { name: "Inspect Retired current name" })).toBeVisible();
  expect(within(manager).queryByRole("button", { name: "Inspect Retired obsolete name" })).toBeNull();
  expect(screen.queryByRole("tab", { name: /Retired/ })).toBeNull();
});
