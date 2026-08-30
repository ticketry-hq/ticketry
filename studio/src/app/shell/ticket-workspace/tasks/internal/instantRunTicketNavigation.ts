import { useCallback, useSyncExternalStore } from "react";
import { useTerminalStore } from "../../../../../features/agents/terminal/appNavigation";
import { scratchBucketId } from "../../../../../features/agents/terminal";
import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import {
  type ClientState,
  useClientStore,
} from "../../../../../state/clientStore";

const INSTANT_ROW_PREFIX = "__instant_run__:";

export function instantRunPlanningRowId(runId: string): string {
  return `${INSTANT_ROW_PREFIX}${runId}`;
}

export function selectPlanningRowId(rowId: string): void {
  const ui = useClientStore.getState();
  const moduleId = ui.selectedModuleId;
  const runId = rowId.startsWith(INSTANT_ROW_PREFIX)
    ? rowId.slice(INSTANT_ROW_PREFIX.length)
    : null;

  if (!runId) {
    ui.selectTask(rowId);
    if (rowId === TEMP_TASK_ID && moduleId) {
      ui.setActive(scratchBucketId(moduleId), "details");
    }
    return;
  }

  if (!moduleId) return;
  ui.selectTask(TEMP_TASK_ID);
  const terminal = useTerminalStore.getState();
  let sessionId = terminal.sessionByRun[runId] ?? null;
  if (!sessionId) {
    try {
      sessionId = terminal.attachRun(runId);
    } catch {
      ui.setActive(scratchBucketId(moduleId), "details");
      return;
    }
  }
  const bucket = scratchBucketId(moduleId);
  ui.tabSelected(bucket, sessionId);
  ui.setActive(bucket, "terminal");
  terminal.focusSession(sessionId);
}

/** The visible row represented by the selected scratch workspace surface. */
export function currentPlanningRowId(): string | null {
  return planningRowIdFromState(
    useClientStore.getState(),
    useTerminalStore.getState(),
  );
}

type TerminalState = ReturnType<typeof useTerminalStore.getState>;

function planningRowIdFromState(
  ui: ClientState,
  terminal: TerminalState,
): string | null {
  const selectedTaskId = ui.selectedTaskId;
  const moduleId = ui.selectedModuleId;
  if (selectedTaskId !== TEMP_TASK_ID || !moduleId) return selectedTaskId;

  const bucket = scratchBucketId(moduleId);
  if (ui.workspaces[bucket]?.active !== "terminal") return TEMP_TASK_ID;
  const sessionId = ui.activeByTask[bucket];
  const session = sessionId ? terminal.sessions[sessionId] : null;
  return session?.isInstant && session.agentRunId
    ? instantRunPlanningRowId(session.agentRunId)
    : TEMP_TASK_ID;
}

type SelectionListener = () => void;

const selectionListeners = new Map<string, Set<SelectionListener>>();

function notifySelectionChange(previousId: string | null, id: string | null) {
  if (previousId === id) return;
  if (previousId) {
    selectionListeners.get(previousId)?.forEach((listener) => listener());
  }
  if (id) selectionListeners.get(id)?.forEach((listener) => listener());
}

useClientStore.subscribe((state, previousState) => {
  const terminal = useTerminalStore.getState();
  notifySelectionChange(
    planningRowIdFromState(previousState, terminal),
    planningRowIdFromState(state, terminal),
  );
});

useTerminalStore.subscribe((state, previousState) => {
  const ui = useClientStore.getState();
  notifySelectionChange(
    planningRowIdFromState(ui, previousState),
    planningRowIdFromState(ui, state),
  );
});

export function usePlanningRowSelected(rowId: string): boolean {
  const subscribe = useCallback((listener: SelectionListener) => {
    const listeners = selectionListeners.get(rowId) ?? new Set();
    listeners.add(listener);
    selectionListeners.set(rowId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) selectionListeners.delete(rowId);
    };
  }, [rowId]);
  const getSnapshot = useCallback(
    () => currentPlanningRowId() === rowId,
    [rowId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useSelectedPlanningRowId(): string | null {
  const selectedTaskId = useClientStore((state) => state.selectedTaskId);
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const bucket = moduleId ? scratchBucketId(moduleId) : null;
  const activeKind = useClientStore((state) =>
    bucket ? state.workspaces[bucket]?.active ?? "details" : "details"
  );
  const activeSessionId = useClientStore((state) =>
    bucket ? state.activeByTask[bucket] ?? null : null
  );
  const activeInstantRunId = useTerminalStore((state) => {
    const session = activeSessionId
      ? state.sessions[activeSessionId]
      : null;
    return session?.isInstant ? session.agentRunId ?? null : null;
  });

  if (
    selectedTaskId === TEMP_TASK_ID &&
    activeKind === "terminal" &&
    activeInstantRunId
  ) {
    return instantRunPlanningRowId(activeInstantRunId);
  }
  return selectedTaskId;
}

/** The Instant run represented by the selected Conversations row, if any. */
export function useSelectedInstantRunId(): string | null {
  const selectedTaskId = useClientStore((state) => state.selectedTaskId);
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const bucket = moduleId ? scratchBucketId(moduleId) : null;
  const activeKind = useClientStore((state) =>
    bucket ? state.workspaces[bucket]?.active ?? "details" : "details"
  );
  const activeSessionId = useClientStore((state) =>
    bucket ? state.activeByTask[bucket] ?? null : null
  );
  return useTerminalStore((state) => {
    if (
      selectedTaskId !== TEMP_TASK_ID ||
      activeKind !== "terminal" ||
      !activeSessionId
    ) {
      return null;
    }
    const session = state.sessions[activeSessionId];
    return session?.isInstant ? session.agentRunId ?? null : null;
  });
}
