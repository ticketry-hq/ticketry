import { studioRuntime } from "../../../runtime";
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
import { WorkTrackerAttachmentsDocument } from "../generated/attachments";
import { orderedWorkItems, workItemFromIssue } from "../issueAdapter";
import type { Attachment } from "../../../shared/api/types";

export function readWorkItemAttachments(id: string): Promise<Attachment[]> {
  return studioRuntime().readWorkTracker({
    graphQl: async (execute) => (await execute(WorkTrackerAttachmentsDocument, {
      issueId: compactWorktrackerId(id),
    })).attachments.nodes.map((attachment) => ({
      id: publicWorktrackerId(attachment.id),
      issue: publicWorktrackerId(attachment.issue_id),
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size: attachment.size,
      url: attachment.file,
      created_at: attachment.created_at,
    })),
  });
}

export function readWorkItemsByIds(ids: readonly string[]): Promise<WorkItem[]> {
  return studioRuntime().readWorkTracker({
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
    graphQl: async (execute) => {
      const result = await execute(WorkTrackerModuleTreeDocument, {
        projectId: compactWorktrackerId(projectId),
        moduleId: compactWorktrackerId(moduleId),
      });
      const workItems = orderedWorkItems(result.work_items.nodes);
      return {
        ...moduleTreeFromWorkItems(moduleId, workItems),
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
    graphQl: async (execute) => orderedWorkItems((
      await execute(WorkTrackerWorkItemsDocument, {
        projectId: compactWorktrackerId(projectId),
      })
    ).work_items.nodes),
  });
}

const workItemBatcher = createWorkItemBatcher(readWorkItemsByIds);

export const readBatchedWorkItem = workItemBatcher.fetchWorkItem;

function moduleTreeFromWorkItems(moduleId: string, tasks: readonly WorkItem[]) {
  const rootIds: string[] = [];
  const children: Record<string, string[]> = {};
  const order: string[] = [];
  for (const task of tasks) {
    order.push(task.id);
    children[task.id] = [];
  }
  for (const task of tasks) {
    if (task.parent_id === moduleId) rootIds.push(task.id);
    else if (task.parent_id && children[task.parent_id]) children[task.parent_id].push(task.id);
  }
  return { rootIds, children, order };
}
