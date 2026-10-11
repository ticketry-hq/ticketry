import { act, fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useStudioStore } from "../features/projects";
import { getStorySprintFilterIntent } from "../features/work-items";
import { useClientStore } from "../state/clientStore";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { projectOpenFixture } from "./projectOpenFixture";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { seedModuleLinks } from "../features/module-links";
import type { Module } from "../shared/api/types";

it("[overhaul-521] authoritative no-active lookup uses All while project visits retain independent sprint intent", async () => {
  const f = storySprintModuleBoundary();
  f.http.storySprints([
    { id: "sprint-24", projectId: "project-1", name: "Sprint 24", status: "planned" },
    { id: "other-active", projectId: "project-2", name: "Other active", status: "active" },
  ]);
  const otherModule: Module = { id: "other-module", project_id: "project-2", name: "Other module",
    key: "OTHER-1", sequence_id: 1, is_archived: false, issue_type: "module" };
  const otherProject = projectOpenFixture({ id: "project-2", name: "Other project", slug: "OTHER",
    description: "", manual_module_order: true }, [otherModule]).data;
  f.mount({ graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    const input = variables as { projectId?: string; moduleId?: string };
    if (input.projectId === "project-2") {
      if (operation === "WorkTrackerProjectOpen") return otherProject as never;
      if (operation === "ProjectStorySprintModules") return { modules: { ...otherProject.modules,
        pageInfo: { __typename: "PageInfo", hasNextPage: false },
        paginationInfo: { __typename: "PaginationInfo", total: 1 } } } as never;
    }
    if (operation === "WorkTrackerModuleOpen" && input.moduleId === otherModule.id) return {
      module: otherProject.modules, work_items: { __typename: "WorktrackerIssueConnection", nodes: [] },
    } as never;
    return f.execute(document, variables);
  } });
  seedModuleLinks([...f.modules, otherModule].map((module) => ({ id: `link-${module.id}`,
    moduleId: module.id, path: `/repos/${module.id}` })));
  await screen.findByRole("button", { name: "Sprint: All sprints" });
  expect(await screen.findByRole("treeitem", { name: /Roadmap current story/ })).toBeVisible();
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "active" });
  fireEvent.click(screen.getByRole("button", { name: "Sprint: All sprints" }));
  fireEvent.click(screen.getByRole("option", { name: /No sprint/ }));
  await screen.findByText("No modules have stories in this sprint.");
  expect(useClientStore.getState().selectedModuleId).toBeNull();

  await act(async () => { await useStudioStore.getState().selectProject("project-2"); });
  await screen.findByRole("button", { name: "Sprint: Other active, Active" });
  expect(getStorySprintFilterIntent("project-2")).toEqual({ mode: "active" });
  expect(screen.queryByRole("treeitem", { name: /Roadmap current story/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sprint: Other active, Active" }));
  fireEvent.click(screen.getByRole("option", { name: /All sprints/ }));
  await screen.findByRole("button", { name: "Sprint: All sprints" });

  await act(async () => { await useStudioStore.getState().selectProject("project-1"); });
  await screen.findByRole("button", { name: "Sprint: No sprint" });
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "none" });
  expect(getStorySprintFilterIntent("project-2")).toEqual({ mode: "all" });
  await act(async () => { await useStudioStore.getState().selectProject("project-2"); });
  await screen.findByRole("button", { name: "Sprint: All sprints" });
  expect(getStorySprintFilterIntent("project-1")).toEqual({ mode: "none" });
});
