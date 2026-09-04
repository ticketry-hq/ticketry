import { useCallback, useRef, useSyncExternalStore } from "react";

import {
  readAgentStatusHolding,
  subscribeAgentStatusHolding,
} from "./apolloHolding";
import { selectTaskAutomationDelivery } from "./automationDelivery";
import {
  selectModuleLifecycleCounts,
  selectConversationLifecycleChips,
  selectRunState,
  selectScratchLifecycleChips,
  selectScratchRunIds,
  selectTaskAgentLifecycle,
  selectTaskAutomationAttempts,
  selectTaskLifecycleChips,
  selectTaskRunCount,
} from "./selectors";
import type { AgentStatusData } from "./types";

function selectionEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => selectionEqual(value, right[index]));
  }
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) return false;
  return leftEntries.every(([key, value]) =>
    Object.prototype.hasOwnProperty.call(right, key) &&
    selectionEqual(value, (right as Record<string, unknown>)[key])
  );
}

export function useAgentStatusSelection<T>(
  select: (holding: AgentStatusData) => T,
  equal: (left: T, right: T) => boolean = Object.is,
): T {
  const retained = useRef<{
    holding: AgentStatusData;
    select: (holding: AgentStatusData) => T;
    value: T;
  } | null>(null);
  const snapshot = useCallback(() => {
    const holding = readAgentStatusHolding();
    if (
      retained.current?.holding === holding &&
      retained.current.select === select
    ) {
      return retained.current.value;
    }
    const value = select(holding);
    if (retained.current && equal(retained.current.value, value)) {
      retained.current = { holding, select, value: retained.current.value };
      return retained.current.value;
    }
    retained.current = { holding, select, value };
    return value;
  }, [equal, select]);
  return useSyncExternalStore(
    subscribeAgentStatusHolding,
    snapshot,
    snapshot,
  );
}

export const useAgentStatusRuns = () =>
  useAgentStatusSelection((holding) => holding.runs);

export const useRunState = (runId: string) =>
  useAgentStatusSelection((holding) => selectRunState(holding, runId));

export const useTaskAgentLifecycle = (
  taskId: string,
  descendantTaskIds: readonly string[] = [],
) => useAgentStatusSelection(
  (holding) => selectTaskAgentLifecycle(holding, taskId, descendantTaskIds),
);

export const useTaskLifecycleChips = (
  taskId: string,
  descendantTaskIds: readonly string[] = [],
) => useAgentStatusSelection(
  (holding) => selectTaskLifecycleChips(holding, taskId, descendantTaskIds),
  selectionEqual,
);

export const useTaskRunCount = (
  taskId: string,
  descendantTaskIds: readonly string[] = [],
) => useAgentStatusSelection(
  (holding) => selectTaskRunCount(holding, taskId, descendantTaskIds),
);

export const useTaskAutomationAttempts = (
  taskId: string,
  descendantTaskIds: readonly string[] = [],
) => useAgentStatusSelection(
  (holding) => selectTaskAutomationAttempts(
    holding,
    taskId,
    descendantTaskIds,
  ),
  selectionEqual,
);

export const useTaskAutomationDelivery = (
  taskId: string,
  descendantTaskIds: readonly string[] = [],
) => useAgentStatusSelection(
  (holding) => selectTaskAutomationDelivery(
    holding,
    taskId,
    descendantTaskIds,
  ),
  selectionEqual,
);

export const useScratchLifecycleChips = (
  projectId: string,
  moduleId: string,
) => useAgentStatusSelection(
  (holding) => selectScratchLifecycleChips(holding, projectId, moduleId),
  selectionEqual,
);

export const useConversationLifecycleChips = (
  projectId: string,
  moduleId: string,
) => useAgentStatusSelection(
  (holding) => selectConversationLifecycleChips(holding, projectId, moduleId),
  selectionEqual,
);

export const useScratchRunIds = (projectId: string, moduleId: string) =>
  useAgentStatusSelection(
    (holding) => selectScratchRunIds(holding, projectId, moduleId),
    selectionEqual,
  );

export const useModuleLifecycleCounts = (moduleId: string) =>
  useAgentStatusSelection(
    (holding) => selectModuleLifecycleCounts(holding, moduleId),
    selectionEqual,
  );
