# Studio overhaul acceptance gate

Every numbered check in the matrix below was once a manual pre-merge walk; all
of them are now automated by
`bun run --cwd studio test:overhaul`. Desktop CI runs that
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
| 12 | Reload translates legacy panel layouts and restores expansion and collapsed sections without recreating a sidebar. |
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
| 34 | The Task workspace names child issues, review findings and their cancel labels, dependency chips and blocker candidates, the parent picker and Module link, and deletion confirmation copy as compact ticket identifiers without leaking canonical keys. A child description edit refreshes its finding location through its normalized task subscription. |
| 35 | After socket startup reaches ready, live and restored task-bound terminal tabs retain their session and Agent Run identities. Reattaching a reconciled surviving run is idempotent and does not resume a new provider run. Their labels and their close affordances read the launch state their own durable run captured, with no ticket identifier, while scratch plan/instant runs keep their lowercase modes and an unrecorded state stays blank. |
| 36 | A live terminal falsely tombstoned by legacy runtime reconciliation returns to its active lifecycle when the repaired status snapshot arrives. |
| 37 | The manager, Module tab strip, keyboard position shortcuts, and backlog grouping all render the one Canonical module order. |
| 38 | Agent activity does not overlay a second client-side order on the canonical module order. |
| 39 | An automatic project keeps the server's canonical creation order when auxiliary project metadata cannot be read. |
| 40 | A module list loaded before the project cache is warm still reads the project's durable ordering mode. |
| 41 | A project whose ordering mode cannot be read is treated as automatic. |
| 42 | The first manager module drag sends the exact visible order as its baseline and shows the move in the manager and Module tab strip at once. |
| 43 | A pending module reorder disables further drag sources and converges on authoritative project and module data once it settles. |
| 44 | A refused module reorder restores the previous order, reports the failure, and a retry succeeds. |
| 45 | Cancelled and no-op module drops write nothing, and a drop does not select the module it landed on. |
| 46 | A module created in an automatic project follows every existing module, and selection, its folder link, and the manager creation control are unchanged. |
| 47 | A module created in a project with Manual module order follows every existing module without leaving that mode. |
| 48 | A live desktop run waits for the direct native libghostty-to-tmux viewer without opening the xterm/WebSocket fallback in parallel. |
| 49 | A terminal tab appears directly from ProjectRunStatus when its run projection arrives after the workspace first mounts, without a separate terminal-discovery read. |
| 50 | Details and document navigation keep the same opened terminal mounted, then reactivate it in place. |
| 51 | A tab-strip drag places a module at the indicated tab edge and every module surface follows. |
| 52 | Tab navigation and the trailing add-module control remain intact across tab-strip reordering. |
| 53 | A running client adopts a Manual module order established elsewhere. |
| 54 | A failed project read retains the last known module ordering mode. |
| 55 | A newly created module remains at the end of the canonical order after a reload. |
| 56 | Native first attach and reattach remain pending until exact clipped-frame presentation, while preparation failure retains fallback behavior. |
| 57 | Run serially sits beside Run subtree under one capability, sends serial mode with independent pending and feedback, reports launched work as success and a press that launches nothing as nothing started, and both actions disappear together after a stale capability refresh. |
| 58 | A native viewer resized while it prepares is presented at the pane's live geometry, and the pooled fallback is retired only once that grid is applied. |
| 59 | A projects read started before an accepted first Module drag cannot restore automatic creation order over the resulting Manual module order. |
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
| 113 | A live desktop terminal whose native viewer reports a render failure hands the same run and tmux session to xterm in place, records the failure origin, reason, run ID, session ID and available handle once, continues fallback if diagnostics fail, drops its notice once xterm connects, and never refreshes Studio. If xterm also fails, its terminal-scoped failure remains visible. |
| 114 | Two live terminals whose runs recorded no launch state get distinct accessible tab names from their launch-order ordinals, while the visible tab label stays blank. |
| 115 | A terminal that fell back to xterm keeps working input and output and its run and session identities across selection after launch, later switching, closing and reopening, and restoration, with one native attempt per run and no Studio refresh. |
| 116 | A native failure stays local to its terminal: a second live run renders natively beside it, and neither terminal loses its run or session identity or triggers a refresh. |
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
| 127 | Clears a ghost scratch badge when the authoritative snapshot omits its foreign or orphaned run. |
| 128 | Launches one promptless task run and activates its acknowledged terminal tab. |
| 129 | Honors provider availability without changing the scratch launcher. |
| 130 | Supports keyboard provider choice and returns focus when dismissed. |
| 131 | Launches against the task context captured when the picker opens. |
| 132 | Completes pending launch acknowledgement after navigating away. |
| 133 | Lets a person move a Story directly from Ideas to Implement. |
| 134 | Runs eligible Ideas from Details or r with one guarded request and follows workflow refreshes. |
| 135 | Opens a document tab discovered by the backend watcher. |
| 136 | Expands a collapsed Story on Right, then dives Right straight into its remembered Active tab body. |
| 137 | Presents a stopped Codex run as needing input on its tab and work-item status. |
| 138 | Moves a gracefully exited terminal from live tabs to resumable sessions. |
| 139 | Presents a silent live terminal as stalled and recovers on output. |
| 140 | Keeps an explicitly terminated terminal Exited against later time, output, and reconnect. |
| 141 | Restores the latest provider lifecycle state when a live terminal resumes output. |
| 142 | An upgraded profile uses distinct gray, red, and teal workflow colors on state headers and work-item identifiers while preserving a custom state color. |
| 143 | Declares no rounded-corner utility anywhere in Studio source. |
| 144 | Opens a module shell on the toggle, focuses it, and closes again from anywhere. |
| 145 | Resolves the toggle while an agent terminal holds typing mode. |
| 146 | Offers the folder affordance instead of launching elsewhere. |
| 147 | Attaches nothing while the panel stays closed. |
| 148 | Keeps an agent terminal and the panel shell visible without sharing keystrokes. |
| 149 | The module shell uses the native renderer when available and the browser fallback otherwise. |
| 150 | Holds several shells in one module and shows exactly one of them. |
| 151 | Stops at the shell cap with the create action visibly refused. |
| 152 | Swaps the strip on a module switch and returns to that module's own active tab. |
| 153 | The desktop xterm fallback attaches, exchanges bytes, resizes, scrolls, suspends, resumes, and detaches through Tauri viewer commands instead of the Python terminal WebSocket. |
| 154 | Desktop Run Now, agent and module-shell discovery and control use caller-owned GraphQL over TauRPC, deliberate launches get fresh request IDs while retries retain them, mutations refresh canonical terminal holdings, and native plus xterm viewers share generation-bound lease authority. |
| 155 | Studio snapshots and live output events consume the same Rust run projection, including Shell scope, nullable provider, launch metadata, effective state, output sequence, and output time. |
| 156 | Studio stays closed through adoption and names the verified snapshot recovery boundary. |
| 157 | Startup failures distinguish unsupported, refused, snapshot, bridge, postflight, and recovery states. |
| 158 | Browser development uses the Rust GraphQL adapter with no REST fallback. |
| 159 | Startup failures point to the Ticketry application log and never show a retired sidecar notice. |
| 160 | Studio keeps its established typefaces and readable native-terminal metrics. |
| 161 | Native-render fallback keeps the compatibility renderer and does not refresh after viewer-ownership storage failure. |
| 162 | A retained native viewer releases once when the WebView lifecycle ends, including listener-cleanup failure. |
| 163 | Apollo is Studio's only server-state client. |
| 164 | Module tickets with blocker edges render from the WorkTracker read contract. |
| 165 | Details fills the pane width with compact spacing, breadcrumbs above the toolbar, and status, Run, Run now, worktree, type, and guide controls in order. |
| 166 | Worktree confirmation and mutation errors do not leak across task selection. |
| 167 | Apollo is Studio's only application-state owner; client-only UI state lives in the same cache as server records. |
| 168 | A module drag rejected because its cached neighbors are stale refreshes the authoritative order, recomputes the same gesture, and completes without asking the person to retry. |
| 169 | A native terminal viewer reports terminal output through the shared backend activity operation exactly once when it takes the run, and then never polls. |
| 170 | Onboarding belongs to the installation project: the welcome appears while no project exists or while the installation project still requires it, an acknowledgement names the project the tour ran for, and a restart reads the acknowledged state back. |
| 171 | A WorkItem's Apollo-owned workspace tab order interleaves Details, documents, and terminals across reload, close and reopen, dormant periods, and newly visible tabs. |
| 172 | Workspace tabs stay locked until their saved order loads, then show horizontal drag placement, suppress only the drag's own trailing click while a deliberate Changes click or keyboard activation still lands at once, serialize saves, retain the active tab in view, commit desktop drags that end without a drop event, and roll back a failed optimistic save. |
| 173 | Live-terminal cycling reads each candidate WorkItem's Apollo-owned saved order, including workspaces that have not been opened, before selecting the next terminal. |
| 174 | When this data directory’s MCP socket cannot start, Studio remains usable with a visible agent-launch warning. Local shells remain available, restart retries listener startup, and acknowledgement does not claim to continue without MCP. |
| 175 | A hidden Module tab stays hidden after the Apollo cache is rebuilt from the authoritative project read. |
| 176 | Agent activity does not reopen a hidden Module tab. |
| 177 | When every Module tab is hidden, the footer opens Module Manager, hidden rows keep lifecycle status, and explicit Restore reveals a tab without selecting it. Inspection writes nothing; explicit Open selects the restored tab and closes the manager. A project with no Modules offers creation instead of recovery copy. |
| 178 | While a native Ghostty view is engaged, only its live focused surface receives Ghostty-bound Command keys such as `Cmd++`; unbound application commands stay with AppKit, and retained or tearing-down viewers cannot query stale surfaces. |
| 179 | Cmd+1 through Cmd+9 and Cmd+Shift+0 select the same canonical visible Module positions from WebView and focused native Ghostty input; hidden and archived Modules consume no position, and native keyboard engagement clears held-Command badges. |
| 180 | Cmd+Escape from the live focused native terminal and the WebView leave typing through the same transition exactly once, return focus to the current zone, preserve the open terminal and workspace selection, ignore disposed viewers, and do not steal modal focus. |
| 181 | Root tasks reorder through GraphQL; expanded branches hide during drag and return after Escape cancellation without a write or after a successful drop. |
| 182 | Imported root tasks with equal ranks still send deterministic reorder neighbors. |
| 183 | A Module tab wraps its label and lifecycle chicklets, reserves constant space for the close button, and keeps its close hover background compact. |
| 184 | Story Changes stays inside the story pane, shows only its files and selected diff in two resizable columns, and never loads other worktrees; module Changes reuses the same two-column review. |
| 185 | A task workspace restores Details and explains the state when its worktree disappears. |
| 186 | One caught-up project feed selects one guarded launch's terminal from its authoritative update, defers viewer attachment until runtime acknowledgement, and never needs a second click, subscription, or reconnect. |
| 187 | Worktree identities appear before module files finish loading, stay cached on file refresh, and converge after worktree creation/deletion. |
| 188 | The worktree switcher lists checkout identities and branches and reuses the list when navigating module and task rows without a write. |
| 189 | Module Changes distinguishes an unavailable module checkout. |
| 190 | Task Commit and Push remain independent, and Push excludes dirty work. |
| 191 | Module Push is offered for a clean ahead branch while Commit requires dirty work. |
| 192 | Task Create PR preserves clean post-commit state and Open PR when the final status refresh fails. |
| 193 | A rejected task Create PR remains retryable. |
| 194 | Task Create PR requires committed work. |
| 195 | A module-checkout pull request targets the default branch without changing a Work Item. |
| 196 | The module default branch has no pull-request action. |
| 197 | Every mapped pull-request state exposes only its safe actions. |
| 198 | Closed pull requests can be replaced with explicit follow-ups. |
| 199 | Merge preparation launches only after a click and reports refusal. |
| 200 | Cleanup blockers explain why removal is unavailable. |
| 201 | Cleanup confirmation keeps a partial failure retryable. |
| 202 | Conversations replaces Scratch, gives each conversation row its own Agent Run lifecycle badge, and selects its exact terminal. |
| 203 | Conversations settings persist edits and clearing of the starter prompt without exposing the retired auto-close control. |
| 204 | Past Agent Runs remain independently resumable. |
| 205 | A cold Changes restoration clears when the resolved worktree has no checkout. |
| 206 | Browser update checks defer quietly to the desktop application. |
| 207 | A collected Crash Report does not add a Crash Notice, banner, or file prompt to Studio. |
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
| 228 | A retained live terminal viewer restores without rebuilding or reattaching it. Covered by the combined case 67 test after CODING-1487 retired the Ghostty WASM renderer. |
| 229 | Task badges omit terminal history and quietly announce newly lost runs. |
| 230 | Codex alternate-screen scrolling uses durable terminal history without sending cursor-key input to Codex. Covered by the combined case 232 test after CODING-1487 retired the Ghostty WASM renderer. |
| 231 | Run agent selects its terminal from the authoritative status event before launch returns, then attaches its viewer only after runtime acknowledgement. |
| 232 | Native Ghostty sends key presses directly to the terminal, routes captured wheel gestures to their program, and keeps ordinary shell scrollback in tmux. |
| 233 | Normal native Ghostty terminals present above WebKit with input enabled so click-drag selection works immediately; the WebView-underlay comparison remains opt-in. |
| 234 | The opt-in WebView-underlay comparison coordinates retained native Ghostty terminals through one generation-fenced window selection. |
| 235 | Native Ghostty warm retention caps the total mounted set at the measured 20-view limit, keeps the selected run, refreshes recency on revisit, and evicts the least recently viewed inactive viewer. |
| 236 | A bottom-left toast stays outside the selected native Ghostty host and above the Studio footer and safe areas; stacked notifications remain actionable without lowering, detaching, recreating, or focusing the terminal. |
| 237 | The footer Module Manager entry remains outside the horizontal tab scroller, while module creation sits after the last module tab and scrolls with the tabs. |
| 238 | An authoritative snapshot that reports an agent run exited closes its mounted terminal tab and clears the local terminal session. |
| 239 | Module Changes appears in the top strip with a version-control symbol, stays disabled without a selected Module, and is absent from the footer. |
| 240 | A newly captured Story appears first in its issue type's initial workflow state while creation is pending and remains first after the authoritative persisted result replaces it. |
| 241 | Normal desktop development and packaged builds select embedded native libghostty by default and link and ship the pinned library and ESC CR Shift+Enter prompt binding; browser development selects xterm; development-only renderer overrides remain, and packaged builds ignore them. |
| 242 | Development builds can compare three Conversations designs in the real Stories pane; each makes New chat obvious, caps the initial list at ten, and expands or hides the remaining chats. |
| 243 | A workflow launch binding accepts free-form Stage skill tags on Enter or blur, ignores blank and duplicate normalized names without splitting spaces or commas, reloads saved tags, and uses accessible removal to persist each resulting list, including empty after the final tag is removed, through the existing binding upsert and save-error handling. |
| 244 | Incoming and outgoing workflow transition rows show and save each edge's handoff setting. |
| 245 | A fresh bound launch passes one composed prompt, including any Stage skills, in provider argv and submits no follow-on skill command; a handoff submits the same composed destination prompt once to the live agent. |
| 246 | An untouched launch-configuration form follows canonical binding changes instead of retaining a stale mounted snapshot. |
| 247 | A transitioned Story stays first in its destination state while the update is pending and after the authoritative result replaces it. |
| 248 | Changing the selected Story writes its dirty description draft, opens the new Story's saved description in the always-live editor, and keeps later description updates bound to the new Story. Story names and Details descriptions share sans-serif typography at regular weight. |
| 249 | Resuming one stopped terminal conversation opens and focuses one successor while every unselected stopped conversation stays independently resumable through holding refreshes and reload. |
| 250 | The Stories pane says whether an automated transition continued the Story's live agent session or started a fresh one, and follows the newest delivery across the rolled-up subtree. |
| 251 | The + Agent launcher follows every workspace tab inside the shared horizontal scroller and opens the same provider picker used by Cmd+Enter instead of an inline dropdown. |
| 252 | Opening the manager focuses search; row arrow keys move inspection focus without snapping back, and Enter explicitly opens a visible module. |
| 253 | Edit-view keyboard navigation reaches the + Agent launcher after the final workspace tab and opens it with Enter. |
| 254 | Focusing an agent reveals its selected Story by expanding the containing status group and all ancestors, clearing a hiding search, and scrolling the row into view even on repeated pad presses, while keeping terminal typing focus. |
| 255 | Novation pads exclude instant chats and historical failures on startup, retain newly observed failures until acknowledged, and show running in white, stalled in red, done in green, and permission requests in flashing white. |
| 256 | Module Changes owns horizontal overflow below the workspace pane so checkout actions and files remain reachable in a narrow pane. |
| 257 | Dormant workspace chips stay within their own bounded vertical scroller so accumulated closed documents and past runs cannot squeeze the active workspace tab. |
| 258 | A long Details body stays reachable through the selected workspace's single vertical scroll owner. |
| 259 | A selected non-Codex conversation never requests a thread title; a provider Terminal Issue Investigation title reaches the selected conversation and row across refetch/reselection and workspace reopening, while missing, blank and failed reads retain safe/accepted titles without manual-title writes or identity changes. |
| 260 | The + Agent launcher warms the provider catalog while it is on screen, so the first agent picker of a session opens on a usable provider list instead of an inert "Loading providers…". |
| 261 | A settled Codex conversation selection refreshes its title once on first selection, return, and startup restoration; rapid selection changes coalesce, while visibility changes and terminal focus do not read titles. |
| 262 | Implementation launch configuration and transitions survive optimistic ticket creation, issue-type metadata updates, and reopening the state editor. Covered by the combined case 246 test. |
| 263 | An open Implementation editor follows authoritative Apollo workflow updates without retaining a stale snapshot. Covered by the combined case 246 test. |
| 264 | A selected Codex conversation keeps its safe title while the title reader is unavailable, then refreshes the row, header, and terminal tab once its resident reader restarts. |
| 265 | An obsolete document response cannot replace newer content or edits made while a reload is pending. |
| 266 | A cross-module Work Item move received from another client refreshes both the source and destination module collections. |
| 267 | Workspace focus, task selection, and status cursors leave pending dialogs and toasts intact without notifying their stores. |
| 268 | Matching mutation/event timestamps skip duplicate refreshes while distinct sub-millisecond external edits still converge. |
| 269 | Desktop builds render terminals with embedded native libghostty and browser development renders with xterm over the WebSocket adapter; the archived Ghostty WASM renderer is absent from source, build hooks, and selectable overrides. |
| 270 | Queued native terminal commands are ignored after their view is detached. |
| 271 | A long task Changes page scrolls through one workspace owner. |
| 272 | Long module Changes columns remain bounded with one scroll owner per column. |
| 273 | Module Changes columns stay inside the workspace without horizontal overflow. |
| 274 | Dormant chips remain in a bounded scroll owner above the active tab. |
| 275 | Refresh restores run status through a unique subscription identity; refused subscriptions retry. |
| 276 | An explicit agent selection overrides remembered Details on the first press, and clicking a terminal tab engages its keyboard input. |
| 277 | Native terminal selection transfers input ownership from the WebView before requesting first-responder focus, including repeated programmatic selection. |
| 278 | The run status snapshot carries live runs only: a terminal outcome updates its run in place through the run's own event, a run the snapshot omits leaves the live holding without being presented as exited, and each snapshot costs one summary log record instead of one per run. |
| 279 | Opening a Story restores its ended runs from the generated WorkItem-to-AgentRuns read: a run is restored because it still has a terminal session record and not because it ended recently, a Story whose ended runs have no record restores none, and a run the event already settled stays one chip because both paths share the AgentRuns cache identity. |
| 280 | A module scratch workspace restores its ended plan, instant, and shell runs from the module WorkItem that owns them, across a reload and with an empty live holding; a module whose ended runs have no terminal session record restores none, and a run the event already settled stays one chip. |
| 281 | Reopening a restored ended run works from either surface: clicking an ended instant Conversation row opens its terminal in the scratch bucket instead of falling back to Details, because run resolution reads the shared AgentRuns cache entity the WorkItem restore retains rather than the live-only holding. |
| 282 | A selected instant conversation whose run has already left the live holding is still titled: eligibility comes from the module WorkItem ended-runs read, so a Codex conversation that ended keeps refreshing its thread title. |
| 283 | Success, info, and error toasts paint an opaque panel beneath their lifecycle tint. |
| 284 | A failed description save after switching Stories retains the draft for retry, including when the user returns before the failure arrives. |
| 285 | Moving a Story through the sidebar refreshes both the source and destination module, including a previously cached empty destination. |
| 286 | Same-Story description writes are serialized so the newest draft persists last. |
| 287 | Details shows its rendered description before shared rich-editor code warms after a frame; the editor mounts in place once that code loads, with no click and no second load. |
| 288 | Bootstrap preserves remembered Story and scratch document/run targets and tab state; legacy Changes targets retain the existing Details migration. |
| 289 | Studio opens from the initial ready configuration when backend startup finishes before the WebView subscribes to health events. |
| 290 | Module fetching and hierarchy derivation stay shared as more Stories rows mount; normalized nonstructural task updates refresh their row and selected Details without rebuilding the module tree. |
| 291 | Declining folder trust preserves the current module selection and its links; retrying with approval saves the requested folder once and resumes selection. |
| 292 | An already-trusted folder links and resumes module selection without another trust prompt. |
| 293 | Changing a module folder preserves its existing cached link and blocks completion until native trust setup finishes. |
| 294 | Terminal folder recovery shows a retryable trust failure, preserves the existing link, and reopens the shell only after trust succeeds. |
| 295 | Cancelling folder trust and Add Module creates no module, preserves first-module guidance, and allows a later successful creation. |
| 296 | Native trust failure leaves module creation retryable without saving a module; retry completes once the folder is trusted. |
| 297 | Model configuration trims and deduplicates registered Codex profile names, persists add/remove changes, and makes a selected global profile clear and disable model and reasoning overrides. |
| 298 | A workflow launch binding saves, reloads, replaces, and clears a Codex profile while preserving removed registry names as unregistered selections. |
| 299 | Native terminal zoom uses the application window's zoom-in, zoom-out, and reset hotkeys without moving focus or selecting a module. Native font size follows the WebView viewport scale; xterm scales with the WebView without a second font adjustment. |
| 300 | Module-folder trust confirmation names the canonical directory and every Codex, Gemini, and Claude provider that needs approval; cancellation preserves the old link. |
| 301 | A directory already trusted by Codex, Gemini, and Claude saves without another confirmation or provider write. |
| 302 | Provider denial and inspection failure are reported without confirmation or a Module-link write. |
| 303 | Replacement inspects provider trust, prepares approved trust, and only then saves the Module link. |
| 304 | A partial provider success remains trusted; retry asks only for the provider still needing trust and saves once. |
| 305 | Browser Module-folder setup keeps its existing behavior and performs no provider trust work. |
| 306 | A canonical-directory or pending-provider change after consent requires a fresh confirmation before any provider preparation. |
| 307 | Long truncated patches remain readable below the file list without wrapping their contents. |
| 308 | Worktree creation finishes before Studio requests provider trust for the canonical external checkout and names every pending provider. |
| 309 | An already-trusted recovered Worktree needs no confirmation; refusal keeps that checkout and exposes trust retry without another create or another prompt when its details reopen. |
| 310 | Partial Worktree trust survives provider failure, and retry prepares only the remaining provider against the same checkout. |
| 311 | Instant conversation rows react to their own Agent Run lifecycle changes without leaking activity across runs or modules. `starting`, `working`, `permission_required`, `reconnecting`, `needs_input`, `turn_complete`, `error`, `stalled`, and `quiet` show the eligible badge with count-one semantics; absent, `unknown`, `exited`, and `lost` states show none. The Conversations heading and New conversation show no lifecycle badge. |
| 312 | The Conversations heading configures host-wide conversation defaults in the retained right workspace, including with zero chats. Close and repeated activation restore the prior workspace without launching a run, opening a modal, writing settings, or replacing terminal identities. |
| 313 | Conversation settings report load and save failures without false success. A failed save keeps its draft for retry, and Discard restores the last loaded or saved prompt and auto-close values. |
| 314 | Task Changes defaults to the origin branch and checkout, offers searchable branches in latest-commit order, and previews a selected destination without a Git write. |
| 315 | Task Changes binds and runs a confirmed local fast-forward, keeps one operation identity across retry, and refreshes affected Apollo views on failure and success. |
| 316 | Task Changes reports a completed divergent merge and refreshes affected checkout summaries. |
| 317 | A conflicting local merge lists its unmerged files and destination checkout and remains recoverable after restart even when subsequent source edits block a new merge. |
| 318 | Finish merge commits only the explicitly staged resolution after confirmation and stays retryable after hook failure. |
| 319 | Abort merge targets the matching operation, preserves recovery after refusal, and reports completion truthfully. |
| 320 | Restart recovery reports merges finished or aborted outside Ticketry without stale controls. |
| 321 | Finishing or aborting a conflicting merge retires its recovery state and gives the next merge a fresh operation identity. |
| 322 | Committing dirty source work refreshes local merge eligibility and enables Merge without reopening Changes. |
| 323 | Refreshing merge eligibility after an external destination fix enables Merge without reopening Changes. |
| 324 | A rejected cross-module Work Item move shows the backend worktree instruction, keeps the module picker open, and rolls the optimistic parent change back to the original module. |
| 325 | A completed instant run whose tmux session is already gone presents a calm Conversation ended state instead of a Session lost error. |
| 326 | Moving Ticketry between displays republishes each presented native terminal frame on window movement and display-scale changes, so the native view cannot drift over the module tabs and intercept their drag gestures. |
| 327 | Recovery from a Claude version-inspection failure reuses the existing Worktree, still requires provider approval, and does not create another checkout. |
| 328 | Rapid Stage skill additions wait for the prior save and workflow refresh, then persist the latest tag list with the refreshed revision. |
| 329 | Removing a Stage skill while its addition is saving waits for the workflow refresh, then persists the empty selection with the refreshed revision. |
| 330 | A saved Changes workspace target without a Back origin migrates to Details. |
| 331 | Saved workspace-tab order drops the retired Changes tab on read and write. |
| 332 | Changes opens independently, and Back restores the exact planning origin and active session. |
| 333 | If the planning origin disappears, Back returns to the same module's conversation Details workspace. |
| 334 | Back stays usable while Changes is loading or reports an error. |
| 335 | Selecting a task checkout marks it selected and keeps Back usable while fresh task changes load. |
| 336 | The branch inspector starts closed, opens from the toolbar, and closes again, leaving files and diff as the only review surface. |
| 337 | The task Agent picker offers Terminal and opens a plain module shell in the terminal panel without launching an agent run. |
| 338 | Clicking the open module picker trigger closes its portalled dialog without reopening it during the focus transition. |
| 339 | A persisted subtree campaign with a live descendant replaces both launch actions with lifecycle status and Open, blocks Cmd+Enter, keeps Run item, and restores launch actions after completion. |
| 340 | A stale subtree launch refusal refreshes the persisted campaign into status/Open without retrying execution. |
| 341 | The live Changes toolbar checkout switcher clamps arrow navigation, supports Home/End and Enter/Space, cancels to its trigger with Escape, and follows checkout identity across refresh and removal. |
| 342 | The diff keeps one named keyboard reading region focused while rendered content replaces its fallback. |
| 343 | Diff reading keys scroll real overflow without activating another control. |
| 344 | The panel-library separator remains a visible keyboard resize stop. |
| 345 | File selection stays explicit per checkout, and Previous and Next wrap without moving focus. |
| 346 | Empty, binary, truncated, and rendered diff content keep the same named reading region. |
| 347 | A failed diff load keeps the named reading region stable and usable. |
| 348 | File-list arrows traverse visible rows, while activation alone changes selection or disclosure state. |
| 349 | File focus follows path identity across refresh, removal, directory collapse, and an empty-list fallback. |
| 350 | Local-merge recovery confirmation focuses Cancel, nests Escape correctly, and submits once by keyboard. |
| 351 | Branch opens on Close, nested Escape returns to Branch, and collapsing a disclosure recovers focus to its summary. |
| 352 | The primary Changes confirmation opens on Cancel, Escape cancels, and focus returns to its enabled opener. |
| 353 | The primary Changes confirmation submits once, locks cancellation while pending, and never steals focus after departure. |
| 354 | Cleanup confirmation focuses Cancel, nests Escape, respects pending restrictions, and submits once. |
| 355 | Closing the Branch inspector after opening Changes from a task tab returns focus to the visible Branch button while the planning copy remains mounted. |
| 356 | Changes-only checkout and file-list keys stay out of planning capture, and shortcut help labels every Changes action instead of showing raw action IDs. |
| 357 | Changes has a top command section and a bottom review section: Left/Right moves between enabled toolbar controls, Down enters the selected or first file, Right on a file focuses the diff, Left on an unscrolled diff returns to files, Up on the first row or at the top of the diff returns to commands, and directory rows keep their disclosure keys. |
| 358 | Module folder trust names and inspects only the providers the user activated. |
| 359 | A module folder saves with no trust prompt when no provider is activated. |
| 360 | The state picker offers only workflow destinations configured from the current state. |
| 361 | A missing-folder module keeps the same mounted Idea entry and unsent draft while Module Manager covers the workspace and restores it on close; covered input is inaccessible. |
| 362 | Provider onboarding allows planning without a provider and persists an empty provider catalog. |
| 363 | After an interrupted tour, zero providers remains a valid choice through resume, skip, and restart. |
| 364 | A user can create, read, and edit a work item with no active provider or agent launch. |
| 365 | The production bundle initializes workspace navigation without a circular-import crash that leaves the desktop window blank. |
| 366 | A planner completes zero-provider onboarding, receives launch guidance, activates a provider in Model configuration, and launches only after an explicit retry. |
| 367 | A refused New conversation shows provider guidance without opening a conversation tab. |
| 368 | Keyboard binding controls expose default, customized, unassigned, and recording states in their accessible names. |
| 369 | An unmatched story search names the query, explains when the selected story remains open outside the filtered results, and clears without losing selection. |
| 370 | Finishing zero-provider or selected-Codex onboarding keeps the real created module and selected Story visible immediately and restores both from retained server state after reload without returning to welcome or leaving guidance behind. |
| 371 | A delayed onboarding acknowledgement keeps the final guidance and selected Story usable, blocks duplicate Finish requests, shows one failure for retry, then completes without a welcome flash and restores the same Story after reload. |
| 372 | Welcome introduces Ticketry before provider setup; with zero or selected providers, the Story example leaves the real idea field empty, creates no sample Story or execution request, and Enter captures only the user's Story. |
| 373 | A saved Story opens its persistent, read-only workflow guide from Details and closing it creates no run or state write. |
| 374 | The guide shows only configured workflow stages and actual branching destinations, including the current state. |
| 375 | Custom stage names and configured instructions appear as inert text without adding absent familiar stages. |
| 376 | A current Story state outside the configured workflow is marked honestly and has no invented outgoing transition. |
| 377 | Provider activation, stage binding, and entry auto-start are distinct facts beside the existing launch-control explanations. |
| 378 | With zero activated providers, the guide gives a useful manual Details step and points to later Model configuration without launching. |
| 379 | Scratch conversations and module-only selections have no Story workflow guide trigger. |
| 380 | The guide contains keyboard focus, closes with Escape, and returns focus to its surviving trigger. |
| 381 | A failed workflow read shows an accessible error and Retry without substituting default stages. |
| 382 | Open guidance follows workflow revision, Story state, and provider changes from live cache updates. |
| 383 | Selection changes discard prior Story guidance, and deleting the Story closes its guide. |
| 384 | A renamed familiar stage receives the custom-stage explanation and an expandable empty-instructions message. |
| 385 | While workflow details load, manual next-step and launch-control guidance stays visible without a fabricated workflow. |
| 386 | Real first-Story capture teaches the Details planning step and states that saving does not launch an agent. |
| 387 | Zero-provider and activated-provider handoffs offer appropriate next steps; the shared guide temporarily replaces the coach mark and restores it without acknowledging or launching. |
| 388 | After tour completion and completed-state bootstrap, the selected Story's Details toolbar reopens the same guide without restarting onboarding. |
| 389 | A workflow read failure in optional help does not block project-owned Finish tour acknowledgement. |
| 390 | An activated provider with a current-stage launch binding receives Run item guidance with explicit executable, login, profile, and backend-readiness limits. |
| 391 | Model configuration offers GPT-6 Sol and Luna for Codex, and a selected model saves as the launch default. |
| 392 | Background automation Claude folder-trust attention stays passive and opens the original run's terminal without changing the pending attempt; activity clears its action. |
| 393 | Reloaded startup attention retains the generic guidance and the original run identity without alleging trust failure. |
| 394 | A Plan run's Claude trust attention remains passive and opens its existing terminal. |
| 395 | An Instant run's trust action reattaches the persisted run after the terminal store is cleared. |
| 396 | A desktop Run item refusal returned as the bare `no_activated_providers` code shows provider activation guidance and does not open a terminal. |
| 397 | A rejected current-worktree list shows its alert inside the checkout switcher, which still opens and switches to the module checkout. |
| 398 | A merge precondition blocker reports the original error without offering conflict recovery for a merge that never began. |
| 399 | An unverified worktree origin leaves the merge destination empty and requires an explicit local branch choice before showing an eligible preview. |
| 400 | Stories with children hide Run now and ignore R; a stale subtasks refusal explains why launch failed. |
| 401 | Run now from the button or R converts the same Story to Implementation in Implement, and Details and the Stories list show the new type and state without a reload, including after a committed late-launch failure. |
| 402 | Cmd+W closes the selected agent run from an engaged native terminal or a typing WebView terminal, while a stale native viewer cannot close another run. |
| 403 | Tab from prose in the compact rich description remains available for browser focus traversal. |
| 404 | Tab within a compact rich description list still indents the list item. |
| 405 | A stacked task action that commits and pushes but fails PR creation shows the provider error and retries Create PR without another commit. |
| 406 | Conversation and work-item selection, module switches, and project switches exit Conversation configuration; conversation selection opens that run's exact terminal session. |
| 407 | Model configuration offers GPT-6.1 Sol for Codex with low through ultra reasoning and keeps the saved launch default on reopening. |
| 408 | Restores the exact origin after selecting a story in another module. |
| 409 | Starts a planned sprint when the project has no active sprint. |
| 410 | Completes an active sprint with unfinished stories carried to a planned sprint. |
| 411 | Creates a named sprint and opens it in Plan. |
| 412 | Shows lifecycle cards, counts finished stories and opens a planned sprint. |
| 413 | Waits for the refreshed planning graph before opening a newly created sprint. |
| 414 | Keeps a newly opened completion dialog when an older start request finishes. |
| 415 | External archive facts remove assigned Stories and update sprint counts and an open completion preview with one planning request per project batch. |
| 416 | External creation facts insert assigned Stories into sprint rows, counts and the completion preview. |
| 417 | External sprint assignments refresh canonical sprint membership even without a collection membership flag. |
| 418 | Reopening a cached planning view after external creates and archives fetches the current filtered collection. |
| 419 | Epic changes and deletions update planning groups. |
| 420 | Planning fact convergence refreshes only the affected project's active planning views. |
| 421 | External Story deletion removes its row and updates counts and the completion preview without fetching the deleted entity. |
| 422 | Suggestion accept and Undo return the generated issue relation and await authoritative planning and suggestion collections, including closed views. |
| 423 | Suggestion dismiss and Undo converge in Apollo; rejected transitions preserve waiting suggestions and actionable server errors. |
| 424 | Typed sprint execution stays on the sprint card with progress, Cancel, ready count, Review, staleness and Retry. Launching creates no Conversation or terminal tab and preserves the current workspace and focus. |
| 425 | A desktop planner bind failure retains its address and application log, offers normal quit/reopen guidance and Settings, and does not offer unsupported Retry. |
| 426 | A recoverable runtime offers Retry and reports a rejected recovery command while preserving the original planner diagnostic, log, and Settings access. |
| 427 | Goal-scoped typed suggestion launches preserve the workspace and return the run identity persisted by agent_execution_create. |
| 428 | Changed goals replace an old failure message; an active execution remains cancellable while goals change. |
| 429 | Reopening a sprint card restores completed suggestion counts and failure reasons from persisted execution records. |
| 430 | Pending launches disable repeated starts and show a rejected launch reason without changing the workspace. |
| 431 | Card status uses the sprint's persisted run identity and prevents launching while that execution is unavailable. |
| 432 | Initial agent-status loading, failed reads, and missing goals prevent launching from incomplete card data. |
| 433 | Dismiss and Undo await the completed card's authoritative ready count, including cached cards that are closed and reopened. |
| 434 | adds, steps and closes epic tabs while preserving the sprint's visit |
| 435 | offers real new epic creation and reports missing project type before a write |
| 436 | creates an epic once through the model write and opens its returned identity |
| 437 | waits for suggestions before seeding and supports roving tab focus |
| 438 | keeps waiting suggestions visible in the add menu after closing their epic |
| 439 | shows sprint-wide counts, the sprint name on hover and read-only goals with separate back and Done actions |
| 440 | directs an empty backlog to + Add epic, focuses one epic while keeping every sprint story visible, and finishes the epic from the backlog's end with a next cue |
| 441 | opens a suggested story from its row without accepting it |
| 442 | renders the unchanged story detail below its suggestion reason and removes the banner for a ticket |
| 443 | opens selected tickets, moves with buttons and Alt arrows, and dims other epic stories |
| 444 | optimistically assigns, blocks another view's duplicate, and restores the cache after failure |
| 445 | opens the next planned sprint when the cold planning graph arrives |
| 446 | keeps the sprint list after explicitly cancelling the cold default |
| 447 | leaves the old project's workspace without restoring its origin over a new selection |
| 448 | adds two numbered goals with Enter and removes one |
| 449 | keeps a failed goal draft and lets Escape cancel it |
| 450 | offers no goal changes on completed sprints |
| 451 | opens a suggestion's moduleless story in the first visible module |
| 452 | Leaving and reopening the same story ignores the prior request's completion. |
| 453 | Plan and module-scoped Changes precede module tabs; selecting a module leaves both surfaces. |
| 454 | Plan owns the full width, preserves the saved Stories/workspace split and mounted module workspace, and restores them on exit even when opened without a selected module. |
| 455 | Arrow keys, Home and End retain workspace-tab focus across Plan, Changes and modules after the real checkout switcher mounts and animation frames settle; explicit Enter/Space still enters Changes (case 332). |
| 456 | Plan opens project-wide in a project with no modules; Changes stays disabled. |
| 457 | Plan waits for waiting suggestions before offering an epic to finish. |
| 458 | Each sprint restores its chosen tabs and active epic after leaving Plan. |
| 459 | Plan owns epic shortcuts and Escape while preventing module navigation from consuming its keys. |
| 460 | Bare Escape leaves the Plan sprint list and refocuses its workspace tab; modified Escape stays in Plan. |
| 461 | Waiting suggestions without an epic can be selected, closed and reopened from Add epic with matching counts. |
| 462 | Failed status reads have a dedicated Retry that preserves cached results, blocks duplicate retries and never launches another agent. |
| 463 | Leaving the card for Plan during a run observes completion; a failed result refresh can be retried and a moduleless suggestion reviewed and dismissed. |
| 464 | Removing a selected epic moves its stories and waiting suggestions to the selectable No epic group with matching counts. |
| 465 | A new sprint starts with the last visited sprint's selected epics and active epic; an untouched sprint starts empty. |
| 466 | Creating an epic from the tab menu focuses it and restores each sprint's planning visit. |
| 467 | A conversation's first title click selects its terminal; clicking its selected title opens a focused editor for that row. |
| 468 | Enter and blur save trimmed conversation titles without changing runs, terminal sessions, selection or other rows. |
| 469 | Escape cancels a conversation rename and subsequent blur does not save it. |
| 470 | Blank conversation titles are rejected locally while keeping the draft editable. |
| 471 | A failed conversation rename keeps its draft and can be retried without changing another row. |
| 472 | Conversation title editors retain focus and selection through input clicks, arrow keys and composing Enter. |
| 473 | Saved conversation titles override older provider responses and remain shared across refetch and workspace reopening. |
| 474 | A pending conversation rename saves once and updates its original run after selection changes. |
| 475 | A delayed conversation list response containing an intermediate saved title cannot overwrite a successful rename back to the original title in either the list or workspace. |
| 476 | Stories starts on the resolved Active sprint; All and No sprint change results without assigning work. |
| 477 | Sprint filtering retains whole eligible branches, combines Story search, and keeps excluded Details open when other roots match. |
| 478 | The sprint chooser owns arrows, Enter, Space and Escape ahead of shell navigation and returns focus to its trigger. |
| 479 | Sprint-only collapse remains usable; collapsed children do not show exclusion notices, and drag returns only with All and empty search. |
| 480 | Unresolved sprint loading and read failure are distinct from empty results; Retry preserves Story search. |
| 481 | Normalized sprint membership and optimistic rollback repaint Stories and counts without reopening the module. |
| 482 | Sprint choices count roots in unopened modules while Stories summaries stay module-scoped; recovery clears only its own axis. |
| 483 | Explicit sprint selection survives local start/completion and transient lookup errors; successful scoped deletion or foreign-project lookup recovers to All. |
| 484 | Planned and Completed independently page five sprints with correct totals, pinned controls and retained pages across switches/reopen. |
| 485 | Debounced sprint-name search reaches unloaded project history, keeps Active pinned and clears independently of Story search. |
| 486 | Failed pages preserve options and retry focus/offset; duplicate Load more requests are suppressed. |
| 487 | Section and paginated keyboard controls own focus, announce appended choices and permit normal Tab exit. |
| 488 | Sprint tabs exclude hidden modules and share canonical order with number shortcuts; Close tab remains enabled while sprint-restricted, writes presentation only, and reorder returns only under All. |
| 489 | Plain manager inspection preserves hidden preferences and sprint intent; explicit Restore opens an eligible hidden tab, and an explained Open action clears the filter before selecting an excluded module. |
| 490 | The module picker keeps Show all sprints reachable by keyboard with zero matching tabs. |
| 491 | Zero matching modules deselects the module and keeps the project sprint chooser and All recovery available while module-bound UI stays hidden. |
| 492 | Unknown membership uses ordinary visibility; hidden tabs remain hidden through complete membership and a transient refresh failure, with Retry available. |
| 493 | Truncated membership cannot close ordinary tabs or produce false zero matches; Retry recovers complete membership while preserving hidden flags. |
| 494 | Zero-module recovery preserves native Story and shell viewer mounts, document frame, session identity and leases without terminating work. |
| 495 | A late module-tree completion cannot restore selection after its project/filter generation becomes obsolete. |
| 496 | An unlinked fallback prompts once; cancellation keeps sprint tabs and controls reachable, and stale folder resumption cannot restore an excluded module. |
| 497 | Plan and Changes defer sprint fallback until return; fallback restores the remembered Story while eligible selection remains intact. |
| 498 | Opening Plan during a pending module fallback defers remembered-Story restoration and resumes it on return without replacing newer navigation. |
| 499 | A late project load cannot restore an old project's module or error over the current project selection. |
| 500 | A normal macOS desktop launch requests microphone access for terminal voice mode once, with a purpose string and signed audio-input entitlement; automated startup runs do not prompt. |
| 501 | The selected conversation's focused rename button retains native Enter and Space activation ahead of the production global keymap with both legacy visibility values, without entering its terminal. |
| 502 | Outside the rename control, arrow keys still select conversations and Right or edit-view Enter still reaches the selected terminal. |
| 503 | A structural fact already consumed for canonical adoption still refreshes unopened module roots, matching tabs and project option counts. |
| 504 | External root archive/unarchive, deletion and root-to-child/child-to-root reparenting update unopened module eligibility. |
| 505 | Local structural writes refresh root eligibility before their durable facts arrive. |
| 506 | Focus and chooser reopen refresh roots; a read error retains complete tabs and Story search, and Retry converges them. |
| 507 | Structural refresh evicts closed memberships only for the affected project; cached roots refresh on project entry. |
| 508 | An old project's late membership read cannot redirect or replace the current project's module. |
| 509 | Refreshing module identities before roots adds new modules and removes archived-module roots, including an authoritative empty module set. |
| 510 | Existing idea capture creates an unassigned root and offers Show all outside results while preserving Story search and selection. |
| 511 | Suggestion dismissal offers Undo through the restricted update and restores the waiting row. |
| 512 | Proposal acceptance Undo retains the created Story in the Backlog and restores an existing-story suggestion. |
| 513 | Explicit excluded-run reveal clears sprint restriction and Story search, selects the Story through the real shell and preserves agent typing focus and session. |
| 514 | Explicit module creation broadens to All only after canonical creation and folder setup, immediately before selecting the new module. |
| 515 | Cancelling module creation during pending folder setup preserves sprint intent and selection. |
| 516 | Failed folder setup preserves sprint intent while retrying the already-created module. |
| 517 | A late automatic fallback folder completion cannot undo explicit run reveal. |
| 518 | Revealing an eligible module-scoped run preserves the sprint selection. |
| 519 | A late canonical module creation across a project switch cannot reuse or select the old project's identity. |
| 520 | Canonical and optimistic existing-root membership repaint Story branches, project counts and unopened effective tabs together; rollback preserves authoritative membership and project isolation. |
| 521 | An authoritative no-active lookup uses All; project revisits preserve independent sprint intent and prevent foreign Story results. |
| 522 | An eligible module retains a deliberate empty Story selection through later sprint changes. |
| 523 | A folder completion from before Active changes away and back cannot restore an obsolete module. |
| 524 | Accepting an existing suggestion offers Undo and returns the Story to the Backlog. |
| 525 | Done with epic restores neighbor focus for roving keys or Add epic after the final tab closes, preserving waiting suggestions. |
| 526 | Public UUIDs and open epic visits survive collection refresh, proposal acceptance, Undo and reacceptance. |
| 527 | A compiled OFF app omits the Plan tab, workspace mounts and lifecycle surfaces from the full Studio shell. |
| 528 | Plan owns the full-width mounted Studio shell while retaining the migrated Stories/workspace split; Details remains mounted and the exact origin restores on Escape. |
| 529 | A sprint completion membership fact closes incoming controls and Undo while retained sprint work can still return to the Backlog. |
| 530 | Public Plan workspace, sprint and item entries refuse compiled OFF access while preserving module, Story, terminal and planning records. |
| 531 | Stale OFF Plan state cannot hide the workspace, own the footer, consume Escape, or block visible Changes/module and Details/document traversal and close. |
| 532 | The separate Plan a feature command and its agent Plan conversation flow remain available in a compiled OFF shell. |
| 533 | Runtime process environment, URL flags and saved settings cannot enable a compiled OFF Plan workspace. |
| 534 | Compiled ON exposes retained sprint goals, suggestions and lifecycle dialogs, preserves ordinary work on exit, and prevents Plan-owned close commands from reaching hidden documents or terminals. |
| 535 | Native host close and module-position events preserve their ordinary owner despite stale OFF Plan state; an obsolete native host cannot close the selected terminal. |
| 536 | Inline Story creation in the active Plan epic's Backlog preserves the ordinary create contract without assigning a sprint. |
| 537 | Inline Story creation can assign work to an empty sprint pane without leaving the new Story in the Backlog. |
| 538 | A rejected inline Story create preserves an editable draft and retries only on another explicit submission. |
| 539 | A created Story and its draft survive epic close/reopen, while retrying sprint assignment does not create another Story. |
| 540 | A failed view refresh retries reads without repeating successful Story creation or assignment. |
| 541 | A committed lost Story-create response is inspected through reads instead of blindly creating again. |
| 542 | Empty and repeated pending submissions are ignored; focus returns and Escape cancels only the draft. |
| 543 | Inline creation requires an active epic and remains disabled for completed sprints. |
| 544 | An obsolete visit creation cannot overwrite a fresh Plan visit draft. |
| 545 | A committed sprint refresh retries without creating another sprint. |
| 546 | Closing the project view during sprint create or refresh prevents stale navigation. |
| 547 | Proposal acceptance requires a nonblank title from both detail and row controls. |
| 548 | An edited proposal is accepted in one write and opens its real Story. |
| 549 | Bulk review adds only the active epic's waiting suggestions and preserves the selected ticket. |
| 550 | Proposal retry retains the edited title; failed Undo retries without creating another Story. |
| 551 | An accepted proposal's goal chip stays on its planned Story until Undo restores the suggestion. |
| 552 | Opening a proposal invalidates an older pending Story open. |
| 553 | A delayed proposal acceptance preserves a newer pending Story selection. |
| 554 | Accepting the final suggestion from its row keeps focus in the backlog. |
| 555 | Creating a proposal from its selected-ticket panel keeps focus in that panel. |
| 556 | Dismissing the last proposal from its panel returns focus to the backlog. |
| 557 | Closing proposal review returns focus to the reviewed suggestion. |
| 558 | Escape from the proposal input returns focus to its suggestion row. |
| 559 | Undo after panel dismissal restores the exact edited proposal draft. |
| 560 | Undo after list dismissal restores the exact edited proposal draft. |
| 561 | Removing suggestions focuses the next row, previous row, then backlog heading. |
| 562 | Delayed proposal acceptance preserves focus after the planner moves elsewhere. |
| 563 | Add all returns focus to the backlog heading when its batch disappears. |
| 564 | Banner acceptance keeps focus in the existing Story panel. |
| 565 | Removing an unfocused suggestion with a pointer leaves focus elsewhere. |
| 566 | An accepted proposal draft remains until its real ticket's module loads. |
| 567 | Escape, unchanged Enter and successful Enter return focus to the conversation rename button; the next activation reopens rename with the production keymap with both legacy visibility values. |
| 568 | Rename completion preserves focus elsewhere after blur, selection changes or a delayed save with both legacy visibility values. |
| 569 | Compiled OFF shows active, other-sprint and unassigned Story branches while preserving remembered sprint intent and selected Details. |
| 570 | Cold and failed sprint reads cannot delay OFF Stories or start hidden sprint membership indexing. |
| 571 | OFF retains ordinary Story hierarchy, workflow counts, search expansion and drag rules. |
| 572 | OFF explicit run reveal preserves remembered sprint intent and durable run identity. |
| 573 | OFF uses saved module order and hidden preferences for tabs, drag and number shortcuts despite retained sprint intent. |
| 574 | OFF ordinary module restoration completes when hidden sprint intent changes during a cold module read. |
| 575 | OFF all-hidden recovery uses explicit manager Restore without selection, then Open to select and close; ordinary picker restoration remains available. Inspection keeps folder/agent details but hides sprint membership. Only presentation visibility is written, with no sprint writes. |
| 576 | OFF unselected and zero-module workspaces retain generic recovery independently of failed sprint reads. |
| 577 | OFF Stories and the module picker omit sprint selectors, counts and recovery actions. |
| 578 | OFF text search keeps empty feedback, clearing and selected Story Details without sprint recovery actions. |
| 579 | OFF capture ignores remembered sprint intent and preserves ordinary text exclusion feedback. |
| 580 | OFF preserves documents, Conversations, terminal identities and planning records without neutralizing data or module preferences. |
| 581 | Escape closes the epic picker before leaving Plan, preserving the selected epic and returning focus to Add epic. |
| 582 | Closing the final epic returns focus to Add epic and leaves the Plan visit recoverable. |
| 583 | Keyboard Story moves retain next, previous and empty-pane focus while pointer moves preserve focus elsewhere. |
| 584 | A sprint card opens canonical public-UUID Story details outside the selected module and sprint filter, preserving filter intent. |
| 585 | Starting the first sprint through its dialog sends no carry-over destination and closes after the lifecycle mutation succeeds. |
| 586 | Active sprint idea capture remains unassigned, confirms exclusion and offers Show all recovery while preserving module/Story selection. |
| 587 | Explicit sprint selection keeps captured Stories unassigned and confirms capture outside results. |
| 588 | All sprints capture remains unassigned. |
| 589 | Rejected idea creation preserves the draft and module; repeated Enter while pending creates only once. |
| 590 | No sprint capture remains unassigned. |
| 591 | A pending capture stays unassigned when the filter changes before its response and uses the current results for confirmation. |
| 592 | Reopening the sprint chooser refreshes retained later-page names and membership while preserving loaded choices and counts during refresh. |
| 593 | A failed later-page refresh preserves retained sprint choices and counts; Retry refreshes those choices and Load more continues from the retained boundary. |
| 594 | Idea capture remains available and unassigned while the Active sprint read is loading. |
| 595 | Idea capture remains available and unassigned when the project sprint membership read fails. |
| 596 | A delayed provider title cannot rename another selected conversation; reselecting reads the original run and updates its title without manual-title writes or identity changes. |
| 597 | Capturing the existing Codex provider thread through a lifecycle event resolves the first request name in the selected conversation and row without refresh/reselection, manual-title writes or terminal identity changes. |
| 598 | A first terminal request name appears after its lifecycle refresh overlaps an earlier neutral provider read; later refreshes retain that request title. |
| 599 | A pending unavailable resident title read preserves the safe visible conversation and terminal; the normal service restart refresh accepts the first-request name with bounded reads. |
| 600 | Closing a selected sprint tab writes only tab_hidden, chooses an eligible fallback, preserves module records and canonical order, and persists through a fresh cache and shell reload. |
| 601 | A failed optimistic sprint Close restores the tab and prior selected module, keeps the sprint filter, and shows a recoverable error. |
| 602 | A delayed Close failure restores presentation while preserving newer filter intent and production number-shortcut navigation. |
| 603 | Explicit picker Restore unhides an eligible sprint module without clearing the current sprint filter. |
| 604 | Explicit Restore of an excluded hidden module clears the sprint filter before unhiding and leaves module selection unchanged. |
| 605 | Open refuses a hidden module and clears the filter before selecting an excluded unhidden module without a visibility write. |
| 606 | Open reports unavailable while folder linking still needs user action, rather than claiming a module was selected. |
| 607 | A delayed Restore completion cannot navigate after the user changes the sprint filter. |
| 608 | A delayed Restore completion cannot navigate after leaving and returning to the same project. |
| 609 | Deferred folder linking cannot reopen a module whose tab was explicitly closed while the prompt was pending. |
| 610 | Closing every matching sprint tab explains that matching tabs are hidden; explicit picker Restore recovers selection without clearing the sprint filter. |
| 611 | Opening Module Manager from the footer groups modules and preserves inspection, tabs, search focus and Escape focus recovery. |
| 612 | Archived module reads page within the project, retry failures and support search across collapsed archives without adding tabs. |
| 613 | Module Manager suppresses covered native terminal rendering and focus, then restores the same viewer and session. |
| 614 | Project visits invalidate a late Module Manager archive read before normalization or inspection. |
| 615 | Module Manager Restore preserves selection, Close changes only tab presentation, and opening outside the sprint explains the filter change. |
| 616 | A reopened Module Manager remains usable and keeps search focus when an older Open finishes loading; committed selection is retained. |
| 617 | Module Manager honors effective shortcut overrides, search caret keys, modal Escape precedence and group navigation with arrows and Enter. |
| 618 | Module Manager disables navigation while eligibility is incomplete and retries membership before restoring or opening a module. |
| 619 | Module Manager rolls back failed presentation writes, retries explicitly and ignores late completions after a project switch. |
| 620 | Reselecting a conversation before its earlier neutral provider read settles refreshes its first-request name in the row and heading after a lifecycle change while unselected, preserving manual-title ownership and run/thread identity. |
| 621 | Footer count and lifecycle attention include hidden active modules; manager entry remains safe for all-hidden and empty projects. |
| 622 | Manager takeover preserves the real Plan body, active epic draft and Changes surface through pointer entry, manager interaction and Escape; ordinary outside clicks still dismiss popovers after return. |
| 623 | Header and Open-group entry start the same inline module edit; caret keys stay with the field and Escape cancels editing before closing the manager. |
| 624 | Folder validation refuses an unusable directory before trust; cancelling trust creates no module and preserves the editable inline draft. |
| 625 | Folder-save and membership-refresh retries reuse one created identity, preserve it while editing, block duplicate submits, then clear sprint intent, select the appended module and update footer count. |
| 626 | Create failure preserves editable fields and retries only on explicit submission. |
| 627 | A creation completing after a project switch cannot save a link or select into the new project. |
| 628 | Cancelling during folder saving prevents late selection and closure of a reopened manager. |
| 629 | A sprint-filter change invalidates late creation navigation; explicit folder retry reuses the same created module. |
| 630 | Live-stream reset refreshes every inspection page without restoring hidden tabs or changing module selection. |
| 631 | Hidden-module details show canonical name, key and local folder without restoring its tab or changing sprint intent. |
| 632 | Narrow detail drill-in and Back retain search, collapsed groups and keyboard cursor. |
| 633 | Detail sprint membership reads every page, exposes failures/retry and updates agent attention through the real status subscription. |
| 634 | Archive detail inspection stays read-only; late archive reads cannot replace a newly selected module's details. |
| 635 | Module rows count complete top-level Stories and current worktrees from public hyphenated UUID ownership fields, and show sprint details without opening hidden modules. |
| 636 | Failed or incomplete metadata remains unavailable until retry completes; authoritative empty counts never invent activity. |
| 637 | Subscription membership changes refresh complete Story and worktree metadata collections. |
| 638 | Closed-manager reads cannot overwrite the next inspection scope; reopening refreshes cached counts. A companion shell regression keeps newer canonical Story revisions safe from buffered metadata pages. |
| 639 | Lazy expansion shows all canonical ordinary Story pages without opening or restoring a hidden module. |
| 640 | Story expansion exposes loading, incomplete pagination and retry without changing sprint intent. |
| 641 | Production row navigation reaches expanded Stories and rejects late reads after changing projects. |
| 642 | Status subscriptions refresh complete expanded Story membership, retain a surviving row's keyboard focus, and return focus to its module when that Story disappears; covered panes cannot steal focus. |
| 643 | Native folder-picker cancellation writes nothing; accepted provider trust precedes inline model creation and local folder linking. |
| 644 | Refused module renames retain an editable draft, prevent duplicate submissions, and converge manager, picker and tabs after explicit retry. |
| 645 | Module name editing retains caret keys; Escape cancels the edit and restores contextual action focus without a write. |
| 646 | Detail presentation actions share row Close tab/Restore contracts and truthful sprint-filter explanations without implicit restoration. |
| 647 | Archive confirmation names the module and server cascade; cancellation writes nothing and server refusal preserves context for retry. |
| 648 | Committed archive converges affected memberships and repairs selection even when a follow-up read needs retry. |
| 649 | Pre-archive project, archive and Story responses cannot resurrect the committed archived module or its affected Story membership. |
| 650 | Open rows reorder through canonical project-wide presentation order, including hidden neighbors, and share pending state with tabs. |
| 651 | Restricted, searched, incomplete, hidden and archived rows cannot reorder; changing sprint scope cancels an accepted drag. |
| 652 | Refused reorder rolls back rows and tabs, preserves contextual action focus, and permits an explicit retry. |
| 653 | Pending archive confirmation and project revisits invalidate accepted reorder gestures before they can write in a new scope. |
| 654 | Hidden-tab and empty-project recovery opens the manager with explicit restore or inline creation actions. |
| 655 | The footer manager replaces the sidebar without an outer panel or gutter, translating saved Stories/workspace proportions and retaining mounted splits. |
| 656 | Legacy sidebar visibility and module cursors cannot alter workspace traversal; configured legacy shortcuts open the manager. |
| 657 | Carryover targets follow persisted base-62 rank and identity while Backlog remains selected. |
| 658 | Planned sprints follow ascending rank and sprint history follows descending rank regardless of creation time. |
| 659 | A warm Sprints workspace opens the first planned sprint by persisted rank. |
| 660 | The top module picker bounds long lists to the available viewport, scrolls choices independently of search, and restores the final module. |
| 661 | Keyboard navigation reveals the active choice in a long module picker while retaining search focus and Enter restoration. |
| 662 | Planned sprint cards alone expose earlier/later controls with the first and last sequence ends disabled. |
| 663 | Sprint arrows send concrete adjacent sequence neighbors, disable every arrow while pending and converge the Plan list and planned sprint choices in both directions. |
| 664 | A refused sprint reorder preserves the prior sequence, reports inline feedback and allows retry. |
| 665 | Durable external sprint reorder facts update visible sprint cards and planned sprint choices once per project batch. |
| 666 | An external sprint reorder repairs a closed cached planning view and invalidates retained choices before reopening. |
| 667 | Recovery from an unavailable status replay cursor rereads sprint order and refreshes planned choices. |
| 668 | A committed sprint reorder retains its authoritative rank and distinguishes a failed planning refresh from a refused reorder. |
| 669 | A public-project sprint change repairs a closed planning graph cached under the compact project identity. |
| 670 | The task-workspace public rendered entry restores and reselects an existing terminal without replacing its durable run or session. |
| 671 | The selected-ticket shell adapter preserves document engagement, first-press terminal focus and exact mounted document/input identities across tab switches, attaching the existing run once. |
| 672 | The public rendered workspace restores a remembered document without engaging it, then engages and retains that exact frame across tab switches. |
| 673 | Changes opens its independent rendered workspace from the task-workspace public entry while retaining the selected terminal, mounted viewer and remembered durable run. |
| 674 | Preserves a remembered document when the authoritative document refresh fails. |
| 675 | Keeps explicit Details entry selected when a remembered document arrives later. |
| 676 | Preserves the current document after an old A response completes following A to B to A. |
| 677 | Keeps a remembered path during loading and restores its authoritative document identity. |
| 678 | Repairs remembered state to Details only after a successful read proves the document missing. |
| 679 | Honors an explicit Details tab selection through unrelated presentation updates during hydration. |
| 680 | Ignores an old document completion after A to B without changing either remembered target. |
| 681 | Leaves remembered intent intact when a document response finishes after workspace disposal. |
| 682 | Restores the current module context within one bucket while ignoring the former context response. |
| 683 | Keeps an explicitly reopened document selected over pending remembered restoration. |
| 684 | Retains a remembered run until successful run resolution establishes absence and repairs persistence. |
| 685 | Repairs an existing remembered terminal when authoritative resumability makes it ineligible. |
| 686 | Waits for the authoritative live snapshot before restoring a delayed remembered projection. |
| 687 | Keeps explicit conversation entry ahead of delayed remembered terminal resolution. |
| 688 | Follows a newer conversation within the same bucket when the older read finishes later. |
| 689 | Rejects a durable remembered terminal belonging to another workspace and repairs its target. |
| 690 | Preserves remembered terminal intent after an ended-run read error. |
| 691 | Ignores an old run read and projection after switching from A to B. |
| 692 | Preserves newer Details selection after A to B to A and an old run completion. |
| 693 | Preserves remembered terminal intent while resumable-session resolution loads or fails. |
| 694 | Keeps Details while resume is pending instead of applying older remembered document hydration. |
| 695 | Committing a task launch wins over an older remembered document response. |
| 696 | Reopening a document wins over an older terminal whose durable history arrives later. |
| 697 | Closing an inactive document preserves the pending remembered terminal. |
| 698 | Explicit engagement of Details wins over delayed remembered document hydration. |
| 699 | An explicit agent run focus in the same workspace outranks delayed remembered document hydration. |
| 700 | Retains the current document fields when an obsolete refresh returns the same document identity. |
| 701 | Retains a completed resume after A to B without changing selection, focus or either remembered target. |
| 702 | Preserves the new A entry when an old resume completes following A to B to A. |
| 703 | Keeps the newer of two resume intents selected when transports complete in reverse order. |
| 704 | Retains a launched run when its durable identity arrives after newer Details selection. |
| 705 | Remembers the exact launched run through temporary session rekey. |
| 706 | Retains a launched run after A to B without selecting or remembering its obsolete target. |
| 707 | Rejects an old launched run's persistence after A to B to A and a current Details intent. |
| 708 | Retains both launched run identities when the newer launch finishes before the older one. |
| 709 | Treats a picker commit after a newer Details selection as a fresh launch intent. |
| 710 | Keeps a newer Details selection and engagement when the same workspace resume settles. |
| 711 | Preserves a legitimate resumed terminal after disposal without updating remembered intent. |
| 712 | Deduplicates repeated clicks while resume is pending and retains exactly one successor. |
| 713 | Preserves resume error feedback after a newer selection and leaves the source retryable. |
| 714 | Invalidates resume intent when the same mounted workspace loses and regains presentation authority. |
| 715 | Remembers the intended launched run when the authoritative terminal selection index changes before its durable rekey. |
| 716 | Does not send an originating temporary terminal's deferred focus to an unrelated selected terminal. |
| 717 | Restores current remembered intent when a retained workspace returns after hydration completed while hidden. |
| 718 | Focuses the remembered document on its first authorized hydration while preserving global body engagement. |
| 719 | Lets document hydration finish under configuration without taking focus and focuses its retained frame on authorized return. |
| 720 | Leaves Details entry unfocused while retained and restores it only when body engagement authorizes return. |
| 721 | Protects a foreground editor when configuration closes over an engaged document. |
| 722 | Carries first engagement into the Markdown editor after its document bytes hydrate. |
| 723 | Hydrates a retained Markdown editor without focusing it after a newer Details selection. |
| 724 | Gives the first activated native terminal input after presentation commits, retaining the durable run and terminal. |
| 725 | Focuses compatibility input on the first activation after native attachment fails on the same run. |
| 726 | Cancels queued native focus when presentation authority is lost during input ownership transfer. |
| 727 | Preserves first-press engaged fallback input through temporary-to-durable terminal rekey. |
| 728 | Cancels delayed native focus under a modal and restores engaged focus after authorized return. |
| 729 | Selects a native terminal from the edit-view tab strip without engaging input until Enter in its body. |
| 730 | Retains the engaged native viewer and input when its temporary terminal identity becomes durable. |
| 731 | Keeps fallback terminal selection in navigation mode until Enter engages its input. |
| 732 | Drops delayed native ownership focus after Cmd+Esc disengages the still-presented terminal. |
| 733 | Protects a newly focused editor from delayed native input ownership completion. |
| 734 | Drops stale first-press fallback focus when native failure arrives after Cmd+Esc. |
| 735 | Restores authorized full-sidebar native and fallback input after conversation configuration returns the same retained workspace. |
| 736 | Actual bootstrap preserves the remembered document until rendered workspace hydration restores its authoritative path without engaging content. |
| 737 | A successfully created epic remains selected while graph refresh still lacks its identity, then converges without another creation. |
| 738 | Inactive epic closure preserves focus; tab closure and Done share next, previous and final Add epic focus. |
| 739 | Incomplete and failed suggestion reads preserve the remembered Plan visit. |
| 740 | Deleted epic tabs normalize and deduplicate under No epic, whose waiting suggestions remain discoverable after closure. |
| 741 | Switching sprint visits restores remembered tabs and rejects an old visit's late epic creation. |
| 742 | Created-epic refresh Retry preserves a newer epic selection. |
| 743 | A missing Plan sprint preserves remembered intent until the sprint becomes available again. |
| 744 | An in-flight epic creation cannot overwrite a newer selection in the same visit. |
| 745 | Compiled OFF direct Plan mounts preserve remembered visits and initiate no planning requests. |
| 746 | Reopening the same sprint rejects epic creation completion from the previous generation. |
| 747 | An incoming move rechecks epic focus changed during the same input event and sends no stale assignment write. |
| 748 | An Undo overtaken during input remains discarded after the assignment immediately returns. |
| 749 | Retry rejects a graph refresh begun during input and explains loading or failed reads while retaining recovery. |
| 750 | An incomplete planning graph disables Undo without discarding its unchanged normalized assignment. |
| 751 | Retry requires its original assignment and stays discarded after an observed reassignment returns. |
| 752 | Retry explanations retain completion, hierarchy, workflow and epic-focus reason precedence. |
| 753 | Retained work can leave completed sprints regardless of hierarchy, workflow or focus; incoming Undo remains closed. |
| 754 | Move Undo expires after five unheld seconds and preserves remaining time across focus and hover holds. |
| 755 | Competing mounted views share the synchronous per-item assignment write guard. |
| 756 | Reopening a Plan visit isolates its predecessor's late move settlement from current feedback. |
| 757 | Move feedback retains independent per-item Retry and gives Undo to the newest successful move. |
| 758 | Move, Retry and Undo controls captured by an older visit generation send no assignment write. |
| 759 | Complete graph removal discards Undo permanently even if the normalized item survives and later returns. |
| 760 | Rendered epic tabs preserve intent during a cached graph refresh and normalize when the read completes. |
| 761 | Incoming and outgoing moves reject unavailable or foreign owning project records changed during input. |
| 762 | Saved proposal survives failed refresh and Retry refresh keeps its committed Story identity. |
| 763 | A definite rejection retains the edited proposal and retries only its rejected write. |
| 764 | A lost acceptance response inspects authoritative suggestion and Story before retaining success. |
| 765 | An uncommitted transport outcome is inspected before an explicit proposal Retry. |
| 766 | Failed inspection remains read-only recovery and never blindly creates a second proposal. |
| 767 | Incomplete owning graph cannot authorize repeating an unknown proposal acceptance. |
| 768 | Reopening an unresolved visit keeps read recovery accessible before any repeat decision. |
| 769 | Bulk acceptance stops after its first committed decision fails refresh and never replays it. |
| 770 | Inherited recovery cannot inspect or repeat while the old visit decision is still saving. |
| 771 | Dismissed suggestion read recovery retains Undo and its edited draft without repeating dismissal. |
| 772 | Confirmed Undo followed by failed reads is recovered with reads without repeating either write. |
| 773 | An ambiguous server error after commitment is inspected rather than replayed as a rejection. |
| 774 | Rejected Undo preserves the committed decision's outstanding read recovery. |
| 775 | Retry refresh preserves a newer selected Story and focused epic instead of following the older proposal. |
| 776 | An old visit's held recovery read blocks newer inspection and decisions until authoritative recovery settles. |
| 777 | Inconsistent authoritative suggestion and Story membership remains inspection recovery without replay. |
| 778 | A suggestion accept captured before a new visit generation sends no write. |
| 779 | Suggestion Undo is unavailable while authoritative graph reads are incomplete. |
| 780 | Suggestion acceptance rechecks a sprint completed during input. |
| 781 | Dismiss and Undo stay available after completion, workflow, hierarchy and epic focus changes. |
| 782 | A suggestion read begun during input blocks writes and failed reads keep both controls unavailable. |
| 783 | A refresh or inspection recovery control captured before a new generation sends no reads or writes. |
| 784 | Replacing Undo starts a fresh expiry and the previous timer cannot remove the latest move. |
| 785 | A failure keeps its Retry through delayed assignment rollback and dismisses independently. |
| 786 | A suggestion removed from the authoritative collection during input cannot be accepted. |
| 787 | A suggestion rejects a current graph whose owning project is refresh or inspection. |
| 788 | Two mounted suggestion controls share a current synchronous pending guard. |
| 789 | An unresolved Undo keeps the known decision but disables repeat Undo until inspection. |
| 790 | A partial authoritative suggestion response preserves remembered epic intent until a complete read. |
| 791 | Packaged desktop starts provider MCP registration once in the background without waiting for worker completion. |
| 792 | Unpackaged processes, debug builds and every data-directory override skip provider MCP registration and preserve Claude configuration. |
| 793 | Opening a stage's launch configuration checks its saved Stage skills, names the provider and searched locations, and still allows saving. |
| 794 | Adding or removing a Stage skill refreshes availability for the current list. |
| 795 | Recheck observes a manually installed skill without writing the launch binding. |
| 796 | Changing the stage's provider or the inherited global default checks against the newly resolved provider. |
| 797 | A slower availability response for an earlier provider never replaces the newer result. |
| 798 | An unresolved provider or failed check shows Not verified, never available. |
| 799 | The next Stage skills edit saves case-only matches under the installed spelling, collapses case duplicates and keeps the rest of the binding. |
| 800 | A missing Stage skill never blocks the stage-skill save. |
| 801 | The reachable state panel checks saved Stage skills through the host query and its Recheck writes nothing. |
| 802 | Existing Required skill chips show provider-specific availability and searched-location warnings without automatically rewriting old bindings. |
| 803 | Required skill edits save and reload while preserving Stage skills and unrelated binding fields. |
| 804 | A Stage skills edit preserves exact Required identifiers even when disk availability finds a case-only match. |
| 805 | A disk-visible Required identifier outside the pinned catalog is rejected on save with invalid_required_skills. |
| 806 | A provider change refreshes Required skill availability for the new provider. |
| 807 | Accessible Required skills Recheck observes a manual install without saving the binding. |
| 808 | The reachable state configuration panel checks Required skills through the host query, and Recheck sends only read operations. |
| 809 | A sprint Story submission retains its editor and focus while planning-cache invalidation resolves, without stealing the other pane's draft. |
| 810 | A pending Story creation preserves deliberate focus outside its editor and the other pane's draft. |
| 811 | Initial active-sprint resolution during module creation preserves folder setup and selects the created module. |
| 812 | Explicit sprint-intent changes cancel late module setup; retry links the already-created identity. |
| 813 | Add all accepts an Undone edited proposal's existing Story during a complete cached graph refresh, preserving identity and goal attribution. |
| 814 | Keyboard Story moves retain the next-row focus handoff through temporarily unavailable reads, preserve heading fallback, and respect deliberate focus changes. |
| 815 | The acknowledged terminal names every missing Stage skill and provider, and preserves its warning when revisited. |
| 816 | A later acknowledged run whose skill check finds the installed skills shows no warning. |
| 817 | Unchecked Stage skill reads name the provider, every requested skill and the read failure while preserving the terminal surface. |
| 818 | A continued handoff updates the warning on the same acknowledged terminal through the normalized run entity. |
| 819 | An unreadable persisted Stage skill observation remains an unchecked warning and does not crash the terminal surface. |
| 820 | A late historical run read preserves an already visible persisted Stage skill warning on the acknowledged terminal. |
| 821 | A compact launch run ID reads its public GraphQL UUID warning without losing the terminal lifecycle presentation. |
| 822 | Keeps the Name editor focused after its single-click entry engages the Details surface. |
| 824 | Keeps a Details control focused when a modal it opened closes over the engaged surface. |
| 825 | Retrying a modal chunk whose failed import the browser keeps cached requests a fresh chunk URL and opens the requested dialog without a page reload. |
| 826 | The production native AppKit host keeps marked/consumed IME keys out of the real libghostty PTY while ordinary Shift+Enter remains ESC CR, Enter remains CR, Ctrl/Alt/Cmd retain their behavior and UTF-8 composition commits exactly once. |
| 827 | A delayed older run read cannot erase a newer continued-handoff stage-skill warning from the terminal banner or shared live holding. |
| 828 | Delayed older null and non-null reports preserve newer warning creation and successful or explicit clearing in both the banner and live holding. |
| 829 | A delayed historical run read respects newer stage-skill ownership through aliased run identity while accepting unrelated exit metadata. |
| 830 | Fresh run reads after a handoff can clear warnings with null or successful checks and can publish a missing-skill warning. |
| 831 | A pending older run read cannot erase a warning recreated after intervening warning creation and clearing. |


