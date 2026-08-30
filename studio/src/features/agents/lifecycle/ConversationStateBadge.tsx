import {
  toAgentLifecycle,
  useConversationLifecycleChips,
  type AgentLifecycle,
  type TaskLifecycleChip,
} from "../status";
import { LifecycleBadge } from "../terminal/LifecycleBadge";

function aggregateLifecycle(
  chips: readonly TaskLifecycleChip[],
): AgentLifecycle {
  let aggregate: AgentLifecycle = "idle";
  for (const chip of chips) {
    const lifecycle = toAgentLifecycle(chip.state);
    if (lifecycle === "attention") return lifecycle;
    if (lifecycle === "active") aggregate = lifecycle;
  }
  return aggregate;
}

/** Combined lifecycle chicklets for the selected module's Conversations. */
export function ConversationStateBadge({
  projectId,
  moduleId,
}: {
  projectId: string | null;
  moduleId: string | null;
}) {
  const chips = useConversationLifecycleChips(
    projectId ?? "",
    moduleId ?? "",
  );
  if (chips.length === 0) return null;

  return (
    <span
      className="inline-flex min-w-0 flex-none items-center gap-1 overflow-hidden"
      data-testid="conversation-run-chicklets"
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
