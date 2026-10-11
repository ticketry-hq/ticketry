import { documentOperationName } from "../graphql-foundation/typedDocument";
import { PlanningGraphDocument } from "../features/planning-graph";
import { studioApolloClient } from "../shared/apollo/client";
import { storySprintModuleBoundary } from "./storySprintModuleBoundary";
import { useTerminalStore } from "../features/agents/terminal";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useClientStore } from "../state/clientStore";

export function roadmapAvailabilityFixture({ withDocument = false }: { withDocument?: boolean } = {}) {
  const f = storySprintModuleBoundary();
  const graph = {
    project: { __typename: "WorktrackerProjectConnection", nodes: [{ __typename: "WorktrackerProject", id: "project-1", name: "Project", slug: "PROJECT" }] },
    states: { __typename: "WorktrackerStateConnection", nodes: [] },
    issueTypes: { __typename: "WorktrackerIssuetypeConnection", nodes: [] },
    modules: { __typename: "WorktrackerIssueConnection", nodes: f.modules.map((module) => ({
      __typename: "WorktrackerIssue", id: module.id, name: module.name, sequenceId: module.sequence_id,
      presentation: { __typename: "WorktrackerModulepresentationConnection", nodes: [] },
    })) },
    sprints: { __typename: "WorktrackerSprintConnection", nodes: [
      { __typename: "WorktrackerSprint", id: "sprint-24", name: "Sprint 24", status: "active", rank: "V", createdAt: "2026-01-01" },
      { __typename: "WorktrackerSprint", id: "sprint-25", name: "Sprint 25", status: "planned", rank: "V", createdAt: "2026-01-02" },
    ] },
    workItems: { __typename: "WorktrackerIssueConnection", nodes: [{
      __typename: "WorktrackerIssue", id: "release-25", name: "Release next story", sequenceId: 4, rank: "V", parentId: "module-3",
      moduleId: "module-3", stateId: null, stateRevision: 1, sprintId: "sprint-25", updatedAt: "2026-01-01",
      issueType: { __typename: "WorktrackerIssuetype", id: "story", name: "Story" },
    }] },
  };
  const goals = [{ __typename: "WorktrackerSprintGoal", id: "goal-25", text: "Ship retained goal", position: 1 }];
  const suggestions = [{
    __typename: "WorktrackerSprintSuggestion", id: "suggestion-25", sprintId: "sprint-25", goalId: "goal-25",
    issueId: "release-25", proposedName: null, proposedEpicId: null, reason: "Retained suggestion",
    status: "waiting", runId: "run-suggestion", createdAt: "2026-01-01", issue: graph.workItems.nodes[0],
  }];
  const documents = withDocument ? [{ __typename: "DesignDocuments", id: "design", relPath: "DESIGN.html", contentDigest: null }] : [];
  const execute: typeof f.execute = async (document, variables) => {
    const operation = documentOperationName(document);
    if (["PlanningGraph", "SprintGoals", "SprintSuggestions", "SprintSuggestionExecution"].includes(operation)) f.calls.push({ operation, variables });
    if (operation === "PlanningGraph") return graph as never;
    if (operation === "SprintGoals") return { worktrackerSprintGoal: { __typename: "WorktrackerSprintGoalConnection", nodes: goals } } as never;
    if (operation === "RefreshTaskDocumentRegistry") return { refresh_task_document_registry: documents } as never;
    if (operation === "TaskDocumentRegistry") return { document_registry: { __typename: "DesignDocumentsConnection", nodes: documents } } as never;
    if (operation === "SprintSuggestions") return { worktrackerSprintSuggestion: { __typename: "WorktrackerSprintSuggestionConnection", nodes: suggestions } } as never;
    if (operation === "SprintSuggestionExecution") return { worktrackerSprint: { __typename: "WorktrackerSprintConnection", nodes: [{
      ...graph.sprints.nodes[1], goalsRevisedAt: null, suggestionRunId: null,
      goals: { __typename: "WorktrackerSprintGoalConnection", nodes: goals },
      suggestions: { __typename: "WorktrackerSprintSuggestionConnection", nodes: [] },
    }] } } as never;
    return f.execute(document, variables);
  };
  function seedGraph() {
    studioApolloClient().writeQuery({ query: PlanningGraphDocument, variables: { projectId: "project-1" }, data: graph });
  }
  function mount(options: Parameters<typeof f.mount>[0] = {}) {
    const result = f.mount({ shell: true, ...options, graphQlExecute: options?.graphQlExecute ?? execute });
    seedGraph();
    return result;
  }
  function seedTerminal() {
    useTerminalStore.setState({ sessions: { "viewer-retained": {
      sessionId: "viewer-retained", taskId: "roadmap-24", projectId: "project-1", moduleId: "module-1", agent: "codex",
      status: "ready", transport: "ready", isPlanning: false, isInstant: false, initialPrompt: null, agentRunId: "run-retained",
    } }, sessionByRun: { "run-retained": "viewer-retained" } });
    useAgentStatusStore.setState({ runs: { "run-retained": {
      agent_run_id: "run-retained", project_id: "project-1", task_id: "roadmap-24", module_id: "module-1",
      agent: "codex", scope: "task", state: "working", updated_at: "2026-01-01",
    } } });
    useClientStore.setState({ activeByTask: { "roadmap-24": "viewer-retained" }, workspaces: {
      "roadmap-24": { active: "terminal", activeDocId: null, closedDocIds: [] },
    } });
  }
  return { ...f, execute, mount, seedGraph, seedTerminal, graph, goals, suggestions };
}
