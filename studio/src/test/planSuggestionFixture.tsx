import { PlanningGraphDocument } from "../features/planning-graph";
import { studioApolloClient } from "../shared/apollo/client";
import { fireEvent, screen, within } from "@testing-library/react";
import { useGlobalKeymap } from "../app/navigation/useGlobalKeymap";
import IssueDetail from "../app/shell/ticket-workspace/selected-ticket/details/IssueDetail";
import type { SprintSuggestionRecordFragment } from "../features/sprints/generated/sprints.documents";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { PlanWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { fixture, mountStudio, workItem } from "./seam";

export const proposal = {
  __typename: "WorktrackerSprintSuggestion", id: "proposal", sprintId: "release", goalId: "goal",
  issueId: null, issue: null, proposedName: "Agent wording", proposedEpicId: "epic",
  reason: "Helps people plan a release", status: "waiting", runId: "run", createdAt: "2026-10-04",
} satisfies SprintSuggestionRecordFragment;

function ProposalPlan({ fullDetail }: { fullDetail: boolean }) {
  useGlobalKeymap();
  return <PlanSprintView projectId="project-1" sprintId="release"
    renderWorkItemDetail={(id) => fullDetail ? <IssueDetail issueId={id} detailsVisible /> : <p>Selected ticket {id}</p>} />;
}

export function mountProposal({ existing = false, newerStory = false, fullDetail = false, freshProposal = false, secondProposal = false, bulkStories = false } = {}) {
  const http = fixture();
  const storedStory = workItem({ id: "created-story", name: "My release story", parent_id: null, state: { id: "idea", name: "Implement", group: "backlog", color: null }, issue_type: { id: "story-type", name: "Story", level: "task", color: null, sort_order: 0 } });
  http.tree("module-1", { rootIds: freshProposal ? [] : ["created-story"], children: {}, order: freshProposal ? [] : ["created-story"] });
  if (!freshProposal) http.workItems([storedStory]);
  let current: SprintSuggestionRecordFragment = { ...proposal, proposedEpicId: "module-1" };
  const second = { ...current, id: "second-proposal", proposedName: "Second proposal" };
  const decisions: unknown[] = [];
  let failDecision = false;
  let failRefresh = false;
  let missingProject = false;
  let unknownDecision: "before" | "after" | "afterServer" | null = null;
  const reads = { PlanningGraph: 0, SprintSuggestions: 0, SprintSuggestionExecution: 0 };
  let decisionGate: Promise<void> | null = null;
  let graphGate: Promise<void> | null = null;
  let suggestionGate: Promise<void> | null = null;
  let failSuggestionRead = false;
  let omitSuggestionStatus = false;
  let inconsistentMembership = false;
  let moduleGate: Promise<void> | null = null;
  let heldModuleId = "module-2";
  const created = {
    __typename: "WorktrackerIssue", id: "created-story", name: "My release story", sequenceId: 3, rank: "V",
    parentId: null, moduleId: "module-1", stateId: "idea", stateRevision: 1, sprintId: "release",
    updatedAt: "2026-10-04", issueType: { id: "story-type", name: "Story" },
  } satisfies NonNullable<SprintSuggestionRecordFragment["issue"]>;
  const graph = {
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Planner", slug: "PLAN" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [{ __typename: "WorktrackerState", id: "idea", name: "Implement", group: "backlog", color: "", sortOrder: 0 }] },
    issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [{ __typename: "WorktrackerIssuetype", id: "story-type", name: "Story", level: "task" }, { __typename: "WorktrackerIssuetype", id: "epic-type", name: "Epic", level: "module" }] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: [{ __typename: "WorktrackerIssue", id: "module-1", name: "Module 1", sequenceId: 1, presentation: { __typename: "WorktrackerModulePresentationConnection", nodes: [] } }] },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [{ __typename: "WorktrackerSprint", id: "release", name: "October release", status: "planned", rank: "V", createdAt: "2026-10-04" }] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: new Array<NonNullable<SprintSuggestionRecordFragment["issue"]>>() },
  };
  if (newerStory) {
    http.tree("module-2", { rootIds: ["newer-story"], children: {}, order: ["newer-story"] });
    http.workItems([workItem({ id: "newer-story", name: "A different story", parent_id: null, state: { id: "idea", name: "Implement", group: "backlog", color: null }, issue_type: { id: "story-type", name: "Story", level: "task", color: null, sort_order: 0 } })]);
    graph.modules.nodes.push({ ...graph.modules.nodes[0], id: "module-2", name: "Module 2", sequenceId: 2 });
    graph.workItems.nodes.push({ ...created, id: "newer-story", name: "A different story", moduleId: "module-2", sequenceId: 4 });
  }
  let extras: SprintSuggestionRecordFragment[] = bulkStories ? ["First", "Second"].map((name, index) => ({
    ...current, id: `existing-${index}`, issueId: `existing-story-${index}`, proposedName: null, proposedEpicId: null,
    issue: { ...created, id: `existing-story-${index}`, name: `${name} existing`, sequenceId: index + 4, sprintId: null },
  })) : [];
  graph.workItems.nodes.push(...extras.flatMap((row) => row.issue ? [row.issue] : []));
  let backgroundAfter = -1;
  let backgroundGraphGate: Promise<void> | null = null;
  let pendingBackgroundGate: Promise<void> | null = null;
  let backgroundRefresh: Promise<unknown> | undefined;
  if (existing) {
    const issue = { ...created, sprintId: null };
    current = { ...current, issueId: issue.id, issue, proposedName: null, proposedEpicId: null };
    graph.workItems.nodes = [issue];
  }
  usePlanWorkspace.setState({ ...usePlanWorkspace.getInitialState(), active: true, projectId: "project-1", sprintId: "release" }, true);
  mountStudio({ http, children: <ProposalPlan fullDetail={fullDetail} />,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      switch (documentOperationName(document)) {
        case "PlanningGraph":
          reads.PlanningGraph++;
          const backgroundGate = backgroundGraphGate;
          backgroundGraphGate = null;
          await backgroundGate;
          await graphGate;
          if (failRefresh) { failRefresh = false; throw new Error("Planning refresh unavailable"); }
          return (missingProject ? { ...graph, project: { __typename: "WorktrackerProjectConnection", nodes: [] } } : graph) as TResult;
        case "SprintSuggestions":
          reads.SprintSuggestions++;
          if (decisions.length === backgroundAfter) {
            backgroundAfter = -1;
            backgroundGraphGate = pendingBackgroundGate;
            backgroundRefresh = studioApolloClient().refetchQueries({ include: [PlanningGraphDocument] });
          }
          await suggestionGate;
          if (failSuggestionRead) { failSuggestionRead = false; throw new Error("Suggestion read unavailable"); }
          return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [...extras, ...(secondProposal ? [current, second] : [current])].map((row) => {
            const authoritative = inconsistentMembership && row.issue ? { ...row, issue: { ...row.issue, sprintId: null } } : row;
            if (!omitSuggestionStatus) return authoritative;
            const { status: _status, ...partial } = row;
            return partial;
          }) } } as TResult;
        case "SprintSuggestionExecution": reads.SprintSuggestionExecution++; return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [{
          __typename: "WorktrackerSprint", id: "release", status: "planned", goalsRevisedAt: null, suggestionRunId: null,
          goals: { __typename: "WorktrackerSprintGoalConnection", nodes: [{ __typename: "WorktrackerSprintGoal", id: "goal", text: "Make release planning easier", position: 1 }] },
          suggestions: { __typename: "WorktrackerSprintSuggestionConnection", nodes: current.status === "waiting" ? [{ __typename: "WorktrackerSprintSuggestion", id: current.id }] : [] },
        }] } } as TResult;
        case "UpdateSprintSuggestion": {
          decisions.push(variables);
          await decisionGate;
          const extra = extras.find((row) => typeof variables === "object" && variables && "id" in variables && row.id === variables.id);
          if (extra && extra.issue) {
            const accepted = { ...extra, status: "accepted", issue: { ...extra.issue, sprintId: "release" } };
            extras = extras.map((row) => row.id === extra.id ? accepted : row);
            graph.workItems.nodes = graph.workItems.nodes.map((row) => row.id === accepted.issue.id ? accepted.issue : row);
            return { update_sprint_suggestion: accepted } as TResult;
          }
          if (unknownDecision === "before") { unknownDecision = null; throw new Error("Connection lost"); }
          if (failDecision) { failDecision = false; throw new FoundationGraphQlError("validation", "Suggestion decision failed"); }
          if (typeof variables === "object" && variables && "status" in variables && typeof variables.status === "string") {
            const name = "proposedName" in variables && typeof variables.proposedName === "string" ? variables.proposedName : current.proposedName;
            current = { ...current, status: variables.status, proposedName: name };
            if (variables.status === "accepted") {
              const issue = { ...(current.issue ?? created), name: name ?? current.issue?.name ?? created.name, sprintId: "release" };
              if (freshProposal) {
                http.workItems([{ ...storedStory, name: issue.name }]);
                http.tree("module-1", { rootIds: [issue.id], children: {}, order: [issue.id] });
              }
              current = { ...current, issueId: issue.id, issue };
              graph.workItems.nodes = [issue, ...graph.workItems.nodes.filter((row) => row.id !== issue.id)];
            } else if (variables.status === "waiting" && current.issue) {
              const issue = { ...current.issue, sprintId: null };
              current = { ...current, issue, proposedName: null, proposedEpicId: null };
              graph.workItems.nodes = [issue, ...graph.workItems.nodes.filter((row) => row.id !== issue.id)];
            }
          }
          if (current.issueId && (current.status === "accepted" || current.status === "waiting")) {
            const changed = await http.executeGraphQl(PlanWorkItemDocument, { id: current.issueId, sprintId: current.status === "accepted" ? "release" : null });
            if (current.issue) {
              const issue = { ...current.issue, stateRevision: changed.update_work_item.state_revision };
              current = { ...current, issue };
              graph.workItems.nodes = graph.workItems.nodes.map((row) => row.id === issue.id ? issue : row);
            }
          }
          if (unknownDecision === "after" || unknownDecision === "afterServer") { const server = unknownDecision === "afterServer"; unknownDecision = null; throw server ? new FoundationGraphQlError("unknown", "Response field failed after save") : new Error("Connection lost"); }
          return { update_sprint_suggestion: current } as TResult;
        }
        default:
          if (documentOperationName(document) === "WorkTrackerModuleOpen" && typeof variables === "object" && variables !== null && "moduleId" in variables && variables.moduleId === heldModuleId) await moduleGate;
          return http.executeGraphQl(document, variables);
      }
    },
  });
  return { holdBackgroundAfterDecision: (after: number) => {
    backgroundAfter = after;
    let release = () => {};
    pendingBackgroundGate = new Promise<void>((resolve) => { release = resolve; });
    return async () => { release(); await backgroundRefresh; };
  }, inconsistentSuggestionMembership: (inconsistent = true) => { inconsistentMembership = inconsistent; }, omitSuggestionStatus: (omit = true) => { omitSuggestionStatus = omit; }, omitProject: (omit = true) => { missingProject = omit; }, failNextSuggestionRead: () => { failSuggestionRead = true; }, holdSuggestions: () => {
    let release = () => {};
    suggestionGate = new Promise<void>((resolve) => { release = () => { suggestionGate = null; resolve(); }; });
    return release;
  }, holdGraph: () => {
    let release = () => {};
    graphGate = new Promise<void>((resolve) => { release = () => { graphGate = null; resolve(); }; });
    return release;
  }, loseNextDecision: (when: "before" | "after" | "afterServer") => { unknownDecision = when; }, reads, failNextRefresh: () => { failRefresh = true; }, holdModule: (moduleId = "module-2") => {
    heldModuleId = moduleId;
    let release = () => {};
    moduleGate = new Promise<void>((resolve) => { release = () => { moduleGate = null; resolve(); }; });
    return release;
  }, decisions, failNextDecision: () => { failDecision = true; }, holdDecision: () => {
    let release = () => {};
    decisionGate = new Promise<void>((resolve) => { release = () => { decisionGate = null; resolve(); }; });
    return release;
  } };

}

export async function reviewProposal() {
  await screen.findByRole("button", { name: "Add epic" });
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(await screen.findByRole("button", { name: "Module 1, 0 backlog stories, 1 waiting suggestions" }));
  fireEvent.click(await screen.findByRole("button", { name: "✦ Agent wording" }));
  return within(screen.getByRole("complementary", { name: "Selected ticket" }));
}
