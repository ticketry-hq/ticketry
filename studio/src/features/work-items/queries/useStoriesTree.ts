import { useLayoutEffect, useMemo } from "react";
import { useClientStore } from "../../../state/clientStore";
import { useStudioStore } from "../../projects";
import {
  descendantIdsByWorkItem,
  type PlanningTreeRow,
  LOADING_PLACEHOLDER,
  orderedTaskSections,
  searchHits,
  STATE_HEADER,
  taskRevealPath,
  type TreeWorkItem,
  visibleRows,
} from "../selectors";
import { useCachedStates } from "../../../features/projects";
import { stateColor } from "../../../shared/utilities/display";
import { useModuleOpen } from ".";

const EMPTY_EXPANDED_IDS: string[] = [];

export function useStoriesTree() {
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const selectedTaskId = useClientStore((s) => s.selectedTaskId);
  const { tree, items } = useModuleOpen(selectedModuleId);
  const states = useCachedStates(selectedProjectId);
  const loadingTasks = false;
  const rememberedExpandedIds = useClientStore((s) =>
    selectedModuleId
      ? s.expandedIdsByModule[selectedModuleId] ?? EMPTY_EXPANDED_IDS
      : EMPTY_EXPANDED_IDS,
  );
  const collapsedStateIds = useClientStore((s) => s.collapsedStateIds);
  const migrateCollapsedStateNames = useClientStore(
    (s) => s.migrateCollapsedStateNames,
  );
  const storySearchQuery = useClientStore((s) => s.storySearchQuery);
  const normalizedQuery = storySearchQuery.trim().toLowerCase();
  const isSearchActive = normalizedQuery.length > 0;

  const itemsById = useMemo(() => {
    const resolved: Record<string, TreeWorkItem> = {};
    for (const item of items) {
      resolved[item.id] = item as unknown as TreeWorkItem;
    }
    return resolved;
  }, [items]);
  const loadingRecords = items.length < tree.order.length;
  const descendantIdsById = useMemo(
    () => descendantIdsByWorkItem(tree),
    [tree],
  );
  const expandedIds = useMemo(() => {
    const visible = new Set(rememberedExpandedIds);
    if (selectedModuleId && selectedTaskId) {
      for (const id of taskRevealPath(selectedTaskId, tree, itemsById, states).ancestorIds) {
        visible.add(id);
      }
    }
    return visible;
  }, [itemsById, rememberedExpandedIds, selectedModuleId, selectedTaskId, states, tree]);

  useLayoutEffect(() => {
    migrateCollapsedStateNames(states);
  }, [migrateCollapsedStateNames, states]);

  const derived = useMemo(() => {
    const out: PlanningTreeRow[] = [];
    const sectionIdsByState: Record<string, string[]> = {};

    if (selectedModuleId && !(loadingTasks && tree.order.length === 0)) {
      out.push({
        kind: STATE_HEADER,
        key: "header-scratch",
        stateId: null,
        stateName: "Scratch",
        stateColor: "",
        count: 1,
      });
      out.push({ kind: "scratch", moduleId: selectedModuleId });
    }

    const hits = isSearchActive
      ? searchHits(tree, itemsById, normalizedQuery)
      : null;
    for (const section of orderedTaskSections(
      tree.rootIds,
      itemsById,
      states,
      tree.order,
    )) {
      if (section.state.id) sectionIdsByState[section.state.id] = section.ids;
      const visibleRootIds = hits
        ? section.ids.filter((id) => hits.has(id))
        : section.ids;
      if (isSearchActive && visibleRootIds.length === 0) continue;

      out.push({
        kind: STATE_HEADER,
        key: `header-${section.state.id ?? section.state.name}`,
        stateId: section.state.id,
        stateName: section.state.name,
        stateColor: stateColor(section.state),
        count: section.ids.length,
      });
      if (
        !isSearchActive &&
        section.state.id &&
        collapsedStateIds.has(section.state.id)
      ) {
        continue;
      }

      for (const row of visibleRows(
        tree,
        visibleRootIds,
        itemsById,
        expandedIds,
        hits,
      )) {
        out.push(row);
        if (row.expanded && tree.children[row.id] === undefined) {
          out.push({
            kind: LOADING_PLACEHOLDER,
            key: `${row.id}-loading`,
            depth: row.depth + 1,
          });
        }
      }
    }
    return { rows: out, sectionIdsByState };
  }, [
    tree,
    states,
    itemsById,
    expandedIds,
    loadingTasks,
    selectedModuleId,
    collapsedStateIds,
    normalizedQuery,
    isSearchActive,
  ]);

  return {
    rows: derived.rows,
    tree,
    descendantIdsById,
    sectionIdsByState: derived.sectionIdsByState,
    loadingTasks: loadingTasks || loadingRecords,
    isSearchActive,
  };
}
