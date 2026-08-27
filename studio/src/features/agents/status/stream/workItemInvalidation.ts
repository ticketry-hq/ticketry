/**
 * Batched WorkItem convergence.
 *
 * A single write can publish several facts (an archive cascades, a reparent
 * repairs descendants), so identities are collected in a short window and
 * invalidated once. Two rules make the batch safe:
 *
 * - The canonical entity is always refreshed; its containing collection only
 *   when a fact actually claimed a membership change.
 * Apollo keeps an optimistic layer above incoming network data, so external
 * refreshes can proceed while a local write is in flight without painting an
 * older value over the edit.
 */
import { compactWorktrackerId } from "../../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../../shared/apollo/client";
import { loadModules } from "../../../projects";
import {
  WorkTrackerModuleOpenDocument,
  WorkTrackerWorkItemDocument,
} from "../../../work-items";
import type { WorkItemFact } from "./statusFacts";

export const WORK_ITEM_INVALIDATION_WINDOW_MS = 50;

export interface WorkItemInvalidator {
  /** Queue one typed fact and refresh the collection that owns that item kind. */
  record(fact: WorkItemFact): void;
  /** Apply everything queued now, ignoring the window. */
  flush(): void;
  /** Drop everything queued; used when the feed stops or switches project. */
  cancel(): void;
}

export function createWorkItemInvalidator(
  windowMs: number = WORK_ITEM_INVALIDATION_WINDOW_MS,
): WorkItemInvalidator {
  const pending = new Set<string>();
  const removed = new Set<string>();
  const moduleProjects = new Set<string>();
  let taskMembershipChanged = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const ids = [...pending];
    const evicted = [...removed];
    const projects = [...moduleProjects];
    pending.clear();
    removed.clear();
    moduleProjects.clear();
    const refreshTaskMembership = taskMembershipChanged;
    taskMembershipChanged = false;
    const client = studioApolloClient();
    for (const id of evicted) {
      client.cache.evict({
        id: client.cache.identify({
          __typename: "WorktrackerIssue",
          id: compactWorktrackerId(id),
        }),
      });
    }
    for (const id of ids) {
      void client.query({
        query: WorkTrackerWorkItemDocument,
        variables: { id: compactWorktrackerId(id) },
        fetchPolicy: "network-only",
      }).catch(() => {});
    }
    for (const projectId of projects) {
      void loadModules(projectId, { queryDeduplication: false }).catch(() => {});
    }
    if (refreshTaskMembership) {
      void client.refetchQueries({ include: [WorkTrackerModuleOpenDocument] })
        .catch(() => {});
    }
    client.cache.gc();
  };

  return {
    record(fact) {
      if (fact.removed) {
        removed.add(fact.workItemId);
        pending.delete(fact.workItemId);
      } else if (fact.itemKind !== "module") {
        pending.add(fact.workItemId);
      }
      if (fact.itemKind === "module" && fact.projectId) {
        moduleProjects.add(fact.projectId);
      } else {
        taskMembershipChanged ||= fact.membershipChanged || fact.removed;
      }
      timer ??= setTimeout(flush, windowMs);
    },
    flush,
    cancel() {
      pending.clear();
      removed.clear();
      moduleProjects.clear();
      taskMembershipChanged = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
