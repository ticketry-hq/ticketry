# State configuration opens over the mounted task workspace

Per-state launch policy was reachable only three levels into the Settings modal
(Settings → Workflow → Issue Types → a state's launch disclosure), so the
Stories pane gained a per-state affordance that opens the same policy in the
workspace pane (T83). The workspace pane is keyed per work item and renders its
terminal and document tabs unconditionally so xterm instances survive ticket
switches, and a state's policy is not a property of any work item — so the panel
is a second selection kind that renders *over* a still-mounted workspace rather
than becoming a tab inside its strip. Dismissing it restores the tab strip with
every live session intact.

## Considered options

A closable tab in the workspace strip was rejected because the strip is keyed
per work item: a state-scoped tab would either follow the user across Story
selections or disappear on one. Replacing the pinned Details tab's content was
rejected because it overloads what Details means and hides the Story being read.
A modal or a popover anchored to the state row were both rejected as too small
for a legible prompt — the complaint that motivated the ticket was that the
Settings editor's four-row prompt box is unreadable.

## Consequences

Studio now has two things that can own the right pane, so every code path that
assumes the pane's subject is the selected work item has to tolerate the other
kind. In exchange the panel keeps a single source of truth with the Settings
editor: it mounts the same launch-configuration form against the same workflow
editor store, inheriting its revision guard and its commit-on-blur behaviour, so
the two surfaces cannot drift apart.