Each executable case carries one stable `[overhaul-NN]` marker. The gate has a
contract test that fails if a marker is missing or duplicated. A case whose
behavior belongs to a Rust crate rather than the Studio UI carries its marker on
the Rust test that exercises it, and the contract test counts those markers too.
Case 245 is the current example: the runtime-path case lives in
`studio/src-tauri/crates/execution/ticketry-terminal/src/terminal/lifecycle/work.rs`,
with failed-delivery pane teardown covered beside the delivery helper, so
`cargo test` runs it rather than the Vitest gate. When a Studio UI
change affects one of these behaviors, update that case in the same change. If
the change introduces a new durable user behavior, add a new acceptance case
and extend this matrix rather than returning to a manual checklist.

Codex Instant naming delivery uses a controlled provider title in cases 259,
473, 596, 597 and 620; cases 264 and 475 cover reader recovery and delayed list/manual
title precedence. These fixtures prove visible delivery and ownership. Real
Codex semantic naming and desktop launch evidence are recorded separately in
the CODING-2534 implementation evidence.

## Compiled Roadmap availability (CODING-2633)

The full Studio shell cases use the existing generated GraphQL transport and
Apollo fixtures with retained sprint, goal, suggestion, document and terminal
records. The OFF configuration compiles a literal availability value into an
isolated Vitest context; product settings and process environment are not a
runtime feature toggle. The default test context exercises ON.

