# Module switch timing probes

Development builds automatically emit `[module-load]` JSON through the existing
frontend log bridge. Start with `npm run desktop:dev`, switch between linked
modules, and inspect `.ticketry-dev/logs/ticketry.log`:

```sh
rg '\[module-load\]' .ticketry-dev/logs/ticketry.log
```

Each `selection_id` starts at the accepted module selection, before publishing
navigation to Apollo. `elapsed_ms` is relative to that selection. Each actual
ModuleOpen transport call has its own `request_id`. Apollo-deduplicated callers
do not produce extra request starts. Late responses keep their original ID.

- `selection-published` measures synchronous navigation and persistence work.
- `work-items-import-ready` includes the dynamic import wait.
- `request-start` to `response-received` includes request serialization, IPC or
  HTTP, backend execution, and response transfer. It does not isolate SQL time.
  `response_characters` reports the encoded response length, not wire bytes.
- `response-parsed` reports JSON parsing cost.
- `apollo-delivered` reports synchronous observer delivery, including cache and
  revision processing. Deferred React work is measured later.
- `tree_builds` and `tree_build_ms` accumulate task conversion and hierarchy
  construction across all hook consumers since selection.
- `row_builds` and `row_build_ms` accumulate grouping, filtering, and visible-row
  construction. Both aggregates appear on each milestone without per-row logs.
- `tasks-committed` reports a React layout effect after task-list commit, with
  task/row counts and whether the query is still refreshing.
- `tasks-paint-opportunity` runs after two animation frames. This approximates
  an opportunity to paint; it does not prove pixels were displayed. Empty and
  cached commits are logged too, so use counts and `refreshing` to distinguish
  them from the refreshed list. Collapsed tasks need not have visible rows.
- `selection-tree-ready` marks the imperative load and remembered-selection path.

Traces stop after two minutes. Repeated tree/row work is aggregated and cannot
consume a milestone budget. Commit and paint events have no count limit within
that window. No task text is logged.
Production and ordinary test runs do not start traces. These probes do not alter
fetch policies or loading behavior.

Code inspection found two callers for ModuleOpen: selection's network-only load
and the mounted hook's cache-and-network query. The query includes descriptions,
state/type/project records, children, and dependency edges for every active task.
These are candidates to measure, not established causes of the reported delay.

Validation: typecheck and eight focused probe/transport/module-selection tests
passed. The full overhaul run passed 435 tests, failed cutover readiness
`overhaul-156` and Launchkey `overhaul-255`, and reported a missing `rootId` in
the agent-run fixture. The isolated desktop build launched successfully, but
computer-use could not resolve its development window, so no user module-switch
latency has been measured yet.

## Task details

`[task-detail]` separately times direct task selection and module-restored task
selection. Each selection logs the first occurrence of each milestone for up to
two minutes: task selection, details data commit/paint opportunity, description
lazy import start/ready, description formatting, and description commit/paint
opportunity. Formatting reports character count and duration without text.
Module traces also include task restoration and detail/description commit and
paint milestones, preserving the earlier time spent waiting to restore a task.

## Ticket #1563 baseline and repeat procedure

The existing generated log contains several frontend sessions that reuse
`selection_id` and `request_id`. Segment captures at each `selection-start`,
preserve its `module_id`, and retain the capture/session identity. Grouping the
whole file by selection ID mixes different modules and produces false results.

The following baseline comes from consecutive tree-instrumented selections in
the existing log, before this implementation. Times are milliseconds since
selection; duplicated StrictMode paint events count as one opportunity.

| Module ID | Tasks / visible rows | Selection / request IDs | Trees at first / refreshed paint | First cached paint, refreshing | First refreshed paint | Synchronous delivery per request |
| --- | --- | --- | --- | --- | --- | --- |
| `718c9c45-a218-4c38-952f-5a6ca4b093c0` | 273 / 96 | 3 / 32, 33 | 172 / 174 | 220 | 3125 | 2757, 31 |
| `b5ebf121-47f7-4404-879f-1b192e078115` | 1 / 11 | 4 / 35, 36 | 8 / 8 | Not observed | 71 | 2, 1 |
| `718c9c45-a218-4c38-952f-5a6ca4b093c0` | 273 / 96 | 5 / 38, 39 | 172 / 174 | 208 | 3132 | 2710, 30 |
| `b5ebf121-47f7-4404-879f-1b192e078115` | 1 / 11 | 6 / 41, 42 | 8 / 8 | Not observed | 90 | 3, 1 |
| `718c9c45-a218-4c38-952f-5a6ca4b093c0` | 273 / 96 | 7 / 46, 47 | 172 / 174 | 247 | 4784 | 4373, 51 |
| `b5ebf121-47f7-4404-879f-1b192e078115` | 1 / 11 | 8 / 59, 60 | 8 / 8 | Not observed | 86 | 3, 1 |

