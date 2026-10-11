import type { StorySprintIntent } from "../internal/storySprintFilterStore";
import type { ModuleTree } from "../../../shared/api/types";
import { searchHits, type TreeWorkItem } from "./taskTree";
import { publicWorktrackerId } from "../../../shared/api/generatedWorktracker";

export type StorySprintSelection =
  | { mode: "all" }
  | { mode: "none" }
  | { mode: "id"; sprintId: string };

interface SprintRead {
  sprint: { id: string } | null;
  ready: boolean;
  loading: boolean;
  error?: Error;
}

export interface StorySprintResolution {
  selection: StorySprintSelection | null;
  restricted: boolean;
  status: "ready" | "loading" | "error";
  requiresAllFallback: boolean;
  notice?: string;
}

/** Resolve semantic intent against authoritative reads, preserving cached identities. */
export function resolveStorySprintFilter(
  intent: StorySprintIntent,
  activeRead: SprintRead,
  explicitRead?: SprintRead,
): StorySprintResolution {
  if (intent.mode === "all" || intent.mode === "none") {
    return { selection: intent, restricted: intent.mode === "none", status: "ready", requiresAllFallback: false };
  }
  const read = intent.mode === "active" ? activeRead : explicitRead;
  const status = read?.error ? "error" : read?.ready ? "ready" : "loading";
  const selection: StorySprintSelection | null = read?.sprint
    ? { mode: "id", sprintId: read.sprint.id }
    : read?.ready && !read.error
      ? { mode: "all" }
      : intent.mode === "id"
        ? { mode: "id", sprintId: intent.sprintId }
        : null;
  const requiresAllFallback = intent.mode === "id" && !!read?.ready && !read.error && !read.sprint;
  return {
    selection, restricted: selection?.mode !== "all", status, requiresAllFallback,
    ...(requiresAllFallback ? { notice: "The selected sprint is no longer available. Showing all sprints." } : {}),
  };
}

type SprintTreeItem = TreeWorkItem & { readonly sprint_id: string | null };

export function filterStoryRoots(
  rootIds: readonly string[],
  itemsById: Readonly<Record<string, SprintTreeItem>>,
  selection: StorySprintSelection | null,
): string[] {
  if (!selection) return [];
  if (selection.mode === "all") return [...rootIds];
  return rootIds.filter((id) => {
    const item = itemsById[id];
    return !!item && (selection.mode === "none"
      ? item.sprint_id === null
      : item.sprint_id !== null && publicWorktrackerId(item.sprint_id) === publicWorktrackerId(selection.sprintId));
  });
}

/** Membership excludes whole branches before existing Story search can propagate hits. */
export function selectStorySprintResults(
  tree: ModuleTree,
  itemsById: Readonly<Record<string, SprintTreeItem>>,
  selection: StorySprintSelection | null,
  query: string,
) {
  const eligibleRootIds = filterStoryRoots(tree.rootIds, itemsById, selection);
  const eligibleIds = new Set<string>();
  const appendBranch = (id: string): void => {
    if (eligibleIds.has(id) || !itemsById[id]) return;
    eligibleIds.add(id);
    for (const childId of tree.children[id] ?? []) appendBranch(childId);
  };
  eligibleRootIds.forEach(appendBranch);
  const isSearchActive = query.trim().length > 0;
  const hits = isSearchActive ? searchHits({
    ...tree,
    rootIds: eligibleRootIds,
    order: tree.order.filter((id) => eligibleIds.has(id)),
  }, itemsById, query) : null;
  const resultIds = hits ?? eligibleIds;
  const matchingRootIds = eligibleRootIds.filter((id) => resultIds.has(id));
  return { eligibleRootIds, matchingRootIds, resultIds, hits };
}

interface SprintRootMembership {
  id: string;
  parent_id: string | null;
  module_id: string | null;
  sprint_id: string | null;
}

/** Server reads already scope archive/project ownership; reject descendants/orphans. */
export function projectRootSprintCounts(roots: readonly SprintRootMembership[]) {
  let all = 0;
  let none = 0;
  const bySprint = new Map<string, number>();
  const counted = new Set<string>();
  for (const root of roots) {
    if (!root.module_id || root.parent_id !== root.module_id || counted.has(root.id)) continue;
    counted.add(root.id);
    all += 1;
    if (root.sprint_id === null) none += 1;
    else bySprint.set(root.sprint_id, (bySprint.get(root.sprint_id) ?? 0) + 1);
  }
  return { all, none, bySprint };
}
