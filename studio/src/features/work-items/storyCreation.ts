import { CombinedGraphQLErrors } from "@apollo/client";
import { useApolloClient, useMutation } from "@apollo/client/react";
import { useMemo } from "react";

import { adaptPlanningGraph, backlogCandidateIn, PlanningGraphDocument, refreshPlanningGraph } from "../planning-graph";
import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";
import { FoundationGraphQlError } from "../../shared/apollo/errorLink";
import {
  CreateWorkTrackerWorkItemDocument,
  PlanWorkItemDocument,
  WorkItemSprintDocument,
  WorkTrackerWorkItemDocument,
} from "./generated/workItems.documents";
import { claimPlanWrite, releasePlanWrite } from "./planWriteGuard";

export type CreateOutcome =
  | { kind: "created"; id: string }
  | { kind: "rejected"; message: string }
  | { kind: "unknown"; message: string };
export type AssignOutcome = { kind: "assigned" } | { kind: "failed"; message: string };
export type RefreshOutcome = { kind: "ok" } | { kind: "failed"; message: string };

function messageOf(error: unknown): string {
  return CombinedGraphQLErrors.is(error)
    ? error.errors.map((each) => each.message).join(" ")
    : error instanceof Error ? error.message : String(error);
}

const isServerRejection = (error: unknown): boolean =>
  CombinedGraphQLErrors.is(error) || error instanceof FoundationGraphQlError;

/** Separate outcomes let callers recover a committed story without creating it again. */
export function useStoryCreation(projectId: string) {
  const client = useApolloClient();
  const [create] = useMutation(CreateWorkTrackerWorkItemDocument);
  const [plan] = useMutation(PlanWorkItemDocument);

  return useMemo(() => {
    async function createWorkItem(input: {
      name: string;
      issueTypeId: string;
      epicId: string | null;
      description?: string;
    }): Promise<CreateOutcome> {
      try {
        const { data } = await create({ variables: {
          projectId: compactWorktrackerId(projectId),
          name: input.name,
          issueTypeId: compactWorktrackerId(input.issueTypeId),
          parentId: input.epicId === null ? null : compactWorktrackerId(input.epicId),
          ...(input.description === undefined ? {} : { description: input.description }),
        } });
        const id = data?.create_work_item.id;
        return id ? { kind: "created", id } : { kind: "unknown", message: "The server returned no issue." };
      } catch (error) {
        return { kind: isServerRejection(error) ? "rejected" : "unknown", message: messageOf(error) };
      }
    }

    async function assignedByRead(id: string, sprintId: string, message: string): Promise<AssignOutcome> {
      try {
        const { data } = await client.query({
          query: WorkItemSprintDocument,
          variables: { id },
          fetchPolicy: "network-only",
          context: { queryDeduplication: false },
        });
        const assignedSprint = data?.worktrackerIssue.nodes[0]?.sprintId;
        return assignedSprint && compactWorktrackerId(assignedSprint) === sprintId
          ? { kind: "assigned" } : { kind: "failed", message };
      } catch {
        return { kind: "failed", message };
      }
    }

    async function assignStory(id: string, sprintId: string): Promise<AssignOutcome> {
      const itemId = compactWorktrackerId(id);
      const destination = compactWorktrackerId(sprintId);
      if (!claimPlanWrite(itemId)) return { kind: "failed", message: "Another sprint change for this issue is still saving." };
      try {
        const { data: detail } = await client.query({
          query: WorkTrackerWorkItemDocument,
          variables: { id: itemId },
          fetchPolicy: "no-cache",
        });
        const item = detail?.work_item.nodes[0];
        if (item?.sprint_id && compactWorktrackerId(item.sprint_id) === destination) return { kind: "assigned" };
        const data = client.readQuery({ query: PlanningGraphDocument, variables: { projectId } });
        if (!data || !item || item.is_archived || !backlogCandidateIn(adaptPlanningGraph(data))({
          parentId: item.parent_id,
          stateId: item.state_id,
          sprintId: item.sprint_id,
          typeName: item.issue_type_record?.name ?? null,
        })) return { kind: "failed", message: "Story is outside the planning backlog." };
        await plan({ variables: { id: itemId, sprintId: destination } });
        return { kind: "assigned" };
      } catch (error) {
        if (isServerRejection(error)) return { kind: "failed", message: messageOf(error) };
        return await assignedByRead(itemId, destination, messageOf(error));
      } finally {
        releasePlanWrite(itemId);
      }
    }

    async function refreshGraph(): Promise<RefreshOutcome> {
      try {
        await refreshPlanningGraph(client, projectId);
        return { kind: "ok" };
      } catch (error) {
        return { kind: "failed", message: messageOf(error) };
      }
    }

    return { createWorkItem, assignStory, refreshGraph };
  }, [client, create, plan, projectId]);
}
