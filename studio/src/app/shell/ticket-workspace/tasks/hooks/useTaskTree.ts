import { useLayoutEffect, useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  useStudioTaskMembership,
  useTaskStates,
  useTasksStore,
} from "../../../../../features/studio/stores/tasksStore";
import { useClientStore } from "../../../../../state/clientStore";
import {
  orderedTaskSections,
  searchHits,
  taskRevealPath,
  type TreeWorkItem,
  visibleRows,
} from "../../../../../features/studio/lib/taskTree";
import { workItemQuery } from "../../../../../features/work-items/queries";
import { queryClient } from "../../../../../shared/query/queryClient";
import { stateColor } from "../../../../../shared/utilities/display";
import {
  type TreeRow,
  HEADER,
  PLACEHOLDER,
} from "../TasksPane";

const EMPTY_EXPANDED_IDS: string[] = [];

export function useTaskTree() {
  const tree = useStudioTaskMembership();
  const states = useTaskStates();
  const loadingTasks = useTasksStore((s) => s.loading.tasks);
  const selectedModuleId = useTasksStore((s) => s.selectedModuleId);
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
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

  const itemQueries = useQueries(
    { queries: tree.order.map((id) => workItemQuery(id)) },
    queryClient,
  );
  const itemsById = useMemo(() => {
    const resolved: Record<string, TreeWorkItem> = {};
    for (let index = 0; index < tree.order.length; index += 1) {
      const item = itemQueries[index]?.data;
      if (item) resolved[tree.order[index]] = item as unknown as TreeWorkItem;
    }
    return resolved;
  }, [itemQueries, tree.order]);
  const loadingRecords = itemQueries.some((query) => query.isPending);
  const expandedIds = useMemo(() => {
    const visible = new Set(rememberedExpandedIds);
    if (selectedModuleId && selectedTaskId) {
      for (const id of taskRevealPath(selectedTaskId, tree, itemsById).ancestorIds) {
        visible.add(id);
      }
    }
    return visible;
  }, [itemsById, rememberedExpandedIds, selectedModuleId, selectedTaskId, tree]);

  useLayoutEffect(() => {
    migrateCollapsedStateNames(states);
  }, [migrateCollapsedStateNames, states]);

  const derived = useMemo(() => {
    const out: TreeRow[] = [];
    const sectionIdsByState: Record<string, string[]> = {};

    if (selectedModuleId && !(loadingTasks && tree.order.length === 0)) {
      out.push({
        kind: HEADER,
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
        kind: HEADER,
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
            kind: PLACEHOLDER,
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
    sectionIdsByState: derived.sectionIdsByState,
    loadingTasks: loadingTasks || loadingRecords,
    isSearchActive,
  };
}