Each listed switch starts two actual ModuleOpen requests. Some second responses
arrive after the first `refreshing:false` paint, so that milestone does not prove
all switch-triggered requests have completed. Count requests through the final
response, and report that response separately from initial display. The large
module's tree time at its first refreshed paint is 131, 130, and 150 ms for the
three examples. These are development counts and durations, including StrictMode.

The later large-module selection 13 restores task
`6b8dd564-427c-4c8b-8dee-9e38b74e8545`: cached list paint at 29074 ms,
details paint at 29075 ms, refreshed list paint at 33257 ms, and 3977 ms delivery
for request 109. That request starts at 28659 ms, long after selection, so this
is not a clean selection-to-detail benchmark. The small module's recorded task
is `024e3f32-5b2e-43dd-b45f-958ac817fa66`. Retained pre-HMR selection actions can
omit fresh task-detail trace starts. Repeating in a fresh frontend session is
required before comparing detail latency.

For the after capture, use the same two module IDs and selected task IDs, the
same search, grouping, expansion, and active details pane, and the same dev
StrictMode setting. Use a fresh frontend session and preserve a log offset or
separate local capture rather than clearing other agents' logs. Alternate small
and large modules three times after an initial warm-up, wait for all requests to
finish on each switch, and record the table above plus detail and description
paint opportunities. Keep cold and cached samples separate. Generated captures
and application data stay uncommitted.

The after capture used a read-only SQLite backup of `state.db` and
`rust-core.sqlite3` in `/private/tmp/ticketry-1563-perf`, the existing debug
GraphQL adapter on port 8897, and Vite on port 5177 in Chrome. The production
app remained running. The snapshot preserves the module/task IDs above, but
contains 281 large-module tasks and 2 small-module tasks, so this is not a
controlled before/after latency comparison. Visible rows were 95 and 12. The
historical baseline used a different frontend runtime and earlier data.

Source edits caused HMR during the initial capture. Those intermediate warmed
samples had selection/request events without commit probes and are excluded;
zero reported tree builds there does not mean no tree work. A full frontend
reload after source changes ended produced the valid final-source session at
2026-09-08 04:00:54 UTC. One warmed pair was measured in that clean session.

| Module / sample | Selection / request IDs | Trees / tree ms | Cached list paint | Refreshed list paint | Selected details paint | Delivery ms |
| --- | --- | --- | --- | --- | --- | --- |
| Small / initial session restoration | 1 / 6, 14 | 2 / 0 rounded | 246.5, after first request | 275.0 | 246.4 | 1.6, 0.7 |
| Large / cold module | 2 / 23 | 2 / 5.8 | No cached tasks | 500.9 | 501.4 | 96.8 |
| Small / warmed | 3 / 31 | 2 / 0 rounded | 16.4 | 57.2 | 57.6 | 1.9 |
| Large / warmed | 4 / 33 | 2 / 3.6 | 61.6 | 394.3 | 394.8 | 81.4 |

All paint times above are milliseconds since module selection. The large cold
sample's earlier 25.8 and 48.4 ms paints contain zero tasks and do not represent
loaded content. Warmed switches each start one ModuleOpen request; initial
session restoration starts two. Two tree builds reflect the shared derivation
under development StrictMode, versus the historical 172-to-174 large-module
builds and 8 small-module builds. Selecting the same recorded tasks restored
visible Details panes. During the earlier fresh direct-selection capture, task
1511 reached details paint at 205.2 ms and description paint at 327.3 ms; task
1553 reached those milestones at 48.1 and 47.1 ms. Those direct selections
precede the final source reload and are not final-source latency samples.

The final warmed large response still spends 81.4 ms in synchronous delivery,
and reaches refreshed list paint at 394.3 ms. This capture establishes bounded
tree work and records residual latency; it does not establish a desktop speedup
ratio. No guard-only timing or Apollo memoization-pressure measurement was
captured. The installed Apollo development API exposes `getMemoryInternals()`
for the next profiling step. Generated databases and logs remain uncommitted.