On 2026-10-08, `bun run --cwd studio test --config vitest.roadmap-off.config.ts`
passed all 7 tests, including cases 527, 530–533 and 535 and the supplemental
direct-public-mount case. `bun run --cwd studio test
src/test/overhaulRoadmapOnAcceptance.test.tsx` passed case 534. These focused
results do not claim the complete overhaul suite passed. `test:overhaul` runs
both contexts and combines their exit statuses, including when ON fails.

## Stories sprint filter signals (CODING-2610)

The approved parent [SPEC.md](../../spec/roadmap--9c384685/T2610--stories-kanban-view-should-have-a-sprint/SPEC.md)
defines these twelve signals. The cases below run the real Story/cache/shell
components with the generated GraphQL transport substituted. Structural cases
also use the production local mutation and fact invalidation boundaries; recovery
cases use the capture, run-reveal and module-creation UI paths. Focused/native
contract checks supplement these component acceptance cases.

| Parent signal | Executable evidence |
| --- | --- |
| AC-1 | 476 Active/All/No sprint; 483 explicit identity, scoped absence and failure; 521 authoritative no-active fallback and independent project intent across revisits. The focused `storySprintFilterStore.test.ts` additionally verifies a new application cache resets intent to Active. |
| AC-2 | 484 separate five-item pages, retained pages and scoped totals; 487 pinned/section controls and appended focus; 592 retained-page names and membership refresh on reopen without collapsing loaded choices. Native `story_sprint_choices_graphql.rs` checks generated ordering, offset totals and project isolation. |
| AC-3 | 485 trimmed/debounced search reaches unloaded history and rejects a late prior search; 486 failed-page Retry preserves offset, choices and focus; 593 later-page reopen failure preserves retained choices and Retry refreshes them before pagination continues. |
| AC-4 | 477 exact root branch membership, child context and Story search; 481 reactive membership; 482 project-root versus selected-module counts; 520 canonical/optimistic branches and project counts. |
| AC-5 | 477 excluded Details remain selected; 494 real native Story/shell viewer hosts, document frame and session identities survive zero matches and recovery; 497–498 deferred fallback restores remembered Story context. |
| AC-6 | 481 and 520 canonical membership/optimistic rollback; 483 local sprint lifecycle and authoritative deleted/foreign selection recovery; 503–509 local/external structural convergence, scoped collection eviction and refresh recovery. |
| AC-7 | 478 selector key ownership and focus return; 480 distinguishable loading/error/Retry; 487 section and paging controls, live feedback and normal Tab exit; 490 keyboard-reachable zero-tab recovery. |
| AC-8 | 479 restriction/search disables drag and All plus empty search restores it; 488 restricted top-tab Hide/reorder and saved visibility. |
| AC-9 | 510 unassigned idea capture, confirmation and independent Show all recovery; 586-591 unassigned capture across filter scopes, selection retention, rejection and pending filter changes; 594-595 capture independence from loading/failed sprint reads; 513 actual run reveal clears both filter axes while preserving agent typing focus and session; 514–516 canonical module creation/folder success, cancellation and retry without sprint assignment; 517–519 reveal and creation stale-navigation guards. |
| AC-10 | 488 exact sets/order and shortcuts; 489 saved-hidden preference/manager navigation; 520 existing-root changes include unopened tabs without persisted visibility writes. Native `story_sprint_index_graphql.rs` checks direct roots, archive/project exclusion and complete generated collections. |
| AC-11 | 491 zero-match recovery; 492 cached-results preservation on read errors; 493 truncated-read refusal; 495–496 obsolete load/folder guards; 497–498 deferred fallback; 506 focus/chooser refresh, read failure and Retry; 522 eligible intentional empty Story selection. |
| AC-12 | 488 shared tab/shortcut projection; 494 dormant viewer/session identity and no termination; 495–499 stale module/project/folder guards; 503–509 local/external structural convergence, scoped cache eviction, late-project reads and module archive; 514–519 explicit module creation/reveal and stale callbacks; 520 unopened canonical/optimistic projection; 521 project isolation; 523 late folder completion after Active changes away and back. |

