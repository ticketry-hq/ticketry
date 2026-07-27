import {
  selectTaskAgentLifecycle,
  selectTaskLifecycleChips,
  useAgentStatusStore,
} from "../status";
import { LifecycleBadge } from "../terminal/LifecycleBadge";

interface Props {
  /** The issue's UUID (what the agent host keys runs by). */
  issueId: string;
  /** Descendant issue UUIDs to roll up (e.g. a story's sub-tasks). */
  descendantIds?: string[];
  className?: string;
}

/**
 * Read-only live agent-state chicklets. Groups runs by raw lifecycle state so
 * each compact glyph carries its own count. Callers may include descendants;
 * without them the badge reflects this issue's runs only.
 */
export function AgentStateBadge({ issueId, descendantIds, className }: Props) {
  const state = useAgentStatusStore((s) =>
    issueId
      ? selectTaskAgentLifecycle(s, issueId, descendantIds ?? [])
      : "idle",
  );
  const chips = useAgentStatusStore((s) =>
    issueId ? selectTaskLifecycleChips(s, issueId, descendantIds ?? []) : [],
  );
  if (!issueId) return null;
  if (chips.length === 0) return null;

  return (
    <span
      className={`inline-flex min-w-0 flex-none items-center gap-1 overflow-hidden ${className ?? ""}`}
      data-testid="agent-state-badge"
      data-state={state}
    >
      {chips.map((chip) => (
        <LifecycleBadge
          key={chip.state}
          state={chip.state}
          count={chip.count}
          showLabel={false}
          alwaysShowCount
        />
      ))}
    </span>
  );
}
