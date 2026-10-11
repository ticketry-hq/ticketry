import { documentOperationName } from "../graphql-foundation/typedDocument";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import { projectOpenFixture } from "./projectOpenFixture";
import { workItem, type HttpFixture } from "./seam";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";

export function moduleManagerArchiveBoundary() {
  const boundary = storySprintModuleBoundary();
  boundary.http.workItems(boundary.modules.map((module) => workItem({ ...module, parent_id: null, issue_type: { id: "module", name: "Module", level: "module", color: "#7aa2f7", project: "project-1", sort_order: 0, start_state: null, workflow_revision: 1 } })));
  let refusal = false;
  const execute: HttpFixture["executeGraphQl"] = async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "ModuleManagerInspectionStories" || operation === "ModuleManagerInspectionWorktrees") {
      return { [operation.endsWith("Stories") ? "stories" : "worktrees"]: { __typename: operation.endsWith("Stories") ? "WorktrackerIssueConnection" : "WorktreeConnection", nodes: [], pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: 0 } } } as never;
    }
    if (operation === "ArchiveWorkTrackerWorkItem") {
      boundary.calls.push({ operation, variables });
      if (refusal) throw new Error("Server refused this archive");
      const { id } = variables as { id: string };
      const module = boundary.modules.find((row) => row.id === id)!;
      boundary.modules[boundary.modules.indexOf(module)] = { ...module, is_archived: true };
      boundary.http.revise(id, { is_archived: true });
      const descendants = id === "module-1" ? ["roadmap-24"] : id === "module-2" ? ["bugs-24", "bugs-25"] : ["release-25"];
      descendants.forEach((story) => boundary.http.revise(story, { is_archived: true }));
      const row = await boundary.http.executeGraphQl(WorkTrackerWorkItemDocument, { id });
      return { update_work_item: row.work_item.nodes[0] } as never;
    }
    if (operation === "ModuleManagerArchivedModules") {
      boundary.calls.push({ operation, variables });
      const nodes = projectOpenFixture({ id: "project-1", slug: "PROJECT", name: "Project", description: "" },
        boundary.modules.filter((row) => row.is_archived)).data.modules.nodes.map((row) => ({ ...row, state_revision: 2 }));
      return { modules: { __typename: "WorktrackerIssueConnection", nodes,
        pageInfo: { __typename: "PageInfo", hasNextPage: false }, paginationInfo: { __typename: "PaginationInfo", total: nodes.length } } } as never;
    }
    const result = await boundary.execute(document, variables) as any;
    if (operation === "WorkTrackerProjectOpen") {
      result.modules.nodes = result.modules.nodes.filter((row: any) => !row.is_archived);
      result.module_presentations.nodes = result.module_presentations.nodes.filter((row: any) =>
        !boundary.modules.find((module) => module.id === row.module_id)?.is_archived);
    }
    return result;
  };
  return { ...boundary, execute, refuse: (value: boolean) => { refusal = value; } };
}
