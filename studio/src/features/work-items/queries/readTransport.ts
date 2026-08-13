import { studioRuntime } from "../../../runtime";
import * as rest from "../../../shared/api/client";
import type {
  ModuleTree,
  State,
  WorkItem,
} from "../../../shared/api/types";
import { createWorkItemBatcher } from "../../../shared/api/workItemBatcher";
import {
  WorkTrackerWorkItemDocument,
  WorkTrackerModuleTreeDocument,
  WorkTrackerWorkItemsByIdsDocument,
  WorkTrackerWorkItemsDocument,
  type WorkTrackerWorkItem,
} from "../generated/operations";

function mutableWorkItem(item: WorkTrackerWorkItem): WorkItem {
  return {
    ...item,
    blocked_by_ids: [...item.blocked_by_ids],
    blocks_ids: [...item.blocks_ids],
  };
}

export function readWorkItemsByIds(ids: readonly string[]): Promise<WorkItem[]> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.listWorkItemsByIds(ids),
    graphQl: async (execute) => (
      await execute(WorkTrackerWorkItemsByIdsDocument, { ids: [...ids] })
    ).work_items_by_ids.map(mutableWorkItem),
  });
}

export function readWorkItem(id: string): Promise<WorkItem> {
  return studioRuntime().readWorkTracker({
    rest: async () => (await rest.getWorkItem(id)).task,
    graphQl: async (execute) => {
      const item = (await execute(WorkTrackerWorkItemDocument, { id })).work_item;
      if (!item) throw new Error(`Work item ${id} was not found.`);
      return mutableWorkItem(item);
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
        projectId,
        moduleId,
      });
      const workItems = result.work_items.map(mutableWorkItem);
      return {
        ...rest.moduleTreeFromWorkItems(moduleId, workItems),
        workItems,
        states: result.states.map((state) => ({ ...state })),
      };
    },
  });
}

export function readProjectWorkItems(projectId: string): Promise<WorkItem[]> {
  return studioRuntime().readWorkTracker({
    rest: () => rest.getProjectWorkItems(projectId),
    graphQl: async (execute) => (
      await execute(WorkTrackerWorkItemsDocument, { projectId })
    ).work_items.map(mutableWorkItem),
  });
}

const workItemBatcher = createWorkItemBatcher(readWorkItemsByIds);

export const readBatchedWorkItem = workItemBatcher.fetchWorkItem;
