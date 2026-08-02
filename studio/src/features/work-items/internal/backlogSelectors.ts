import type { Module, State, WorkItem } from "../../../shared/api/types";
import { compareStateOrder } from "../../../shared/utilities/display";

// Order two items by their fractional rank (#626), tiebroken by sequence_id —
// mirroring the server's `.order_by("rank", "sequence_id")`. A plain string
// compare (not localeCompare) matches the server's ASCII byte ordering, and is
// stable for items that share a rank, so fixtures without ranks keep their
// input order.
export function compareRank(a: WorkItem, b: WorkItem): number {
  const ra = a.rank ?? "";
  const rb = b.rank ?? "";
  if (ra < rb) return -1;
  if (ra > rb) return 1;
  return (a.sequence_id ?? 0) - (b.sequence_id ?? 0);
}

/**
 * The module (epic) that owns an item: walk `parent_id` up to the first module
 * ancestor (cycle-guarded). A chain ending at null — or at a dangling/non-module
 * parent — is "No Epic" (null). Shared by the Backlog's epic grouping and
 * planning-axis filters so every list grouping resolves ownership the same way.
 */
export function owningEpic(
  item: WorkItem,
  moduleIds: Set<string>,
  itemById: Map<string, WorkItem>,
): string | null {
  let cur: WorkItem | undefined = item;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) return null; // cycle guard
    seen.add(cur.id);
    const pid = cur.parent_id;
    if (pid === null) return null;
    if (moduleIds.has(pid)) return pid;
    cur = itemById.get(pid);
  }
  return null;
}

// --- Card hierarchy classifier (#635) ---------------------------------------
// One shared predicate used to tell a sub-task card from a top-level story.
// top-level story. A card is a sub-task ⇔ its `parent_id` resolves to another
// loaded work item — so a Module parent (absent from the item map) and a
// dangling parent (also absent) both stay top-level, mirroring the No-Epic
// promotion in groupBacklog.

export interface CardHierarchy {
  /** True when the card's parent is another loaded work item. */
  isSubtask: boolean;
  /** The immediate parent's display key, present only for sub-tasks. */
  parentKey: string | null;
}

// moduleIds is intentionally not needed: modules never appear in `itemById`, so
// the membership check alone excludes module and dangling parents.
export function cardHierarchy(
  item: WorkItem,
  itemById: Map<string, WorkItem>,
): CardHierarchy {
  const parent = item.parent_id ? itemById.get(item.parent_id) : undefined;
  return parent
    ? { isSubtask: true, parentKey: parent.key }
    : { isSubtask: false, parentKey: null };
}

/** Map every item id → its CardHierarchy. Built once per board selector. */
export function buildCardMeta(
  items: WorkItem[],
  itemById: Map<string, WorkItem>,
): Record<string, CardHierarchy> {
  const meta: Record<string, CardHierarchy> = {};
  for (const item of items) meta[item.id] = cardHierarchy(item, itemById);
  return meta;
}

// --- Story-only card predicate (#906) ---------------------------------------
// The shared type-based rule planning surfaces use to decide what becomes a
// card. Story is a *type name* at the `task` level — there is no "story"
// IssueLevel — so we key on `issue_type.name`, not on hierarchy. This replaced
// the old parent-resolves-to-a-loaded-item ("sub-task") visibility test: typed
// children remain hidden as top-level rows on every planning surface.
export function isStory(item: WorkItem): boolean {
  return item.issue_type.name === "Story";
}

// Sentinel epic-filter value selecting the trailing "No Epic" group (tasks
// with parent_id === null). Real epics are UUIDs, so this never collides.
export const NO_EPIC = "none";

export interface BacklogFilters {
  /**
   * The chip filters (#636 · C1), shared verbatim by every rendering of the
   * item set. Epic / state selection is NOT here — those are the
   * planning axes (#674/#683/#833) in `planningFilterStore`, passed to the
   * selectors as a separate `PlanningAxes` argument.
   */
  /** Free-text search over key + name, case-insensitive substring (#636). */
  query: string;
}

// The case-insensitive key|name substring test shared by the search box and the
// quick-jump palette (#636). An empty/blank query matches everything.
export function matchesQuery(item: WorkItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    item.key.toLowerCase().includes(q) || item.name.toLowerCase().includes(q)
  );
}

/**
 * Add or remove an epic id from a selection (#627). Pure so the epic rail's
 * click logic stays unit-testable; the rail calls `setFilter({ epicIds })`.
 */
export function toggleEpic(epicIds: string[], id: string): string[] {
  return epicIds.includes(id)
    ? epicIds.filter((x) => x !== id)
    : [...epicIds, id];
}

export interface TreeNode {
  item: WorkItem;
  depth: number;
  children: TreeNode[];
}

export interface EpicGroup {
  /** The owning module, or null for the trailing No-Epic group. */
  epic: Module | null;
  rows: TreeNode[];
  done: number;
  total: number;
}

