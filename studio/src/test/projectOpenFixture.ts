import type { IssueType, Module, Project, State, WorkItem } from "../shared/api/types";
import type { ProjectOpenResult } from "../features/projects/queries/readTransport";
import { WorkTrackerModuleOpenDocument } from "../features/work-items/generated/workItems.documents";
import { studioApolloClient } from "../shared/apollo/client";

export function projectOpenFixture(
  project: Project & { readonly manual_module_order?: boolean },
  modules: Module[],
): ProjectOpenResult {
  const { manual_module_order: manualModuleOrder = false, ...graphqlProject } = project;
  const projectRow = {
    __typename: "WorktrackerProject",
    ...graphqlProject,
    created_at: "2026-01-01T00:00:00Z",
  };
  return {
    project: graphqlProject,
    modules,
    data: {
      project: { __typename: "WorktrackerProjectConnection", nodes: [projectRow] },
      modules: {
        __typename: "WorktrackerIssueConnection",
        nodes: modules.map((module, index) => ({
          __typename: "WorktrackerIssue",
          id: module.id,
          name: module.name,
          project_id: module.project_id,
          sequence_id: module.sequence_id,
          is_archived: module.is_archived,
          issue_type: module.issue_type,
          rank: String(index),
          project: {
            __typename: "WorktrackerProject",
            id: project.id,
            slug: project.slug,
          },
        })),
      },
      module_presentations: {
        __typename: "WorktrackerModulepresentationConnection",
        nodes: manualModuleOrder ? modules.map((module, index) => ({
          __typename: "WorktrackerModulepresentation",
          module_id: module.id,
          rank: String(index).padStart(8, "0"),
          tab_hidden: false,
          module: {
            __typename: "WorktrackerIssue",
            id: module.id,
            project_id: project.id,
          },
        })) : [],
      },
      states: { __typename: "WorktrackerStateConnection", nodes: [] },
      issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
      provider_catalog: {
        __typename: "ProviderCatalog",
        configurable_providers: [],
        providers: [],
        agent_models: [],
        reasoning_levels: [],
        global_default: null,
      },
    } as unknown as ProjectOpenResult["data"],
  };
}

type FixtureWorkItem = WorkItem & { __state?: State; __issueType?: IssueType };

export function seedModuleOpenFixture(moduleId: string, items: FixtureWorkItem[]): void {
  studioApolloClient().writeQuery({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId },
    data: {
      module: { __typename: "WorktrackerIssueConnection", nodes: [] },
      work_items: {
        __typename: "WorktrackerIssueConnection",
        nodes: items.map((item) => ({
          __typename: "WorktrackerIssue",
          id: item.id,
          name: item.name,
          project_id: item.project_id,
          sequence_id: item.sequence_id,
          state_id: item.state,
          description: item.description,
          workspace_tab_order: [],
          parent_id: item.parent_id,
          module_id: moduleId,
          is_archived: item.is_archived,
          created_at: item.created_at,
          updated_at: item.updated_at,
          rank: item.rank,
          issue_type_id: item.issue_type,
          project: {
            __typename: "WorktrackerProject",
            id: item.project_id,
            slug: item.key.split("-")[0] ?? "PROJECT",
          },
          state_record: item.state ? {
            __typename: "WorktrackerState",
            id: item.state,
            name: item.__state?.name ?? item.state,
            group: item.__state?.group ?? "backlog",
            color: item.__state?.color ?? "",
            sort_order: item.__state?.sort_order ?? 0,
            is_protected: item.__state?.is_protected ?? false,
          } : null,
          issue_type_record: {
            __typename: "WorktrackerIssuetype",
            id: item.issue_type,
            name: item.__issueType?.name ?? item.issue_type,
            level: item.__issueType?.level ?? "task",
            color: item.__issueType?.color ?? "",
            sort_order: item.__issueType?.sort_order ?? 0,
          },
          children: {
            __typename: "WorktrackerIssueConnection",
            nodes: items.filter((child) => child.parent_id === item.id).map((child) => ({
              __typename: "WorktrackerIssue",
              id: child.id,
              is_archived: child.is_archived,
            })),
          },
          blocked_by_edges: {
            __typename: "WorktrackerIssueBlockedByConnection",
            nodes: item.blocked_by_ids.map((id) => ({
              __typename: "WorktrackerIssueBlockedByEdge",
              to_issue_id: id,
            })),
          },
          blocks_edges: {
            __typename: "WorktrackerIssueBlockedByConnection",
            nodes: item.blocks_ids.map((id) => ({
              __typename: "WorktrackerIssueBlockedByEdge",
              from_issue_id: id,
            })),
          },
        })),
      },
    } as never,
  });
}
