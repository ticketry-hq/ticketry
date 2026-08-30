import { useLayoutEffect, useMemo } from "react";
import { useClientStore } from "../../../state/clientStore";
import { useStudioStore } from "../../projects";
import {
  descendantIdsByRowId,
  type PlanningTreeRow,
  LOADING_PLACEHOLDER,
  orderedTaskSections,
  searchHits,
  STATE_HEADER,
  type TreeWorkItem,
  type WorkItemRow,
  visibleRows,
} from "../selectors";
import { useCachedStates } from "../../../features/projects";
import { stateColor } from "../../../shared/utilities/display";
import { useModuleOpen } from ".";
import { useInstantRunTickets } from "../../agents/terminal/instantRunTickets";

const EMPTY_EXPANDED_IDS: string[] = [];

const recordSelectionProfilePoint = (point: string) => {
  (globalThis as typeof globalThis & {
    __ticketrySelectionProfileProbe?: (point: string) => void;
  }).__ticketrySelectionProfileProbe?.(point);
};

export function useStoriesTree() {
  recordSelectionProfilePoint("stories-tree-render");
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const { tree, items } = useModuleOpen(selectedModuleId);
  const states = useCachedStates(selectedProjectId);
  const instantRunTickets = useInstantRunTickets(
    selectedProjectId,
    selectedModuleId,
  );
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
    recordSelectionProfilePoint("items-by-id-build");
    const resolved: Record<string, TreeWorkItem> = {};
    for (const item of items) {
      resolved[item.id] = item as unknown as TreeWorkItem;
    }
    return resolved;
  }, [items]);
  const loadingRecords = items.length < tree.order.length;
  const expandedIds = useMemo(() => {
    recordSelectionProfilePoint("expanded-ids-build");
    return new Set(rememberedExpandedIds);
  }, [rememberedExpandedIds]);

  useLayoutEffect(() => {
    migrateCollapsedStateNames(states);
  }, [migrateCollapsedStateNames, states]);

  const derived = useMemo(() => {
    recordSelectionProfilePoint("visible-rows-build");
    const out: PlanningTreeRow[] = [];
    const workItemRows: WorkItemRow[] = [];
    const sectionIdsByState: Record<string, string[]> = {};

    if (selectedModuleId && !(loadingTasks && tree.order.length === 0)) {
      out.push({
        kind: STATE_HEADER,
        key: "header-conversations",
        stateId: null,
        stateName: "Conversations",
        stateColor: "",
        count: instantRunTickets.length,
      });
      out.push({ kind: "scratch", moduleId: selectedModuleId });
      out.push(...instantRunTickets.map((ticket) => ({
        kind: "instant-run" as const,
        runId: ticket.agentRunId,
        moduleId: selectedModuleId,
        name: ticket.title,
        startedAt: ticket.startedAt,
      })));
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

      const sectionRows = visibleRows(
        tree,
        visibleRootIds,
        itemsById,
        expandedIds,
        hits,
      );
      workItemRows.push(...sectionRows);
      for (const row of sectionRows) {
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
    return {
      rows: out,
      sectionIdsByState,
      descendantIdsByRowId: descendantIdsByRowId(tree, workItemRows),
    };
  }, [
    tree,
    states,
    itemsById,
    expandedIds,
    loadingTasks,
    selectedModuleId,
    instantRunTickets,
    collapsedStateIds,
    normalizedQuery,
    isSearchActive,
  ]);

  return {
    rows: derived.rows,
    tree,
    descendantIdsByRowId: derived.descendantIdsByRowId,
    sectionIdsByState: derived.sectionIdsByState,
    loadingTasks: loadingTasks || loadingRecords,
    isSearchActive,
  };
}