// --- Pure tree builder ------------------------------------------------------
// Builds the Epic→Story→Sub-task tree from the flat item list + the project's
// modules. state filters prune non-matching rows but KEEP ancestors
// that have a matching descendant (scaffolding); the epic filter restricts to
// one group. Progress counts span each epic's *full* subtree, unfiltered.

function matches(item: WorkItem, filters: BacklogFilters): boolean {
  if (!matchesNonTypeFilters(item, filters)) return false;
  // Story-only visibility (#906): shared here so every surface applies the
  // identical rule while expanded parents can still render their children.
  if (!isStory(item)) return false;
  return true;
}

function matchesNonTypeFilters(item: WorkItem, filters: BacklogFilters): boolean {
  return matchesQuery(item, filters.query);
}

// --- Planning axes (#683/#833) ------------------------------------------------
// Every rendering of the item set narrows by the shared planning-filter
// selection (#674): Epics reduce visible rows/cards, States is surface-specific
// (column/section visibility on the board and status list, a row prune in the
// epic tree). The two axes live in `planningFilterStore`, separate from
// `BacklogFilters` (search). Each axis empty = "all"; the
// only sentinel is `NO_EPIC` (No epic). States has no sentinel — an active state
// selection hides null/unknown-state items.
export interface PlanningAxes {
  epicIds: string[];
  stateIds: string[];
}

export const EMPTY_PLANNING: PlanningAxes = { epicIds: [], stateIds: [] };

// The two shared axis predicates, factored so the tree, status list, flat
// board, and swimlanes can never diverge on what an axis means (#833).
// Search spans all epics (#636): callers relax the epic axis to [] while a
// query is active so a hit in an unselected epic still surfaces.
const passesEpicAxis =
  (epicIds: string[], moduleIds: Set<string>, itemById: Map<string, WorkItem>) =>
  (item: WorkItem): boolean => {
    if (!epicIds.length) return true;
    // null (no owning epic) matches the NO_EPIC sentinel member.
    return epicIds.includes(owningEpic(item, moduleIds, itemById) ?? NO_EPIC);
  };

// One pass over the item set: parent_id → rank-sorted children. The tree
// builders below recurse per parent, so an indexed lookup keeps them linear
// instead of re-filtering the full array at every node.
function buildChildrenIndex(items: WorkItem[]): Map<string | null, WorkItem[]> {
  const index = new Map<string | null, WorkItem[]>();
  for (const item of items) {
    const bucket = index.get(item.parent_id);
    if (bucket) bucket.push(item);
    else index.set(item.parent_id, [item]);
  }
  for (const bucket of index.values()) bucket.sort(compareRank);
  return index;
}

export function groupBacklog(
  items: WorkItem[],
  modules: Module[],
  filters: BacklogFilters,
  planning: PlanningAxes = EMPTY_PLANNING,
): EpicGroup[] {
  const moduleIds = new Set(modules.map((m) => m.id));
  const itemIds = new Set(items.map((i) => i.id));
  const childrenIndex = buildChildrenIndex(items);
  // Search spans all epics (#636): a query is a find-across-everything, so the
  // planning epic selection is relaxed while searching — otherwise a hit in an
  // unselected epic would stay hidden. The other filters still apply per row.
  const epicIds = filters.query.trim() ? [] : planning.epicIds;
  // In the epic tree, State has no section/column of its own, so the state
  // axis applies as a row-level prune (ancestors of a match are kept).
  const passesState = (item: WorkItem): boolean =>
    !planning.stateIds.length ||
    planning.stateIds.includes(item.state?.id ?? "");
  const rowMatches = (item: WorkItem): boolean =>
    matches(item, filters) && passesState(item);
  // Story-only visibility (#906) is applied by `matches()` inside `rowMatches`:
  // non-Story descendants fail the match and `prune` drops them, so the tree
  // stops at Story rows. The tree is always built in full — prune
  // decides what renders.
  // Siblings are ordered by the shared rank (#626) so a within-parent reorder
  // shows in the tree — the flat items array isn't re-sequenced on an
  // optimistic move, only the moved item's rank changes.
  const childrenOf = (parentId: string | null) =>
    childrenIndex.get(parentId) ?? [];

  // Build a full node from an item and its descendants.
  const buildNode = (item: WorkItem, depth: number): TreeNode => ({
    item,
    depth,
    children: childrenOf(item.id).map((c) => buildNode(c, depth + 1)),
  });

  // Prune to nodes that match, or have a matching descendant.
  const prune = (node: TreeNode): TreeNode | null => {
    const keptChildren = node.children
      .map(prune)
      .filter((n): n is TreeNode => n !== null);
    if (rowMatches(node.item) || keptChildren.length) {
      return { ...node, children: keptChildren };
    }
    return null;
  };

  const countSubtree = (roots: WorkItem[]): { done: number; total: number } => {
    let done = 0;
    let total = 0;
    const walk = (item: WorkItem) => {
      total += 1;
      if (item.state?.group === "completed") done += 1;
      childrenOf(item.id).forEach(walk);
    };
    roots.forEach(walk);
    return { done, total };
  };

  const groups: EpicGroup[] = [];
  // Any row-level filter (not epic, which selects groups) hides empty epics.
  const rowFilterActive = Boolean(
    planning.stateIds.length ||
      filters.query.trim(),
  );

  for (const m of modules) {
    if (epicIds.length && !epicIds.includes(m.id)) continue;
    const roots = childrenOf(m.id);
    const rows = roots
      .map((r) => prune(buildNode(r, 0)))
      .filter((n): n is TreeNode => n !== null);
    // Hide an epic that has no matching rows only when a row filter is active;
    // an unfiltered backlog still shows empty epics as headers.
    if (!rows.length && rowFilterActive) continue;
    const { done, total } = countSubtree(roots);
    groups.push({ epic: m, rows, done, total });
  }

  // No-Epic group: parent_id === null, plus defensive promotion of items whose
  // parent reference dangles (not a module, not a present item).
  if (!epicIds.length || epicIds.includes(NO_EPIC)) {
    const orphanRoots = items
      .filter(
        (i) =>
          i.parent_id === null ||
          (!moduleIds.has(i.parent_id) && !itemIds.has(i.parent_id)),
      )
      .sort(compareRank);
    const rows = orphanRoots
      .map((r) => prune(buildNode(r, 0)))
      .filter((n): n is TreeNode => n !== null);
    if (rows.length || (!rowFilterActive && orphanRoots.length)) {
      const { done, total } = countSubtree(orphanRoots);
      groups.push({ epic: null, rows, done, total });
    }
  }

  return groups;
}

