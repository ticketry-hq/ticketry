/**
 * Batched WorkItem convergence.
 *
 * A single write can publish several facts (an archive cascades, a reparent
 * repairs descendants), so identities are collected in a short window and
 * invalidated once. Two rules make the batch safe:
 *
 * - The canonical entity is refreshed unless the fact names the exact server
 *   version a completed local mutation already adopted. Its containing
 *   collection refreshes only when the fact claims a membership change.
 * Apollo keeps an optimistic layer above incoming network data, so external
 * refreshes can proceed while a local write is in flight without painting an
 * older value over the edit.
 */
import { compactWorktrackerId } from "../../../../shared/api/generatedWorktracker";
import { studioApolloClient } from "../../../../shared/apollo/client";
import { loadModules } from "../../../projects";
import {
  GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
  WorkTrackerModuleOpenDocument,
  WorkTrackerWorkItemDocument,
} from "../../../work-items";
import type { WorkItemFact } from "./statusFacts";
import { consumeLocalWorkItemConvergence } from "../../../work-items/workItemConvergence";

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
  const taskModules = new Set<string>();
  let unknownTaskMembershipChanged = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const ids = [...pending];
    const evicted = [...removed];
    const projects = [...moduleProjects];
    const modules = [...taskModules];
    pending.clear();
    removed.clear();
    moduleProjects.clear();
    taskModules.clear();
    const refreshUnknownTaskMembership = unknownTaskMembershipChanged;
    unknownTaskMembershipChanged = false;
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
    for (const moduleId of modules) {
      void client.query({
        query: WorkTrackerModuleOpenDocument,
        variables: { moduleId: compactWorktrackerId(moduleId) },
        fetchPolicy: "network-only",
      }).catch(() => {});
    }
    if (refreshUnknownTaskMembership) {
      void client.refetchQueries({ include: [WorkTrackerModuleOpenDocument] })
        .catch(() => {});
    }
    client.cache.gc();
  };

  return {
    record(fact) {
      const convergedLocally = consumeLocalWorkItemConvergence(
        fact.workItemId,
        fact.occurredAt,
      );
      const cachedModuleId = fact.itemKind === "module"
        ? null
        : studioApolloClient().readFragment({
          fragment: GeneratedWorkTrackerWorkItemFieldsFragmentDoc,
          from: {
            __typename: "WorktrackerIssue",
            id: compactWorktrackerId(fact.workItemId),
          },
          optimistic: false,
        })?.module_id;
      if (fact.removed) {
        removed.add(fact.workItemId);
        pending.delete(fact.workItemId);
      } else if (fact.itemKind !== "module" && !convergedLocally) {
        pending.add(fact.workItemId);
      }
      if (fact.itemKind === "module" && fact.projectId) {
        moduleProjects.add(fact.projectId);
      } else if (!convergedLocally && (fact.membershipChanged || fact.removed)) {
        if (cachedModuleId) taskModules.add(cachedModuleId);
        if (fact.moduleId) taskModules.add(fact.moduleId);
        if (!cachedModuleId && !fact.moduleId) unknownTaskMembershipChanged = true;
      }
      timer ??= setTimeout(flush, windowMs);
    },
    flush,
    cancel() {
      pending.clear();
      removed.clear();
      moduleProjects.clear();
      taskModules.clear();
      unknownTaskMembershipChanged = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
