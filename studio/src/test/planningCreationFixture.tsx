import { fireEvent, screen, within } from "@testing-library/react";
import type { PlanningGraphQuery } from "../features/planning-graph/generated/planningGraph.documents";
import { openPlanSprint, usePlanWorkspace } from "../features/sprints/planWorkspaceState";
import PlanSprintView from "../features/sprints/planning/PlanSprintView";
import { WorkTrackerWorkItemDocument } from "../features/work-items/generated/workItems.documents";
import { documentOperationName, type TypedDocumentNode } from "../graphql-foundation/typedDocument";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { fixture, mountStudio, workItem } from "./seam";

function record<T extends object>(__typename: string, fields: T) {
  return { __typename, ...fields };
}

function PlanningWorkspace() {
  const sprintId = usePlanWorkspace((state) => state.sprintId);
  return sprintId
    ? <PlanSprintView projectId="project-1" sprintId={sprintId} renderWorkItemDetail={(id) => <p>Selected ticket {id}</p>} />
    : <button onClick={() => openPlanSprint("sprint")}>Plan sprint</button>;
}

export function mountPlanning({ status = "planned" }: { status?: "planned" | "completed" } = {}) {
  const http = fixture();
  http.tree("module-1", { rootIds: [], children: {}, order: [] });
  const graph = {
    project: record("WorktrackerProjectConnection", { nodes: [record("WorktrackerProject", { id: "project-1", name: "Planner", slug: "PLAN" })] }),
    states: record("WorktrackerStateConnection", { nodes: [record("WorktrackerState", { id: "idea", name: "Ideas", group: "backlog", color: "", sortOrder: 0 }), record("WorktrackerState", { id: "implement", name: "Implement", group: "started", color: "", sortOrder: 1 })] }),
    issueTypes: record("WorktrackerIssuetypeConnection", { nodes: [record("WorktrackerIssuetype", { id: "story-type", name: "Story", level: "task" }), record("WorktrackerIssuetype", { id: "epic-type", name: "Epic", level: "module" })] }),
    modules: record("WorktrackerIssueConnection", { nodes: [record("WorktrackerIssue", { id: "module-1", name: "Module 1", sequenceId: 1, presentation: record("WorktrackerModulePresentationConnection", { nodes: [] }) })] }),
    sprints: record("WorktrackerSprintConnection", { nodes: [record("WorktrackerSprint", { id: "sprint", name: "Release", status, rank: "V", createdAt: "2026-10-04" })] }),
    workItems: record("WorktrackerIssueConnection", { nodes: [] }),
  } satisfies PlanningGraphQuery;
  const items: PlanningGraphQuery["workItems"]["nodes"] = [];
  const requests: { operation: string; variables: unknown }[] = [];
  type Intervention = { kind: "fail" | "lose"; error: Error } | { kind: "hold"; wait: Promise<void> };
  const interventions = new Map<string, Intervention[]>();
  function enqueue(operation: string, intervention: Intervention) {
    interventions.set(operation, [...(interventions.get(operation) ?? []), intervention]);
  }
  usePlanWorkspace.setState({ active: true, projectId: "project-1", sprintId: "sprint" });
  mountStudio({ http, children: <PlanningWorkspace />,
    graphQlExecute: async <TResult, TVariables,>(document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult> => {
      const operation = documentOperationName(document);
      requests.push({ operation, variables });
      const intervention = interventions.get(operation)?.shift();
      const graphSnapshot = { ...graph,
        modules: record("WorktrackerIssueConnection", { nodes: graph.modules.nodes.map((module) => ({ ...module })) }),
        workItems: record("WorktrackerIssueConnection", { nodes: items.map((item) => ({ ...item })) }),
      };
      const sprintSnapshot = items.map((item) => record("WorktrackerIssue", { id: item.id, sprintId: item.sprintId, stateRevision: item.stateRevision }));
      if (intervention?.kind === "hold") await intervention.wait;
      if (intervention?.kind === "fail") throw intervention.error;
      switch (operation) {
        case "PlanningGraph": return graphSnapshot as TResult;
        case "SprintSuggestions": return { worktrackerSprintSuggestion: record("WorktrackerSprintSuggestionConnection", { nodes: [] }) } as TResult;
        case "SprintSuggestionExecution": return { worktrackerSprint: record("WorktrackerSprintConnection", { nodes: [] }) } as TResult;
        case "WorkItemEndedRuns": return { work_item: record("WorktrackerIssueConnection", { nodes: [] }) } as TResult;
        case "InstantRunTickets": return { tickets: [] } as TResult;
        case "CreateWorkTrackerWorkItem": {
          if (typeof variables !== "object" || variables === null || !("name" in variables) || typeof variables.name !== "string") throw new Error("Create request needs a story title");
          if ("issueTypeId" in variables && variables.issueTypeId === "epic-type") {
            const id = `created-epic-${graph.modules.nodes.length}`;
            const epic = workItem({ id, name: variables.name, issue_type: { id: "epic-type", name: "Epic", level: "module", color: null, sort_order: 0 } });
            http.workItems([epic]);
            graph.modules.nodes.push(record("WorktrackerIssue", {
              id, name: variables.name, sequenceId: graph.modules.nodes.length + 1,
              presentation: record("WorktrackerModulePresentationConnection", { nodes: [] }),
            }));
            const result = await http.executeGraphQl(WorkTrackerWorkItemDocument, { id });
            return { create_work_item: result.work_item.nodes[0] } as TResult;
          }
          const id = `created-${items.length + 1}`;
          const story = workItem({ id, name: variables.name, parent_id: "module-1", state: { id: "idea", name: "Ideas", group: "backlog", color: null }, issue_type: { id: "story-type", name: "Story", level: "task", color: null, sort_order: 1 } });
          http.workItems([story]);
          http.tree("module-1", { rootIds: [...items.map((item) => item.id), id], children: {}, order: [...items.map((item) => item.id), id] });
          items.push(record("WorktrackerIssue", { id, name: variables.name, sequenceId: items.length + 2, rank: "V", parentId: "module-1", moduleId: "module-1", stateId: "idea", stateRevision: 1, sprintId: null, updatedAt: "2026-10-04", issueType: record("WorktrackerIssuetype", { id: "story-type", name: "Story" }) }));
          const result = await http.executeGraphQl(WorkTrackerWorkItemDocument, { id });
          if (intervention?.kind === "lose") throw intervention.error;
          return { create_work_item: result.work_item.nodes[0] } as TResult;
        }
        case "PlanWorkItem": {
          if (typeof variables !== "object" || variables === null || !("id" in variables) || !("sprintId" in variables) || typeof variables.id !== "string" || (variables.sprintId !== null && typeof variables.sprintId !== "string")) throw new Error("Assignment request needs a story and sprint");
          const item = items.find((candidate) => candidate.id === variables.id);
          if (!item) throw new Error("Story does not exist");
          item.sprintId = variables.sprintId;
          item.stateRevision += 1;
          const result = await http.executeGraphQl(document, variables);
          if (intervention?.kind === "lose") throw intervention.error;
          return result;
        }
        case "WorkItemSprint": {
          if (typeof variables !== "object" || variables === null || !("id" in variables)) throw new Error("Sprint read needs a story");
          const item = sprintSnapshot.find((candidate) => candidate.id === variables.id);
          return { worktrackerIssue: record("WorktrackerIssueConnection", { nodes: item ? [item] : [] }) } as TResult;
        }
        default: return http.executeGraphQl(document, variables);
      }
    },
  });
  return {
    requests,
    failNext: (operation: string, message: string) => enqueue(operation, { kind: "fail", error: new FoundationGraphQlError("validation", message) }),
    loseNext: (operation: string) => enqueue(operation, { kind: "lose", error: new Error("Response was lost") }),
    holdNext: (operation: string) => {
      let release = () => {};
      const wait = new Promise<void>((resolve) => { release = resolve; });
      enqueue(operation, { kind: "hold", wait });
      return release;
    },
  };
}

export async function openEpic() {
  await screen.findByTestId("plan-backlog");
  fireEvent.click(screen.getByRole("button", { name: "Add epic" }));
  fireEvent.click(screen.getByRole("button", { name: "Module 1, 0 backlog stories" }));
  return within(screen.getByTestId("plan-backlog"));
}