The approved desktop/narrow mockups and existing responsive controls remain the
visual reference. These automated component cases do not claim a live packaged
desktop session or a real external coding-agent run.

## Real-browser web gate

`bun run --cwd studio test:e2e:overhaul` starts the browser
development stack with a temporary SQLite profile and drives Chromium through
the visible Studio UI. The Playwright cases live in `studio/e2e/overhaul.spec.ts`.
The temporary profile and its tmux socket are removed when the run exits.

Cases that require a real coding-agent process, a tmux session killed from
outside Studio, or repository-backed documents remain explicitly skipped in
the web suite. They must not be counted as automated until the harness has safe
fixture support for those boundaries; their existing Vitest cases are not a
substitute for running-application verification.

## Stage skill availability (CODING-2722, 2026-10-10)

Cases 793–801 cover workflow-configuration Stage skill availability at the
`LaunchConfigurationForm` seam with an injected host check, plus one reachable
`StateConfigurationPanel` case over the real `LaunchSkillAvailability` GraphQL
transport. The filesystem contract itself is covered by Rust tests in
`ticketry-provider/tests/skill_availability.rs` and
`ticketry-work-management/tests/launch_skill_availability.rs`.

## Required skill availability (CODING-2723, 2026-10-10)

Cases 802–808 cover Required skills in the same launch configuration, including
legacy names such as `grill-with-docs`, exact identifier preservation,
save/reload, cross-field preservation, pinned-catalog refusal, provider changes
and accessible Recheck. Cases 802–807 exercise `LaunchConfigurationForm` with an
injected host availability check; case 808 exercises the reachable
`StateConfigurationPanel` over the `LaunchSkillAvailability` GraphQL transport
and proves its inspection/Recheck path emits no writes. Provider Rust filesystem
tests establish physical skill-directory preservation. These component cases
do not claim installed-desktop persistence or external-provider execution.

## Plan recovery integration (CODING-2662, 2026-10-10)

Cases 762–790 extend the approved mounted Plan controls / Apollo-GraphQL seam.
The final serialized validation passed 152 focused tests, architecture lint,
typecheck, build, and the full overhaul command (1028 tests plus 20 compiled
Roadmap-OFF tests). These are current implementation results, separate from the
historical Spec baseline. Earlier ownerless-fixture and simultaneous-run timeout
failures, native smoke evidence, source hashes, and remaining native recovery /
completed-Plan control limitations are recorded in
[IMPLEMENTATION-2662.md](../../spec/0-2-0--d3bee32f/T2642--concentrate-plan-visit-epic-selection-an/IMPLEMENTATION-2662.md).
