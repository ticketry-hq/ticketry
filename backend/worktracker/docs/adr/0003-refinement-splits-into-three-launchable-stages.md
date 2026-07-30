# Refinement splits into three launchable stages

The single refinement state becomes three states — Grill, Spec, Tickets — each
owning one pinned upstream skill and one deliverable, with state-entry auto-start
carrying a Story from Grill through to Tickets without a human relaunch. We
rejected keeping one state that runs all three skills in one agent session
because a single session gave the reviewer no seam at which to inspect a bad
grill before it became a spec and then twelve wrong tickets, and because
per-state skill requirements had no effect when one binding requested all three.
The chain deliberately halts at Tickets: entering implementation is a human
decision, so that edge is human-only and no auto-start is armed on it.
