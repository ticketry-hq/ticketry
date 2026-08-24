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
| 38 | A project in Manual module order preserves the order returned by the server. |
| 39 | The module collection is the complete ordering source. |
| 40 | A module list loads without warming the project cache. |
| 41 | Module loading does not depend on a readable project collection. |
| 42 | The first sidebar module drag sends the exact visible order as its baseline and shows the move in the sidebar and Module tab strip at once. |
| 43 | A pending module reorder disables further drag sources and converges on authoritative project and module data once it settles. |
| 44 | A refused module reorder restores the previous order, reports the failure, and a retry succeeds. |
| 45 | Cancelled and no-op module drops write nothing, and a drop does not select the module it landed on. |
| 46 | A module created in an automatic project leads every module surface, and selection, its folder link, and the sidebar add control are unchanged. |
| 47 | A module created in a project with Manual module order leads every module surface without leaving that mode, and later reads follow the server. |
| 48 | A live desktop run waits for the direct native libghostty-to-tmux viewer without opening the xterm/WebSocket fallback in parallel. |
| 49 | A persisted terminal appears when its run projection arrives after the workspace first mounts. |
| 50 | Details and document navigation keep the same opened terminal mounted, then reactivate it in place. |
| 51 | A tab-strip drag places a module at the indicated tab edge and every module surface follows. |
| 52 | Tab navigation and the fixed add-module control remain intact across tab-strip reordering. |
| 53 | A running client adopts a module order established elsewhere and returned by the server. |
| 54 | Project-read failures do not affect module ordering. |
| 55 | A later module refresh replaces creation order with the latest server order. |
| 56 | Native first attach and reattach remain pending until exact clipped-frame presentation, while preparation failure retains fallback behavior. |
| 57 | Run serially sits beside Run subtree under one capability, sends serial mode with independent pending and feedback, reports launched work as success and a press that launches nothing as nothing started, and both actions disappear together after a stale capability refresh. |
| 58 | A native viewer resized while it prepares is presented at the pane's live geometry, and the pooled fallback is retired only once that grid is applied. |
| 59 | A projects read started before an accepted first Module drag cannot affect the resulting server module order. |
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
| 75 | Task launch lists each supported activated provider once, explains unavailable provider states without launching, and leaves scratch launch on Plan and Instant. |
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
| 118 | Every presentable native viewer, across concurrent Studio surfaces, hides for an open modal and only viewers still active and owned are revealed against a fresh measurement when it closes; attachment that completes while the stack is non-empty commits no reveal, out-of-order native hide/show promises settle on the latest modal intent, hidden viewers take no focus, a focus signal raised while Settings owns the foreground is discarded, and a pointer-opened dialog returns focus to its opener. A native visibility failure leaves Settings visible and interactive behind the compatibility fallback. The same window-level rule covers the client store's confirm dialogs: a `DialogHost` confirm raised with an empty modal stack hides a presented panel viewer, takes no focus from it, and reveals the same handle once it is answered. |
| 119 | The footer's always-available Terminal control opens a hidden panel and the panel's own Minimize control hides it again, through the same action the shortcut uses: both are real buttons named for the action they perform and sit outside the shell tab list, and hiding leaves the shell alive, its tab active and no viewer presented under either renderer. |
| 120 | Whether the terminal panel is showing belongs to the module it opens onto: opening it in one module leaves another module's closed, each module keeps its own answer across a switch, and a restart returns every module to the state it was left in while the window keeps only the height. |
| 121 | The panel header's maximize control renders the panel at the geometry policy's current upper bound and restores the exact ordinary height without drift, keeps its size mode across hiding and a restart in one debounced furniture record, restores legacy and corrupt records as ordinary, recomputes the maximized height when the window changes without overwriting the ordinary preference, leaves maximized mode on a drag or separator nudge with the resulting height as the new ordinary one, and resizes the mounted browser and native viewers in place with no attach, detach, run, shell close or terminal input. |
| 122 | The footer no longer carries a Keyboard Shortcuts control; Settings contains the searchable keyboard-shortcut reference with readable, current action descriptions, and the global `?` binding opens that Settings section directly. |
| 123 | Opening Settings from the footer over the selected terminal in a mounted Task workspace hides the retained native viewer without detaching, releasing its lease, closing its session, or replacing its handle, and closing Settings remeasures and reveals that same handle; the browser compatibility renderer stays mounted in the WebView without native visibility traffic. |
| 124 | Task workspace Settings occlusion converges on the newest navigation and presentation intent: a pending modal hide shields a newer Details destination until native completion, and a close/reopen/close sequence cannot accept an older reveal merely because the newest request uses the same retained handle. Together with the shared mounted Settings cases 117–118, the gate preserves native-chord singleton routing, hidden-viewer focus exclusion, late attachment suppression, owner/geometry convergence, compatibility fallback, and failure recovery. |
| 125 | Module creation refuses a missing folder before creating the module. |
| 126 | Opening state configuration over a selected Task terminal hides the retained native viewer without detaching or replacing it, and closing state configuration remeasures and reveals the same handle. |
| 127 | Codex model configuration preserves the supported model and reasoning-level matrix, including the `low` reasoning level, across editing and persistence. |
| 128 | While an engaged native Ghostty view owns keyboard focus, AppKit gives Ghostty's Command-key bindings first refusal so `Cmd++` increases that terminal's font size instead of being consumed by WebView zoom. |
| 129 | The internal PathFind orchestration role never appears in Studio's issue-type choices, while existing PathFind work items show their type as a read-only label. |
| 130 | Module drags on the horizontal tab strip and vertical sidebar clear stale seams across a transient document leave, then resolve by their active axis outside the cross-axis bounds, commit exactly once, and expose one Canonical module order. |
| 131 | Finishing the exactly-once onboarding tour acknowledges the installation's default Project and clears its project-owned onboarding state without workspace scope. |
| 132 | Studio loads the default Project and its Modules without reading profile or feature configuration, creating a replacement Project, modifying extra Project rows, or changing the saved sidebar visibility choice. |
| 133 | Studio restores the last selected Module from one frontend-only value and does not write the retired recent-Project or per-Project recent maps. |
| 134 | Choosing or changing a Module folder validates the candidate and round-trips the accepted value through the typed Module link resource before selection resumes. |
| 135 | An engaged native Ghostty terminal gives `Cmd+V` to Ghostty's standard binding, reads the current text from the macOS general pasteboard, and completes the request against its originating surface and opaque request state while `Ctrl+V` stays terminal input. |
| 136 | Concurrent retained native terminals keep separate paste owners, and teardown invalidates only the departing viewer before its Ghostty surface is destroyed so unavailable viewers cannot complete a request or retain clipboard text. |
| 137 | An engaged native terminal preserves `Cmd+1` through `Cmd+0` as module-tab position shortcuts and switches through the same canonical module order as the WebView keymap. |
| 138 | Only the focused native terminal routes `Cmd+V` through Ghostty's binding path; an unfocused native surface cannot claim or receive the chord. |
| 139 | The persistent footer control, direct visibility requests, focus-left navigation, and the effective global shortcut open and close the Modules pane through shared state transitions; the control reports its next action and expanded state, and displays configured shortcut overrides. |
| 140 | A workflow launch binding can select one required skill as its entry skill or clear the selection, and each change is saved with the rest of the launch configuration. |
| 141 | Enter on a real work item reveals its selected or newest live task terminal in both Stories layouts, restores a closed viewer from durable metadata, or starts and attaches one configured default run when only ended history exists. Pending activation cannot duplicate the request or tab, refusal preserves the previous tab and permits retry, and Stories keeps navigation ownership without entering terminal typing mode. |
| 142 | Ideas, Grill, and Review use distinct gray, red, and teal workflow colors on state headers and work-item identifiers. |
| 143 | The shared agent picker presents activated providers as compact wrapping choices with the same outlined and selected provider tones as live terminal tabs, while keyboard and pointer selection still launch exactly once. |
| 144 | Module selection waits for the Module-link read before deciding that a folder is missing, and repeated selection keeps one folder prompt for that Module. |
| 145 | A rejected provider resume explains the stable backend failure and leaves the dormant conversation available for another attempt. |
| 146 | If hiding a Task workspace's native viewer fails while Settings opens, Settings stays mounted and interactive, the compatibility fallback reports the failure, and the incident does not schedule a Studio reload. |
| 147 | Exact Shift+Enter on a real work item opens the activated-provider picker directly in both Stories layouts; cancelling preserves the workspace and run set, while choosing a provider launches one overridden task run. In the Edit view tab strip, active body, and terminal panel, the same chord keeps the existing prompt-bearing launch route. |
| 148 | Stories labels Right Arrow as Expand / Dive, Enter as Open Terminal, and Shift+Enter as Choose Agent without changing the Right Arrow body route. |
| 149 | A work item's server-owned Workspace tab order controls Details, document, and terminal placement and is restored after reload. |
| 150 | Module selection uses one shared operation: a visible Module selects without a presentation write, while a hidden Module clears only `tab_hidden`, preserves canonical order and module-backed consumers, and becomes selected. |
| 151 | Agent activity does not reopen a hidden Module tab, and its lifecycle badge remains visible on that Module's sidebar row. |
| 152 | Hiding the selected Module tab chooses the nearest visible tab to the right. |
| 153 | Workspace tab order survives document close and reopen, terminal dismissal and restore, appends new tabs at the right edge, and drives live-terminal cycling through mixed tab kinds. |
| 154 | Details, document, and terminal workspace tabs stay locked until saved order loads, then reorder on a horizontal drag with a visible insertion edge, Escape cancellation, post-drop click suppression, pending-save lockout, full identity persistence, optimistic display, rollback on failure, and active-tab scroll retention. |
| 155 | The last visible Module tab can be hidden; the empty strip retains module creation and the workspace points to the Modules sidebar for restoration. |
| 156 | Module position shortcuts count only visible tabs in canonical order, so hidden Modules have no position shortcut. |
| 157 | Hiding the rightmost selected Module tab falls back to the nearest visible tab on the left. |
| 158 | Hiding a Module tab that is not selected leaves the current selection unchanged. |
| 159 | Hidden Modules retain canonical order while visible tabs reorder, and restoration returns a hidden tab at its canonical position. |
| 160 | Live-terminal cycling loads the saved Workspace tab order for every work item with a current stop, including unopened workspaces after reload, before choosing the next terminal. |
| 161 | A project with no modules keeps the Stories and selected-ticket panes mounted instead of showing instructions to restore a tab that never existed. |
| 162 | Startup never restores a hidden remembered Module: it selects the first visible tab instead, and hiding the last visible tab clears the remembered Module together with the in-memory selection. |
| 163 | Pressing Enter on a hidden Module's focused sidebar row restores its tab at the canonical position and selects the Module. |
| 164 | Holding Command alone shows non-interactive jump badges on the first ten visible Module tabs in visual order. Releasing it, adding Shift, Control, or Alt, blurring the window, handing keyboard ownership to a native terminal, changing document visibility, pressing a pointer, opening a modal, or losing the effective platform binding clears them. A new hold follows hidden and reordered tabs, and the matching position binding still selects its tab. |
| 165 | With every Module tab hidden, the shell tells the user to open the closed Modules pane and keeps Add module available. Once the footer opens the pane, the guidance points to selecting a visible Module instead. Sidebar selection restores tabs in canonical order and selects the chosen Module, and closing the pane leaves the restored tabs visible. Together with case 139, the effective global binding and an override follow the same open and close transitions. |
| 166 | Settings accepts a Codex model that uses model-default reasoning, shows no invented reasoning levels, and saves a null reasoning value. |
| 167 | Ordinary typing does not re-render a consumer of Module jump badges when the held modifiers are unchanged, and keyboard events do no badge-tracking work while a modal disables the feature. |
| 168 | Startup honors a stored-open Modules sidebar preference under the current key and ignores the poisoned closed value left under the retired key. |
| 169 | Cmd+Escape reported by an engaged native terminal leaves typing mode, so Studio's engaged state follows the keyboard the native view handed back. |
| 170 | The fixed plus trigger opens the Module picker without opening creation, and its first action opens the existing Module creation flow. |
| 171 | The Module picker lists only non-archived Hidden module tabs in Canonical module order; mixed-case search filters only those choices, keeps their order, leaves creation available, and adds no empty-state choice. |
| 172 | Pointer selection closes the Module picker, restores and selects the chosen Module at its canonical position, and writes no Module order. |
| 173 | When every eligible Module tab is visible, the picker retains only Module search and creation. |
| 174 | When every Hidden module tab belongs to an archived Module, the picker retains only Module search and creation. |
| 175 | Opening the Module picker focuses its named search field; the trigger, creation action, and restore choices expose clear names, and Escape closes the picker, returns focus to the trigger, and leaves the next opening with an empty query. |
| 176 | Arrow Down and Arrow Up move the active option through the currently filtered Module picker listbox while the focused search combobox exposes it through `aria-activedescendant`, and Enter on creation closes the picker and opens the existing creation flow. |
| 177 | Enter on an active Hidden module choice closes the picker, restores its tab, and selects that Module. |
| 178 | Moving focus from the Module picker to a Module tab closes the picker and leaves focus on the tab. |
| 179 | With the Modules pane closed, the onboarding Module step does not anchor to or highlight the Module picker's trigger as though it opened Module creation. |
| 180 | The Worktrees footer toggle opens one accessible right-dock view beside the workspace and terminal, preserves the Base checkout row through live-module and history loading or errors, groups newest-first ship records under only their base or live anchor-task checkout, names every outcome and PR state, replaces both reads on module changes, removes a discarded worktree row without dropping its cached history, retains a practical resized width, and restores the workspace when closed. |
| 181 | Details shows an archived task's newest renderable PR-bearing ship record with relative action time and a safe external link, skips newer records with partial PR facts, unsafe URLs, invalid action times, or no PR, ignores older valid PRs, and omits the line when no record has a PR. |
| 182 | Switching Modules aborts the previous Module's ship-history read, and even a late old response cannot paint the new Module's Worktrees view. |
| 183 | Refreshing one PR-bearing ship record makes one request, disables only that record's control, prevents a double click, keeps other records and links usable, replaces the query-owned record from a successful response, and preserves the visible prior state beside a focused error when refresh fails. |
| 184 | Creating a task worktree from Details while the Worktrees dock is open refreshes the selected Module's active-worktree list and adds the new task row without closing or reopening the dock. |

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
