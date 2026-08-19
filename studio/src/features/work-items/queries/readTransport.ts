import { studioRuntime } from "../../../runtime";
import * as rest from "../../../shared/api/client";
import type {
  ModuleTree,
  State,
  WorkItem,
} from "../../../shared/api/types";
import {
  compactWorktrackerId,
  publicWorktrackerId,
} from "../../../shared/api/generatedWorktracker";
import { createWorkItemBatcher } from "../../../shared/api/workItemBatcher";
import {
  WorkTrackerWorkItemDocument,
  WorkTrackerWorkItemByKeyDocument,
  WorkTrackerModuleTreeDocument,
  WorkTrackerWorkItemsByIdsDocument,
  WorkTrackerWorkItemsDocument,
} from "../generated/operations";
import { orderedWorkItems, workItemFromIssue } from "../issueAdapter";

export function readWorkItemsByIds(ids: readonly string[]): Promise<WorkItem[]> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.listWorkItemsByIds(ids),
    graphQl: async (execute) => {
      const rows = (
        await execute(WorkTrackerWorkItemsByIdsDocument, {
          ids: ids.map(compactWorktrackerId),
        })
      ).work_items_by_ids.nodes.map(workItemFromIssue);
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ids.flatMap((id) => {
        const row = byId.get(publicWorktrackerId(id));
        return row ? [row] : [];
      });
    },
  });
}

export function readWorkItem(id: string): Promise<WorkItem> {
  return studioRuntime().readWorkTracker({
    rest: async () => (await rest.getWorkItem(id)).task,
    graphQl: async (execute) => {
      const key = /^(.*)-(\d+)$/.exec(id);
      const result = key
        ? await execute(WorkTrackerWorkItemByKeyDocument, {
            projectSlug: key[1]!.toUpperCase(),
            sequenceId: Number(key[2]),
          })
        : await execute(WorkTrackerWorkItemDocument, {
            id: compactWorktrackerId(id),
          });
      const item = result.work_item.nodes[0];
      if (!item) throw new Error(`Work item ${id} was not found.`);
      return workItemFromIssue(item);
    },
  });
}

export function readModuleTreeRecords(
  projectId: string,
  moduleId: string,
): Promise<ModuleTree & { workItems: WorkItem[]; states: State[] }> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.getTasks(projectId, moduleId),
    graphQl: async (execute) => {
      const result = await execute(WorkTrackerModuleTreeDocument, {
        projectId: compactWorktrackerId(projectId),
        moduleId: compactWorktrackerId(moduleId),
      });
      const workItems = orderedWorkItems(result.work_items.nodes);
      return {
        ...rest.moduleTreeFromWorkItems(moduleId, workItems),
        workItems,
        states: result.states.nodes.map((state) => ({
          ...state,
          id: publicWorktrackerId(state.id),
        })),
      };
    },
  });
}

export function readProjectWorkItems(projectId: string): Promise<WorkItem[]> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.getProjectWorkItems(projectId),
    graphQl: async (execute) => orderedWorkItems((
      await execute(WorkTrackerWorkItemsDocument, {
        projectId: compactWorktrackerId(projectId),
      })
    ).work_items.nodes),
  });
}

const workItemBatcher = createWorkItemBatcher(readWorkItemsByIds);

export const readBatchedWorkItem = workItemBatcher.fetchWorkItem;
