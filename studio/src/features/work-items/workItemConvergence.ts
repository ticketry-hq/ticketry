import { compactWorktrackerId } from "../../shared/api/generatedWorktracker";

const LOCAL_CONVERGENCE_TTL_MS = 30_000;
const locallyConverged = new Map<string, ReturnType<typeof setTimeout>>();

function key(workItemId: string, occurredAt: string): string {
  // Seaography returns a naive UTC timestamp; status facts use RFC3339.
  // Parse whole seconds only so distinct sub-millisecond writes stay distinct.
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/.exec(occurredAt);
  const seconds = match ? Date.parse(`${match[1]}T${match[2]}${match[4] ?? "Z"}`) : NaN;
  const timestamp = Number.isFinite(seconds)
    ? `${seconds}:${(match![3] ?? "").replace(/0+$/, "")}`
    : occurredAt;
  return `${compactWorktrackerId(workItemId)}\0${timestamp}`;
}

/** Remember the exact server version already adopted by a completed mutation. */
export function recordLocalWorkItemConvergence(
  workItemId: string,
  occurredAt: string,
): void {
  const identity = key(workItemId, occurredAt);
  const previous = locallyConverged.get(identity);
  if (previous) clearTimeout(previous);
  locallyConverged.set(identity, setTimeout(() => {
    locallyConverged.delete(identity);
  }, LOCAL_CONVERGENCE_TTL_MS));
}

/** Consume only the matching durable fact. Newer external writes still converge. */
export function consumeLocalWorkItemConvergence(
  workItemId: string,
  occurredAt: string | null,
): boolean {
  if (!occurredAt) return false;
  const identity = key(workItemId, occurredAt);
  const timer = locallyConverged.get(identity);
  if (!timer) return false;
  clearTimeout(timer);
  locallyConverged.delete(identity);
  return true;
}

