# Studio overhaul acceptance gate

Every numbered check in the matrix below was once a manual pre-merge walk; all
of them are now automated by
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
| 16 | Closing a live terminal refreshes its dormant provider session in place, and Resume continues the provider conversation in a newly selected terminal tab. |
| 17 | Fresh provider onboarding saves an activated provider and global launch default. |
| 18 | The work-item pane boundary exposes an accessible draggable separator. |
| 19 | Workflow settings derive state-delete blockers from canonical resources. |
| 20 | The dialog bus renders confirmation requests and resolves both user choices. |
| 21 | Repeating Run subtree revives an inactive campaign from the same action. |
| 22 | Settings cold-opens from the footer onto Models without loading workflow catalogs. |
| 23 | A prepared native terminal retires the fallback viewer before committing outside viewer ownership, reveals only after that commit, then releases ownership on detach. |
| 24 | Work-item details render attachments read from the attachment subcollection. |
| 25 | A workflow-state catalog rename relabels its section without losing held work items. |
| 26 | First-project onboarding selects the created project before starting its guided tour. |
| 27 | A delayed native failure from a replaced attachment cannot detach the replacement viewer. |
| 28 | Disabled-Projects onboarding resolves a valid default project and keeps failures retryable on the composed welcome screen. |
| 29 | Guided module creation retries a failed folder link against the already-created module. |
| 30 | Ordinary module creation stays open through folder-link failure and closes only after a successful retry. |
| 31 | Pathless module selection preserves the prior selection on cancel or save failure and resumes after a valid link. |
| 32 | A native attachment-process exit closes its viewer and releases outside viewer ownership without ending the durable terminal. |
| 33 | Story-tree rows read as one left-aligned, truncating `identifier · name` label with state color on the identifier alone, keep trailing operational indicators separate, omit the separator when no compact identifier resolves, and leave canonical-key, sequence, and title search available. |
| 34 | The Task workspace names child issues, review findings and their cancel labels, dependency chips and blocker candidates, the parent picker and Module link, and deletion confirmation copy as compact ticket identifiers without leaking canonical keys. |
| 35 | Live and restored task-bound terminal tabs and their close affordances read the launch state their own durable run captured, with no ticket identifier, while scratch plan/instant runs keep their lowercase modes and an unrecorded state stays blank. |
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
| 48 | A live desktop run waits for the direct native libghostty-to-tmux viewer without opening the xterm/WebSocket fallback in parallel. |
| 49 | A terminal tab appears directly from ProjectRunStatus when its run projection arrives after the workspace first mounts, without a separate terminal-discovery read. |
| 50 | Details and document navigation keep the same opened terminal mounted, then reactivate it in place. |
| 51 | A tab-strip drag places a module at the indicated tab edge and every module surface follows. |
| 52 | Tab navigation and the fixed add-module control remain intact across tab-strip reordering. |
| 53 | A running client adopts a Manual module order established elsewhere. |
| 54 | A failed project read retains the last known module ordering mode. |
| 55 | A newly created module returns to activity-based recency once it receives activity of its own. |
| 56 | Native first attach and reattach remain pending until exact clipped-frame presentation, while preparation failure retains fallback behavior. |
| 57 | Run serially sits beside Run subtree under one capability, sends serial mode with independent pending and feedback, reports launched work as success and a press that launches nothing as nothing started, and both actions disappear together after a stale capability refresh. |
| 58 | A native viewer resized while it prepares is presented at the pane's live geometry, and the pooled fallback is retired only once that grid is applied. |
| 59 | A projects read started before an accepted first Module drag cannot restore recency over the resulting Manual module order. |
| 60 | State transitions consume the authoritative landing rank, while cross-state drag finishes at its explicit drop seam. |
| 61 | A StrictMode remount never overlaps two native attachments for the same durable terminal run. |
| 62 | The native terminal clears the workspace tab boundary, sits flush against the pane's bottom edge, and retains its side pane insets. |
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
| 73 | An authoritative scratch-run snapshot removes omitted foreign or orphaned activity from the visible summary. |
| 74 | A task workspace launches one fresh promptless task run and activates its acknowledged terminal tab. |
| 75 | Task launch lists each supported activated provider once, explains unavailable profile/provider states without launching, and leaves scratch launch on Plan and Instant. |
| 76 | Task launch supports predictable keyboard choice, Escape focus restoration, and non-consuming outside-pointer dismissal. |
| 77 | Task launch invalidates a changed workspace owner, commits one run per selection, and permits a later intentional fresh run and tab. |
| 78 | A pending task launch completes create, acknowledgement, and terminal rekey after navigation leaves its terminal surface. |
| 79 | A person can move a Story directly from Ideas to Implement through the ordinary state picker. |
| 80 | An eligible Story in Ideas can Run now from Details or global `r`, with guarded pending/refusal behavior, terminal activation, and live workflow eligibility. |
| 81 | A document discovered by the backend file watcher appears immediately as the active workspace tab. |
| 82 | Edit-view ArrowRight expands a collapsed Story first, then dives straight into that Story's remembered Active tab body where Enter lands, never stopping at the workspace tab strip. |
| 83 | A stopped Codex run projects Needs input, and its terminal tab and aggregate work-item status read that one projection. |
| 84 | A gracefully exited agent run leaves the live terminal tabs without a Session lost error and appears in the resumable terminal row. |
| 85 | A live terminal whose output has not changed for 60 seconds presents as Stalled on its tab and in the aggregate work-item status, and changed output restores the latest provider lifecycle state; a run waiting on the user keeps Needs input or Permission required however long it waits. |
| 86 | The terminal tab's X terminates through the backend and the run stays Exited on every surface against later timer advancement, a late output observation, and a reconnect snapshot. |
| 87 | A stalled but still-live terminal returns to the provider's own last lifecycle state as soon as its output changes again. |
| 88 | A native terminal viewer reports terminal output through the shared backend activity operation exactly once, when it takes the run, and then never polls — visible, hidden, or detached — leaving ongoing observation to the backend's live-session sweep. |
| 89 | Studio reads as a terminal with square corners everywhere: no Studio source file declares a rounded-corner utility or a non-zero corner radius, and the global stylesheet flattens every element so third-party CSS cannot round a surface. |
| 90 | The panel toggle opens a bottom panel holding one agentless shell rooted in the selected module, focuses it, and closes the panel again from any focus position. |
| 91 | The panel toggle resolves while an agent terminal holds terminal typing mode, which ordinary navigation keys cannot escape, and closing the panel restores that terminal's typing focus. |
| 92 | A module whose folder is missing or invalid gets the module-folder selection affordance where its terminal would be, and no shell viewer is left behind. |
| 93 | Neither entering a module nor keeping the panel closed launches a shell or attaches a viewer; opening the panel is what creates the module's first shell. |
| 94 | An agent terminal and the panel shell are presented together, with the keyboard reaching only the chosen one and their foreground claims unable to collide. |
| 95 | The panel's shell renders through the existing native renderer when it is available and the existing browser fallback otherwise. |
| 96 | A module holds several panel shell tabs with exactly one of them showing, and choosing a tab presents that shell alone. |
| 97 | The panel stops at the shell cap with its create action visibly refused rather than launching a further durable session. |
| 98 | Switching modules swaps the shell strip and returns to that module's own active tab without creating shells for modules never shown. |
| 99 | A restart or sidecar rebuild rediscovers the shells that survived, in creation order and with the shell that was last in front active again, instead of launching more. |
| 100 | Explicitly closing a panel shell tab terminates its durable session and lands the panel on a determinate remaining tab, or on a stated empty strip when the last one goes. |
| 101 | Only the shell showing in an open panel owns a viewer; background tabs and a closed panel hold none, and neither ends a shell. |
| 102 | The terminal panel resizes within bounds that keep it usable, writes its height alone once the drag settles, and returns at that height after a restart while closing it leaves the height untouched. |
| 103 | The showing terminal panel is the edit view's fourth navigation zone: the cycle reaches it only while it shows, and arriving in it is already typing in its shell. |
| 104 | The established typing-mode exit chord leaves the panel's shell without closing the panel or giving up its zone, and closing the panel hands the zone back. |
| 105 | A panel shell the person exits cleanly is disposed from its module's strip under either renderer, leaving the other shells and their terminals untouched and minting no replacement. |
| 106 | A panel shell that ends non-zero keeps its tab with the code it ended on, and its restart action mints a new shell run in the same slot without ever reviving the dead one. |
| 107 | A shell run moves no module badge, work-item rollup, subtree chicklet or scratch chicklet, and is no stop in the live-terminal cycle, even when shaped to slip past the scope and task filters. |
| 108 | A task terminal tab names the workflow state its run launched in, keeps that word after the Story moves on while a later run reads its own, shows no ticket identifier or provider slug, and hovers the launch facts that were actually recorded. |
| 109 | Live terminal tabs read in their provider's colour and invert to a provider fill with near-black ink when selected, while an exited, lost, or errored terminal goes neutral grey with no provider hue and its lifecycle badge keeps its own palette. |
| 110 | Two live terminals sharing a provider and launch state take launch-order ordinals, the numerals disappear once no live collision remains, and the ended tab left in the strip is still addressable by an accessible name that says it ended. |
| 111 | Dormant resume and terminated-history chips name the phase their run launched in exactly as the tab for the same run does, carry the same hover facts and neutral ended treatment, show no ticket identifier, and leave an unrecorded phase blank. |
| 112 | A reload with no client session state rebuilds each terminal tab's captured launch state and model, provider colour, live-collision ordinals, and the ended runs' neutral history chips from the authoritative run records alone. |
| 113 | A live desktop terminal whose native viewer reports a render failure keeps the compatibility renderer and its native-failure notice, and one window-scoped campaign requests exactly one full Studio refresh 500 ms later. |
| 114 | Two live terminals whose runs recorded no launch state get distinct accessible tab names from their launch-order ordinals, while the visible tab label stays blank. |
| 115 | Native rendering that keeps failing across refreshes waits 500 ms, 1 s, 2 s, 4 s, 8 s and then 10 s per attempt from a window-session campaign, each refresh detaches and releases its temporary viewer exactly once while the durable run is restored under the same foreground owner, and one native presentation clears the campaign so the next incident waits 500 ms again. |
| 116 | A second terminal presenting a non-empty native grid recovers only its own run: a terminal still stranded on the compatibility renderer keeps its notice, its booked refresh still fires, and the consumed attempt is not reset to the initial delay. |
| 117 | Opening Settings from the real footer action or its global binding over a presented native terminal hides that viewer without detaching it, releasing its lease, closing the terminal, or ending the run, and closing the dialog reveals the same handle against the host's current measurement. |
| 118 | Every presentable native viewer, across concurrent Studio surfaces, hides for an open modal and only viewers still active and owned are revealed against a fresh measurement when it closes; attachment that completes while the stack is non-empty commits no reveal, out-of-order native hide/show promises settle on the latest modal intent, hidden viewers take no focus while a pointer-opened dialog returns focus to its opener, and a native visibility failure leaves Settings visible and interactive behind the compatibility fallback. The same window-level rule covers the client store's confirm dialogs: a `DialogHost` confirm raised with an empty modal stack hides a presented panel viewer, takes no focus from it, and reveals the same handle once it is answered. |
| 119 | The footer's always-available Terminal control opens a hidden panel and the panel's own Minimize control hides it again, through the same action the shortcut uses: both are real buttons named for the action they perform and sit outside the shell tab list, and hiding leaves the shell alive, its tab active and no viewer presented under either renderer. |
| 120 | Whether the terminal panel is showing belongs to the module it opens onto: opening it in one module leaves another module's closed, each module keeps its own answer across a switch, and a restart returns every module to the state it was left in while the window keeps only the height. |
| 121 | The panel header's maximize control renders the panel at the geometry policy's current upper bound and restores the exact ordinary height without drift, keeps its size mode across hiding and a restart in one debounced furniture record, restores legacy and corrupt records as ordinary, recomputes the maximized height when the window changes without overwriting the ordinary preference, leaves maximized mode on a drag or separator nudge with the resulting height as the new ordinary one, and resizes the mounted browser and native viewers in place with no attach, detach, run, shell close or terminal input. |
| 122 | The footer no longer carries a Keyboard Shortcuts control; Settings contains the searchable keyboard-shortcut reference, and the global `?` binding opens that Settings section directly. |
| 123 | Opening Settings from the footer over the selected terminal in a mounted Task workspace hides the retained native viewer without detaching, releasing its lease, closing its session, or replacing its handle, and closing Settings remeasures and reveals that same handle; the browser compatibility renderer stays mounted in the WebView without native visibility traffic. |
| 124 | Task workspace Settings occlusion converges on the newest navigation and presentation intent: a pending modal hide shields a newer Details destination until native completion, and a close/reopen/close sequence cannot accept an older reveal merely because the newest request uses the same retained handle. Together with the shared mounted Settings cases 117–118, the gate preserves native-chord singleton routing, hidden-viewer focus exclusion, late attachment suppression, owner/geometry convergence, compatibility fallback, and failure recovery. |
| 125 | Module creation refuses a missing folder before creating the module. |
| 126 | Opening state configuration over a selected Task terminal hides the retained native viewer without detaching or replacing it, and closing state configuration remeasures and reveals the same handle. |
| 142 | An upgraded profile uses distinct gray, red, and teal workflow colors on state headers and work-item identifiers while preserving a custom state color. |
| 149 | The module shell uses the native renderer when available and the browser fallback otherwise. |
| 153 | The desktop xterm fallback attaches, exchanges bytes, resizes, scrolls, suspends, resumes, and detaches through Tauri viewer commands instead of the Python terminal WebSocket. |
| 154 | Desktop Run Now, agent and module-shell discovery and control use caller-owned GraphQL over TauRPC, deliberate launches get fresh request IDs while retries retain them, mutations refresh canonical terminal holdings, and native plus xterm viewers share generation-bound lease authority. |
| 155 | Studio snapshots and live output events consume the same Rust run projection, including Shell scope, nullable provider, launch metadata, effective state, output sequence, and output time. |
| 156 | Studio stays closed through adoption and names the verified snapshot recovery boundary. |
| 157 | Startup failures distinguish unsupported, refused, snapshot, bridge, postflight, and recovery states. |
| 158 | Browser development uses the Rust GraphQL adapter with no REST fallback. |
| 159 | Startup failures point to the Ticketry application log and never show a retired sidecar notice. |
| 160 | Studio keeps its established typefaces and readable native-terminal metrics. |
| 161 | Native-render recovery keeps the compatibility renderer and does not refresh after viewer-ownership storage failure. |
| 162 | A retained native viewer releases once when the WebView lifecycle ends, including listener-cleanup failure. |
| 163 | Apollo is Studio's only server-state client. |
| 164 | Module tickets with blocker edges render from the WorkTracker read contract. |
| 165 | The selected Work Item owns one worktree block inside the hideable Details panel. |
| 166 | Worktree confirmation and mutation errors do not leak across task selection. |
| 167 | Apollo is Studio's only application-state owner; client-only UI state lives in the same cache as server records. |
| 168 | A module drag rejected because its cached neighbors are stale refreshes the authoritative order, recomputes the same gesture, and completes without asking the person to retry. |
| 169 | A native terminal viewer reports terminal output through the shared backend activity operation exactly once when it takes the run, and then never polls. |
| 170 | Onboarding belongs to the installation project: the welcome appears while no project exists or while the installation project still requires it, an acknowledgement names the project the tour ran for, and a restart reads the acknowledged state back. |
| 171 | A WorkItem's Apollo-owned workspace tab order interleaves Details, documents, and terminals across reload, close and reopen, dormant periods, and newly visible tabs. |
| 172 | Workspace tabs stay locked until their saved order loads, then show horizontal drag placement, suppress the drop click, serialize saves, retain the active tab in view, and roll back a failed optimistic save. |
| 173 | Live-terminal cycling reads each candidate WorkItem's Apollo-owned saved order, including workspaces that have not been opened, before selecting the next terminal. |
| 174 | When Ticketry cannot own an MCP listener, Studio says agent launches are blocked, local shells remain available, restart retries listener startup, and the acknowledgement does not claim to continue without MCP. |
| 175 | A hidden Module tab stays hidden after the Apollo cache is rebuilt from the authoritative project read. |
| 176 | Agent activity does not reopen a hidden Module tab. |
| 177 | When every Module tab is hidden, the permanent footer control opens the Modules pane, hidden rows keep lifecycle status, and sidebar selection restores and selects the tab. A project with no Modules offers creation instead of recovery copy. |
| 178 | While a native Ghostty view is engaged, only its live focused surface receives Ghostty-bound Command keys such as `Cmd++`; unbound application commands stay with AppKit, and retained or tearing-down viewers cannot query stale surfaces. |
| 179 | Cmd+1 through Cmd+0 select the same canonical visible Module positions from WebView and focused native Ghostty input; hidden and archived Modules consume no position, and native keyboard engagement clears held-Command badges. |
| 180 | Cmd+Escape from the live focused native terminal and the WebView leave typing through the same transition exactly once, return focus to the current zone, preserve the open terminal and workspace selection, ignore disposed viewers, and do not steal modal focus. |
| 181 | Root tasks reorder through the GraphQL write path. |
| 182 | Imported root tasks with equal ranks still send deterministic reorder neighbors. |
| 183 | A Module tab's close hover background remains a compact square inside the tab. |
| 184 | A task worktree keeps cumulative committed changes in one labeled, accessible Changes tab. |
| 185 | A task workspace restores Details and explains the state when its worktree disappears. |
| 186 | One caught-up project feed turns one guarded launch acknowledgement and its authoritative update into one visible Agent Run without a second click, subscription, or reconnect. |
| 187 | A clean module opens Changes beside Terminal and presents the empty task list. |
| 188 | Module Changes orders the required facts and navigates module and task rows without a write. |
| 189 | Module Changes distinguishes an unavailable module checkout. |
| 190 | Task Commit and Push remain independent, and Push excludes dirty work. |
| 191 | Module Push is offered for a clean ahead branch while Commit requires dirty work. |
| 192 | Task Create PR pushes committed work first, then becomes Open PR. |
| 193 | A rejected task Create PR remains retryable. |
| 194 | Task Create PR requires committed work. |
| 195 | A module-checkout pull request targets the default branch without changing a Work Item. |
| 196 | The module default branch has no pull-request action. |
| 197 | Every mapped pull-request state exposes only its safe actions. |
| 198 | Closed pull requests can be replaced with explicit follow-ups. |
| 199 | Merge preparation launches only after a click and reports refusal. |
| 200 | Cleanup blockers explain why removal is unavailable. |
| 201 | Cleanup confirmation keeps a partial failure retryable. |
| 202 | Conversations replaces Scratch and selects each conversation's exact terminal. |
| 203 | Instant settings persist the standing prompt and auto-close default. |
| 204 | Past Agent Runs remain independently resumable. |
| 205 | A cold Changes restoration clears when the resolved worktree has no checkout. |
| 206 | Browser update checks defer quietly to the desktop application. |
| 207 | After a Dirty Shutdown, Studio shows a dismissible, non-modal Crash Notice that reveals the fixed Crash Report folder; clean launches stay silent. |
| 208 | Desktop launch checks contact the update feed once, show available updates on the Settings entry point, retain the result in App updates, and keep launch failures quiet until that section opens. |
| 209 | An update check reports the installed version and confirms when Ticketry is current. |
| 210 | An available update shows its version and release notes without installing it. |
| 211 | Update downloads report determinate and indeterminate progress. |
| 212 | An unreachable update feed can be retried without restarting Ticketry. |
| 213 | An invalid update signature is refused without requesting a restart. |
| 214 | A failed update download can retry the same release without another feed check. |
| 215 | Restart is requested exactly once and only after update installation finishes. |
| 216 | Desktop launch checks for updates once and shares the result with Settings. |
| 217 | Settings opens from the bootstrap connecting screen, so a web session held before the local server answers can still reach Settings. |
| 218 | Settings opens from the failed service-health screen. |
| 219 | Settings opens while service health is still starting up. |
| 220 | A failed modal chunk shows a recoverable panel instead of blanking the app. |
| 221 | Retrying a failed modal chunk opens the requested dialog. |
| 222 | A failed modal can close without blanking the app. |
| 223 | A pending modal chunk shows a visible loading status. |
| 224 | An empty modal stack renders no modal UI. |
| 225 | A saved launch model configuration reads back with its provider, model, and reasoning after reopening the workflow settings. |
| 226 | A launch configuration naming an agent/provider without a model is refused with that reason rather than saved as unconfigured. |
| 227 | Saving a launch configuration after the workflow editor loads sends the catalog's model and reasoning UUIDs, not name-keyed placeholders the host rejects with "Enter a valid UUID.". |

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