// --- Pure status-grouped list selector (#828) --------------------------------
// A vertical re-grouping of the same list surface: one section per workflow
// state (frozen group order, cancelled suppressed per #633). Only top-level
// stories (no loaded work-item parent) become flat section rows — sub-tasks
// render exclusively nested under their parent's expanded subtree, never as
// their own flat row. A row's chevron reveals its full child subtree
// unfiltered.

export interface StateGroup {
  /** The section's workflow state, or null for the leading "No State" section. */
  state: State | null;
  /** Flat top-level rows (depth 0), each carrying its full child subtree. */
  rows: TreeNode[];
  /** Distinct items in this section, stable across expand/collapse dedup. */
  total: number;
  /** Per-item hierarchy annotation shared with the board (#635). */
  cardMeta: Record<string, CardHierarchy>;
}

export function groupBacklogByState(
  items: WorkItem[],
  states: State[],
  modules: Module[],
  filters: BacklogFilters,
  planning: PlanningAxes = EMPTY_PLANNING,
): StateGroup[] {
  const moduleIds = new Set(modules.map((m) => m.id));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const cardMeta = buildCardMeta(items, itemById);

  // Search spans all epics (#636), matching the epic-grouped list.
  const epicIds = filters.query.trim() ? [] : planning.epicIds;
  const passesEpic = passesEpicAxis(epicIds, moduleIds, itemById);

  // Sub-tasks (parent resolves to a loaded work item) never get their own flat
  // section row — they appear only nested under their parent's subtree.
  const visible = items.filter(
    (i) =>
      passesEpic(i) &&
      matchesNonTypeFilters(i, filters) &&
      isStory(i) &&
      !cardMeta[i.id].isSubtask,
  );

  const childrenIndex = buildChildrenIndex(items);
  const childrenOf = (parentId: string) => childrenIndex.get(parentId) ?? [];
  const buildNode = (item: WorkItem, depth: number): TreeNode => ({
    item,
    depth,
    children: childrenOf(item.id).map((c) => buildNode(c, depth + 1)),
  });
  const toRows = (members: WorkItem[]): TreeNode[] =>
    [...members].sort(compareRank).map((i) => buildNode(i, 0));

  // State axis = section visibility (#683/#833), mirroring the board columns.
  const stateActive = planning.stateIds.length > 0;
  const stateSet = new Set(planning.stateIds);
  const knownStateIds = new Set(
    states.map((s) => s.id).filter((id): id is string => id !== null),
  );

  const groups: StateGroup[] = [];
  // Leading "No State" section: shown only when non-empty and no state
  // selection is active — the board's No State lane rules.
  const orphaned = visible.filter((i) => !i.state?.id || !knownStateIds.has(i.state.id));
  if (orphaned.length && !stateActive) {
    const rows = toRows(orphaned);
    groups.push({ state: null, rows, total: rows.length, cardMeta });
  }

  const ordered = [...states].sort((a, b) => compareStateOrder(a, b));
  for (const st of ordered) {
    // Cancel = archive (#633): the section is suppressed like the board column.
    if (st.group === "cancelled") continue;
    // An active state selection shows only the chosen sections; without
    // one, every section renders — empty ones included, with a zero count.
    if (stateActive && !(st.id != null && stateSet.has(st.id))) continue;
    const rows = toRows(
      visible.filter((i) => i.state?.id != null && i.state.id === st.id),
    );
    groups.push({ state: st, rows, total: rows.length, cardMeta });
  }
  return groups;
}
