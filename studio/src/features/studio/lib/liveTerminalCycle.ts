import {
  isLiveAgentRunState,
  type AgentStatusData,
} from "../../agents/status";
import type { SessionMeta } from "../../agents/terminal";
import type { TaskId } from "./types";
import type { TreeRow } from "../../../app/shell/ticket-workspace/tasks/TasksPane";
import {
  isPlanningRow,
  planningRowId,
} from "../../../app/shell/ticket-workspace/tasks/TasksPane";

type CycleSession = Pick<
  SessionMeta,
  "sessionId" | "agentRunId" | "taskId" | "moduleId" | "isDocChat"
>;

export interface LiveTerminalStop {
  taskId: string;
  sessionId: string;
  agentRunId: string;
}

export type LiveTerminalCycleDirection = "forward" | "backward";

interface LiveTerminalStopInput {
  moduleId: string | null;
  taskRows: readonly TreeRow[];
  taskOrder?: readonly TaskId[];
  agentStatus: AgentStatusData;
  sessions: Readonly<Record<string, CycleSession>>;
  tabsByTask: Readonly<Record<string, readonly string[]>>;
}

export function selectLiveTerminalStops({
  moduleId,
  taskRows,
  taskOrder,
  agentStatus,
  sessions,
  tabsByTask,
}: LiveTerminalStopInput): LiveTerminalStop[] {
  if (!moduleId) return [];

  const stops: LiveTerminalStop[] = [];
  const taskIds =
    taskOrder ??
    taskRows.flatMap((row) =>
      isPlanningRow(row) ? [planningRowId(row)] : [],
    );
  for (const taskId of taskIds) {
    for (const sessionId of tabsByTask[taskId] ?? []) {
      const session = sessions[sessionId];
      if (
        !session ||
        session.isDocChat ||
        !session.agentRunId ||
        session.taskId !== taskId ||
        session.moduleId !== moduleId
      ) {
        continue;
      }

      const run = agentStatus.runs[session.agentRunId];
      if (
        !run ||
        run.taskId !== taskId ||
        run.moduleId !== moduleId ||
        !isLiveAgentRunState(run.state)
      ) {
        continue;
      }

      stops.push({ taskId, sessionId, agentRunId: session.agentRunId });
    }
  }
  return stops;
}

export function selectLiveTerminalStop(
  stops: readonly LiveTerminalStop[],
  currentSessionId: string | null,
  direction: LiveTerminalCycleDirection,
): LiveTerminalStop | null {
  if (stops.length === 0) return null;
  const currentIndex = currentSessionId
    ? stops.findIndex((stop) => stop.sessionId === currentSessionId)
    : -1;
  if (currentIndex < 0) return stops[0];
  const offset = direction === "forward" ? 1 : -1;
  return stops[(currentIndex + offset + stops.length) % stops.length];
}
