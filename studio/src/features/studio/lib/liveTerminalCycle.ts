import {
  isAgentlessRun,
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
  "sessionId" | "agentRunId" | "taskId" | "moduleId"
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
  terminalOrderByTask?: Readonly<Record<string, readonly string[]>>;
  /** @deprecated Tabs are derived from runs and the live-session registry. */
  tabsByTask?: Readonly<Record<string, readonly string[]>>;
}

export function selectLiveTerminalStops({
  moduleId,
  taskRows,
  taskOrder,
  agentStatus,
  sessions,
  terminalOrderByTask = {},
}: LiveTerminalStopInput): LiveTerminalStop[] {
  if (!moduleId) return [];

  const stops: LiveTerminalStop[] = [];
  const taskIds =
    taskOrder ??
    taskRows.flatMap((row) =>
      isPlanningRow(row) ? [planningRowId(row)] : [],
    );
  for (const taskId of taskIds) {
    const defaultTaskSessions = Object.values(sessions)
      .filter((session) => session.taskId === taskId)
      .sort((left, right) => {
        const leftAt = left.agentRunId
          ? agentStatus.runs[left.agentRunId]?.started_at ?? ""
          : "";
        const rightAt = right.agentRunId
          ? agentStatus.runs[right.agentRunId]?.started_at ?? ""
          : "";
        return leftAt.localeCompare(rightAt) ||
          left.sessionId.localeCompare(right.sessionId);
      });
    const savedPosition = new Map(
      (terminalOrderByTask[taskId] ?? []).map((runId, index) => [runId, index]),
    );
    const taskSessions = defaultTaskSessions
      .map((session, defaultIndex) => ({ session, defaultIndex }))
      .sort((left, right) => {
        const leftPosition = left.session.agentRunId
          ? savedPosition.get(left.session.agentRunId)
          : undefined;
        const rightPosition = right.session.agentRunId
          ? savedPosition.get(right.session.agentRunId)
          : undefined;
        if (leftPosition !== undefined && rightPosition !== undefined) {
          return leftPosition - rightPosition;
        }
        if (leftPosition !== undefined) return -1;
        if (rightPosition !== undefined) return 1;
        return left.defaultIndex - right.defaultIndex;
      })
      .map(({ session }) => session);
    for (const session of taskSessions) {
      const sessionId = session.sessionId;
      if (
        !session.agentRunId ||
        session.taskId !== taskId ||
        session.moduleId !== moduleId
      ) {
        continue;
      }

      const run = agentStatus.runs[session.agentRunId];
      if (
        !run ||
        // This cycle walks the agent terminals of the work-item tree. A shell
        // run belongs to the terminal panel and is never a stop in it, stated
        // here rather than left to the task filter below to imply (#670).
        isAgentlessRun(run) ||
        run.task_id !== taskId ||
        run.module_id !== moduleId ||
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
