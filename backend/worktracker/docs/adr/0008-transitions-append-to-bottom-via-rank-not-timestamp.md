# Transitions append to the bottom of the destination state via rank, not a timestamp

Tickets kept their project-global fractional `rank` across state transitions, so a
moved ticket landed at an arbitrary-feeling position in its new column and users lost
track of it. We decided that a successful non-positional transition (state dropdown,
detail panel, agent, or API — any origin) re-ranks the item to sit just after the
destination state's current last item, atomically with the transition write. We
rejected adding a durable state-entry timestamp with strict chronological column
sorting because it would fight or kill manual within-state drag-reorder and introduce
a second ordering regime alongside `rank`.

## Consequences

- A cross-column drag's drop position wins; only non-positional transitions append.
- The new rank is placed just after the destination state's last item (not at the
  global bottom), so the backlog and other non-state views move as little as possible.
- If the destination state is empty, the item keeps its existing rank — it is
  trivially at the bottom.
- All rank-driven state groupings (board columns, tasks-pane status sections, Story
  Map cells) get the behavior consistently for free, because rank stays the single
  project-global ordering.
- No backfill: existing items keep their positions; the rule applies only to
  transitions after ship.