The remaining synchronous delivery cost is unresolved. The transport's
`apollo-delivered` interval includes `issueRevisionGuardLink`, Apollo
normalization, cache reads/writes, and observer notifications. The guard walks
the response and reads operation-shaped fragments for issue revisions. That is
a candidate cost, not a measured attribution. Time the guard separately and
inspect Apollo memoization pressure in the same capture before attributing the
residual delay or choosing pagination/query splitting. The baseline's
2.6-to-4.4-second large-module delivery stall is not explained by its roughly
0.12-to-0.15-second tree work alone.

A description commit means that component mounted; the details-data commit may
still contain a description Suspense fallback. Paint opportunities do not prove
pixel visibility, and an active terminal/document tab can hide the details pane.
The lazy import is measured only on its initial load. These probes do not measure
rich-editor editing readiness. Dev StrictMode repeats render work, so production
costs should not be inferred directly from development measurements.


## Desktop recapture after CODING-1563

The September 8 desktop recapture contains 11 module selections in its last
frontend session. Seaolim Migration had 281 tasks and 95 visible rows; the
small module had 2 tasks. Repeat large-module selections 3, 5, 7, 9, and 11
recorded 2 tree builds each, requests of 223–253 ms, revision-guard processing
of 3–4 ms, and total synchronous delivery of 53–88 ms. First refreshed list
paint opportunities were 354–397 ms. Initial session selection 1 issued two
requests and reached its first refreshed list paint opportunity at 1149 ms.

One direct task selection in that session committed details at 30 ms and
reached a paint opportunity at 113 ms. This single sample does not establish
a task-click latency distribution or editing readiness. Historical and current
captures have different task counts and workspace changes, so this is not an
isolated causal benchmark of CODING-1563.


## Input and interactability probes

Task-row traces now carry `session_id` and `elapsed_origin`. A primary pointer
down starts the clock using the event timestamp; `task-click` records dispatch
and `event_to_handler_ms`, followed by `task-selection-dispatched`. To obtain
click-event-to-milestone time, subtract the click record's `click_elapsed_ms`
from the milestone's `elapsed_ms`, then add the click's `event_to_handler_ms`.
Pointer-relative time also includes the user's press duration. Programmatic
selections start separate traces. Module-restored tasks use the module selection
action entry as their origin, including the wait for module data, but do not
measure queue delay before that action.

Readiness stages distinguish what is actually available:

- `details-sidebar-toggle-enabled`: the active Details pane has mounted its
  enabled sidebar toggle. This does not claim every form field is ready.
- `description-view-click-surface-mounted`: the active description view has
  mounted its existing click target.
- `description-edit-click`: the description click handler started, before
  asynchronous Markdown conversion.
- `description-editor-rich-editable` / `description-editor-fallback-editable`:
  an enabled contenteditable or source textarea is present in the active pane.
  Subtract edit-click time to distinguish editor setup from the user's reading
  time before choosing to edit. Rich editor discovery observes DOM changes for
  at most five seconds, and disconnects on readiness or unmount. Absence of a
  milestone is not a measured latency or a successful readiness result.
- `description-editor-focus-observed`: trusted focus reached the editor. Browser
  programmatic focus can also be trusted, so this does not establish user intent.
- `description-editor-first-trusted-input`: a trusted input event reached the
  rich editor. No synthetic focus, input, or writes are generated by probes.

The Details tab visibility context suppresses readiness milestones while that
workspace tab is hidden. DOM availability and enabled status remain estimates
of interactability, not proof of displayed pixels, lack of an overlay, or that
all background work is finished. All task detail logging is dev-only and omits
task text. Restart the frontend before capturing first-load results to avoid
HMR mixing probe closures and warmed imports.

Validation of the input/readiness probes: 11 focused tests and Studio typecheck
passed. An early full overhaul pass had 446 passing tests; the final rerun had
443 pass and 3 fail. Two failures passed on isolated retry; overhaul-290 still
fails because selected details retain their original title after a task refresh.
The cache/subscription cause is not established by these probes and remains
unresolved. The desktop rebuilt and launched with the final probes after
removing old generated Rust test executables to recover disk space.
