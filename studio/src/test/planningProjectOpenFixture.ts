import type { PlanningGraphQuery } from "../features/planning-graph/generated/planningGraph.documents";
import type { WorkTrackerProjectOpenQuery } from "../features/projects/generated/projects.documents";
import type { TypedDocumentNode } from "../graphql-foundation/typedDocument";
import type { StudioFixture } from "./seam";

/** Both queries read the same project module collection at the GraphQL boundary. */
export async function planningProjectOpenFixture<TResult, TVariables>(
  http: StudioFixture,
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  graph: Pick<PlanningGraphQuery, "project" | "modules" | "issueTypes">,
): Promise<TResult> {
  const result = await http.executeGraphQl(document, variables) as WorkTrackerProjectOpenQuery;
  const project = graph.project.nodes[0];
  const epicType = graph.issueTypes.nodes.find((type) => type.level === "module");
  return { ...result, modules: { __typename: "WorktrackerIssueConnection", nodes: graph.modules.nodes.map((module, index) => ({
    __typename: "WorktrackerIssue", id: module.id, name: module.name,
    project_id: project.id, sequence_id: module.sequenceId, is_archived: false,
    state_revision: 1, issue_type: epicType?.id ?? "epic-type", rank: String(index),
    project: { __typename: "WorktrackerProject", id: project.id, slug: project.slug },
  })) } } as TResult;
}
