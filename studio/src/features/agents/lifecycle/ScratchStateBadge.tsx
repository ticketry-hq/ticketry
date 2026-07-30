import {
  selectScratchLifecycleChips,
  toAgentLifecycle,
  useAgentStatusStore,
  type AgentLifecycle,
} from "../status";
import { LifecycleBadge } from "../terminal/LifecycleBadge";

interface Props {
  projectId: string | null;
  moduleId: string | null;
  className?: string;
}

function aggregateLifecycle(
  chips: ReturnType<typeof selectScratchLifecycleChips>,
): AgentLifecycle {
  let aggregate: AgentLifecycle = "idle";
  for (const chip of chips) {
    const lifecycle = toAgentLifecycle(chip.state);
    if (lifecycle === "attention") return lifecycle;
    if (lifecycle === "active") aggregate = lifecycle;
  }
  return aggregate;
}

/**
 * Read-only lifecycle chicklets for the selected module's live Plan and
 * Instant scratch runs.
 */
export function ScratchStateBadge({
  projectId,
  moduleId,
  className,
}: Props) {
  const chips = useAgentStatusStore((status) =>
    projectId && moduleId
      ? selectScratchLifecycleChips(status, projectId, moduleId)
      : [],
  );
  if (chips.length === 0) return null;

  return (
    <span
      className={`inline-flex min-w-0 flex-none items-center gap-1 overflow-hidden ${className ?? ""}`}
      data-testid="scratch-run-chicklets"
      data-state={aggregateLifecycle(chips)}
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
