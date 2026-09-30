import type { ModuleTree, WorkItem } from "../../../shared/api/types";
import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../shared/apollo/client";
import {
  WorkTrackerModuleOpenDocument,
  WorkTrackerWorkItemByKeyDocument,
  WorkTrackerWorkItemDocument,
  WorkTrackerWorkItemsDocument,
} from "../generated/workItems.documents";
import { orderedWorkItems, workItemFromIssue } from "../issueAdapter";

export async function readWorkItem(id: string): Promise<WorkItem> {
  const key = /^(.*)-(\d+)$/.exec(id);
  const request = key
    ? studioApolloClient().query({
        query: WorkTrackerWorkItemByKeyDocument,
        variables: {
          projectSlug: key[1]!.toUpperCase(),
          sequenceId: Number(key[2]),
        },
        fetchPolicy: "network-only" as const,
      })
    : studioApolloClient().query({
        query: WorkTrackerWorkItemDocument,
        variables: { id: compactWorktrackerId(id) },
        fetchPolicy: "network-only" as const,
      });
  const { data } = await request;
  const item = data!.work_item.nodes[0];
  if (!item) throw new Error(`Work item ${id} was not found.`);
  return workItemFromIssue(item);
}

export async function readModuleTreeRecords(
  _projectId: string,
  moduleId: string,
): Promise<ModuleTree & { workItems: WorkItem[] }> {
  const { data } = await studioApolloClient().query({
    query: WorkTrackerModuleOpenDocument,
    variables: { moduleId: compactWorktrackerId(moduleId) },
    fetchPolicy: "network-only",
  });
  const workItems = orderedWorkItems(data!.work_items.nodes);
  return {
    ...moduleTreeFromWorkItems(moduleId, workItems),
    workItems,
  };
}

export async function readProjectWorkItems(projectId: string): Promise<WorkItem[]> {
  const { data } = await studioApolloClient().query({
    query: WorkTrackerWorkItemsDocument,
    variables: { projectId: compactWorktrackerId(projectId) },
    fetchPolicy: "network-only",
  });
  return orderedWorkItems(data!.work_items.nodes);
}

export function moduleTreeFromWorkItems(
  moduleId: string,
  tasks: readonly WorkItem[],
): ModuleTree {
  const publicModuleId = publicWorktrackerId(moduleId);
  const rootIds: string[] = [];
  const children: Record<string, string[]> = {};
  const order: string[] = [];
  for (const task of tasks) {
    order.push(task.id);
    children[task.id] = [];
  }
  for (const task of tasks) {
    if (task.parent_id === publicModuleId) rootIds.push(task.id);
    else if (task.parent_id && children[task.parent_id]) {
      children[task.parent_id].push(task.id);
    }
  }
  return { rootIds, children, order };
}
