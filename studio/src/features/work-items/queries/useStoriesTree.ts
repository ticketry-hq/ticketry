import { useLayoutEffect, useMemo } from "react";
import type { WorkItem } from "../../../shared/api/types";
import { useClientStore } from "../../../state/clientStore";
import { useStudioStore } from "../../projects";
import {
  type PlanningTreeRow,
  CONVERSATIONS_SECTION_ID,
  LOADING_PLACEHOLDER,
  orderedTaskSections,
  STATE_HEADER,
  visibleRows,
} from "../selectors";
import { useCachedStates } from "../../../features/projects";
import { stateColor } from "../../../shared/utilities/display";
import { useModuleOpen } from ".";
import { useInstantRunTickets } from "../../agents/terminal";
import { recordSelectionProfilePoint } from "../../../shared/utilities/selectionProfile";
import { useStorySprintFilter } from "../filter/StorySprintFilterController";
import { selectStorySprintResults } from "../selectors/storySprintFilter";

import { moduleLoadPoint, moduleLoadProbeActive } from "../../../shared/utilities/moduleLoadProbe";

const EMPTY_EXPANDED_IDS: string[] = [];

export function useDerivedStoriesTree() {
  recordSelectionProfilePoint("stories-tree-render");
  const selectedProjectId = useStudioStore((s) => s.selectedProjectId);
  const selectedModuleId = useClientStore((s) => s.selectedModuleId);
  const selectedTaskId = useClientStore((s) => s.selectedTaskId);
  const sprintFilter = useStorySprintFilter(selectedProjectId);
  const { tree, items, loading: queryLoading } = useModuleOpen(selectedModuleId);
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
    const resolved: Record<string, WorkItem> = {};
    for (const item of items) {
      resolved[item.id] = item;
    }
    return resolved;
  }, [items]);
  const loadingRecords = items.length < tree.order.length;
  const expandedIds = useMemo(() => {
    recordSelectionProfilePoint("expanded-ids-build");
    return new Set(rememberedExpandedIds);
  }, [rememberedExpandedIds]);
  // A failed initial lookup may show ordinary cached rows, without resolving
  // unknown Active intent to All or claiming an authoritative result summary.
  const results = useMemo(() => selectStorySprintResults(
    tree, itemsById, sprintFilter.selection ?? (sprintFilter.status === "error" ? { mode: "all" } : null), normalizedQuery,
  ), [tree, itemsById, sprintFilter.selection, sprintFilter.status, normalizedQuery]);
  const isSprintRestricted = sprintFilter.restricted;
  const isResultFilterActive = isSprintRestricted || isSearchActive;

  useLayoutEffect(() => {
    migrateCollapsedStateNames(states);
  }, [migrateCollapsedStateNames, states]);

  const derived = useMemo(() => {
    const started = performance.now();
    recordSelectionProfilePoint("visible-rows-build");
    const out: PlanningTreeRow[] = [];
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
      if (!collapsedStateIds.has(CONVERSATIONS_SECTION_ID)) {
        out.push({ kind: "scratch", moduleId: selectedModuleId });
        out.push(...instantRunTickets.map((ticket) => ({
          kind: "instant-run" as const,
          runId: ticket.agentRunId,
          moduleId: selectedModuleId,
          name: ticket.title,
          startedAt: ticket.startedAt,
        })));
      }
    }

    const hits = results.hits;
    for (const section of orderedTaskSections(
      results.eligibleRootIds,
      itemsById,
      states,
      tree.order,
    )) {
      if (section.state.id) sectionIdsByState[section.state.id] = section.ids;
      const visibleRootIds = hits
        ? section.ids.filter((id) => hits.has(id))
        : section.ids;
      if ((!sprintFilter.selection || isResultFilterActive) && visibleRootIds.length === 0) continue;

      out.push({
        kind: STATE_HEADER,
        key: `header-${section.state.id ?? section.state.name}`,
        stateId: section.state.id,
        stateName: section.state.name,
        stateColor: stateColor(section.state),
        count: visibleRootIds.length,
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
    moduleLoadPoint(selectedModuleId)("rows-derived", { row_count: out.length, derive_ms: performance.now() - started });
    return { rows: out, sectionIdsByState };
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
    results,
    isResultFilterActive,
    sprintFilter.selection,
  ]);

  useLayoutEffect(() => {
    if (!moduleLoadProbeActive(selectedModuleId)) return;
    const probe = moduleLoadPoint(selectedModuleId);
    const details = { task_count: items.length, row_count: derived.rows.length, refreshing: queryLoading };
    probe("tasks-committed", details);
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => probe("tasks-paint-opportunity", details));
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, [selectedModuleId, items, derived.rows, queryLoading]);

  return {
    rows: derived.rows,
    items,
    loading: queryLoading,
    tree,
    itemsById,
    sectionIdsByState: derived.sectionIdsByState,
    loadingTasks: loadingTasks || loadingRecords || (queryLoading && tree.order.length === 0),
    isSearchActive,
    sprintFilter,
    isSprintRestricted,
    isResultFilterActive,
    matchingRootIds: results.matchingRootIds,
    matchingRootCount: results.matchingRootIds.length,
    totalRootCount: tree.rootIds.length,
    resultIds: results.resultIds,
    selectedStoryOutsideFilter: !!selectedTaskId && !!itemsById[selectedTaskId] &&
      sprintFilter.selection !== null && !loadingRecords && isResultFilterActive &&
      !results.resultIds.has(selectedTaskId),
  };
}
