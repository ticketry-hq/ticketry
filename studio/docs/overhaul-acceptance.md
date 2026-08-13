# Studio overhaul acceptance gate

The seventy-one checks that were once a manual pre-merge walk are automated by
`npm run test:overhaul --workspace @worktracker/studio`. Desktop CI runs that
named gate before the full Studio suite, typecheck, and build.

| Case | Automated behavior |
| --- | --- |
| 01 | Field, type, and parent changes repaint the Stories and Details surfaces. |
| 02 | Ideas is the first and only intake section, and a Story in Grill can move back to it immediately. |
| 03 | A dragged Story keeps its authoritative post-reply position. |
| 04 | A refused write visibly rolls back. |
| 05 | An external/agent edit repaints the open UI without reload. |
| 06 | Selection cycles through loaded records without a loading flash. |
| 07 | A collapsed branch retains descendant activity chicklets. |
| 08 | The keyboard live-terminal cycle enters collapsed branches. |
| 09 | An externally killed terminal remains as a dead tab once the run projection confirms the loss; a projection that says the run is alive outranks a stale viewer verdict. |
| 10 | A closed terminal stays dismissed after server reconciliation. |
| 11 | An unsaved document buffer survives tab switches. |
| 12 | Reload restores sidebar, panel layout, expansion, and collapsed sections. |
| 13 | A module scratch workspace launches and displays its run summary. |
| 14 | Reconnect replay closes a missed-membership gap without duplication. |
| 15 | Switching projects cannot let a stale status snapshot mark a connected run exited. |
| 16 | A dormant provider session resumes into a newly selected terminal tab. |
| 17 | Fresh provider onboarding saves an activated provider and global launch default. |
| 18 | The work-item pane boundary exposes an accessible draggable separator. |
| 19 | Workflow settings derive state-delete blockers from canonical resources. |
| 20 | The dialog bus renders confirmation requests and resolves both user choices. |
| 21 | Repeating Run subtree revives an inactive campaign from the same action. |
| 22 | Settings cold-opens from the footer onto Models without loading workflow catalogs. |
| 23 | A native terminal commits outside viewer ownership only after native preparation succeeds, then releases it on detach. |
| 24 | Work-item details render attachments read from the attachment subcollection. |
| 25 | A workflow-state catalog rename relabels its section without losing held work items. |
| 26 | First-project onboarding selects the created project before starting its guided tour. |
| 27 | A delayed native failure from a replaced attachment cannot detach the replacement viewer. |
| 28 | Disabled-Projects onboarding resolves a valid default project and keeps failures retryable on the composed welcome screen. |
| 29 | Guided module creation retries a failed folder link against the already-created module. |
| 30 | Ordinary module creation stays open through folder-link failure and closes only after a successful retry. |
| 31 | Pathless module selection preserves the prior selection on cancel or save failure and resumes after a valid link. |
| 32 | A native attachment-process exit closes its viewer and releases outside viewer ownership without ending the durable terminal. |
| 33 | Story-tree rows keep state-colored compact ticket identifiers at the leading edge, followed by flexible titles, while canonical-key, sequence, and title search remain available. |
| 34 | The Task workspace names child issues, review findings and their cancel labels, dependency chips and blocker candidates, the parent picker and Module link, and deletion confirmation copy as compact ticket identifiers without leaking canonical keys. |
| 35 | Live and restored task-bound terminal tabs and their close affordances read as the compact ticket identifier, while scratch and taskless sessions keep identifier-free labels. |
| 36 | A live terminal falsely tombstoned by legacy runtime reconciliation returns to its active lifecycle when the repaired status snapshot arrives. |
| 37 | The sidebar, Module tab strip, keyboard position shortcuts, and backlog grouping all render the one Canonical module order. |
| 38 | Agent activity reorders an automatic project's modules but leaves a project in Manual module order on its persisted order. |
| 39 | An agent-activity lookup failure leaves an automatic project on the server's fallback module order. |
| 40 | A module list loaded before the project cache is warm still reads the project's durable ordering mode. |
| 41 | A project whose ordering mode cannot be read is treated as automatic. |
| 42 | The first sidebar module drag sends the exact visible order as its baseline and shows the move in the sidebar and Module tab strip at once. |
| 43 | A pending module reorder disables further drag sources and converges on authoritative project and module data once it settles. |
| 44 | A refused module reorder restores the previous order, reports the failure, and a retry succeeds. |
| 45 | Cancelled and no-op module drops write nothing, and a drop does not select the module it landed on. |
| 46 | A module created in an automatic project leads every module surface, and selection, its folder link, and the sidebar add control are unchanged. |
| 47 | A module created in a project with Manual module order leads every module surface without leaving that mode, and agent activity cannot demote it. |
| 48 | A live desktop run prefers the direct native libghostty-to-tmux viewer and retains xterm as its fallback. |
| 49 | A persisted terminal appears when its run projection arrives after the workspace first mounts. |
| 50 | Details and document navigation keep the same opened terminal mounted, then reactivate it in place. |
| 51 | A tab-strip drag places a module at the indicated tab edge and every module surface follows. |
| 52 | Tab navigation and the fixed add-module control remain intact across tab-strip reordering. |
| 53 | A running client adopts a Manual module order established elsewhere. |
| 54 | A failed project read retains the last known module ordering mode. |
| 55 | A newly created module returns to activity-based recency once it receives activity of its own. |
| 56 | Native first attach and reattach remain pending until exact clipped-frame presentation, while preparation failure retains fallback behavior. |
| 57 | Run serially sits beside Run subtree under one capability, sends serial mode with independent pending and feedback, and both actions disappear together after a stale capability refresh. |
| 58 | A native viewer resized while it prepares is presented at the pane's live geometry, and the pooled fallback is retired only once that grid is applied. |
| 59 | A projects read started before an accepted first Module drag cannot restore recency over the resulting Manual module order. |
| 60 | State transitions consume the authoritative landing rank, while cross-state drag finishes at its explicit drop seam. |
| 61 | A StrictMode remount never overlaps two native attachments for the same durable terminal run. |
| 62 | The native terminal clears the workspace tab boundary while retaining its other pane insets. |
| 63 | The native tmux surface, its host layer, and its loading seam use Studio's pane palette instead of a separate black layer. |
| 64 | Native terminal surfaces are discarded before a WebView reload can reuse stale pane geometry. |
| 65 | The native Ghostty surface clips Metal output to its pane, preserves its insets, and resizes the durable tmux grid across windowed/fullscreen transitions. |
| 66 | Studio modals hide the retained native Ghostty surface and restore it to the measured Task workspace host when the modal closes. |
| 67 | Opened native viewers remain attached across Work-item and terminal-tab switches, unopened runs stay lazy, and stale activation completion cannot replace the selected viewer. |
| 68 | A failed retained native viewer tears down exactly once, falls back with a useful reason, and does not retry attachment during later navigation. |
| 69 | Studio and issue-drawer hosts move one retained viewer, keep hidden hosts non-interactive, apply current geometry before reveal, and focus only on explicit typing signals. |
| 70 | Selecting a Work item with no terminals keeps previously opened terminal viewers mounted, and returning reuses the same host. |
| 71 | Removing the React host that first attached a native viewer after ownership transfers preserves the pool-owned handle, lease, and listeners until the final host leaves. |
| 72 | Details, document, and terminal destinations remain shielded until the previously presented retained native viewer finishes hiding. |

Each executable case carries one stable `[overhaul-NN]` marker. The gate has a
contract test that fails if a marker is missing or duplicated. When a Studio UI
change affects one of these behaviors, update that case in the same change. If
the change introduces a new durable user behavior, add a new acceptance case
and extend this matrix rather than returning to a manual checklist.

## Real-browser web gate

`npm run test:e2e:overhaul --workspace @worktracker/studio` starts the browser
development stack with a temporary SQLite profile and drives Chromium through
the visible Studio UI. The Playwright cases live in `studio/e2e/overhaul.spec.ts`.
The temporary profile and its tmux socket are removed when the run exits.

Cases that require a real coding-agent process, a tmux session killed from
outside Studio, or repository-backed documents remain explicitly skipped in
the web suite. They must not be counted as automated until the harness has safe
fixture support for those boundaries; their existing Vitest cases are not a
substitute for running-application verification.
