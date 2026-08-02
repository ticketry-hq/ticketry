# Studio

Studio is the single browser workspace for navigating projects, shaping work,
and running agents before and during execution.

## Language

**Task-launch flow**:
The Studio interaction that begins when a work item is activated for an agent
run and ends when its required setup and agent choices are completed or dismissed.
_Avoid_: Launch modal, task popup

**Scratch workspace**:
A module-scoped Studio workspace for taskless Plan and Instant runs. It belongs
to a real module but not to a work item.
_Avoid_: Temporary task, fake issue, unscoped terminal

**Scratch launch flow**:
The Studio interaction that begins from a scratch workspace's Agent action,
chooses Plan or Instant and one real module, then completes the shared setup,
prompt, and provider choices before foregrounding the new taskless run.
_Avoid_: Task-launch flow, scratch task creation

**Module scratch workspace**:
The user-visible workspace for taskless Plan and Instant agent runs scoped to
one real module in the active project. Choosing another module opens that
module's separate workspace; it does not retarget runs already opened here.
_Avoid_: No-module workspace, shared scratch workspace

**Scratch run chicklet**:
A compact lifecycle-state summary shown on a module scratch workspace's Details
surface for its module-scoped taskless runs. Like a Story's subtree lifecycle
chicklets, each visible state has one glyph and count; it is neither a
Stories-pane tree row nor a terminal tab.
_Avoid_: Scratch child row, per-run chicklet, run tab

**Task workspace**:
The Studio pane for one work item, containing its Details, design-document,
and terminal tabs regardless of whether the pane is hosted inline or in a drawer.
_Avoid_: Drawer tabs, ticket panel

**Stories pane**:
The Studio planning pane that lists the Stories belonging to the selected module and provides their rapid-capture entry point.
_Avoid_: Tasks pane, issues pane

**Focused pane**:
The single Studio pane that owns keyboard navigation at any moment, tracked by
the Studio UI store. It carries full visual emphasis (blue inset ring, undimmed);
every other pane is dimmed but remains legible and interactive. Focus moves only
by keyboard pane navigation or pointer interaction with a pane — never by hover,
and never implicitly when a modal opens.
_Avoid_: Active pane, selected pane

**Idea entry**:
The Stories pane's rapid-capture surface where one submitted idea becomes a Story in the currently selected module.
_Avoid_: Task entry, generic issue composer

**Subtree lifecycle chicklets**:
The compact per-lifecycle-state summary of agent runs attached to a work item and
its descendants. Each visible state has its own glyph and count so attention and
activity remain distinguishable.
_Avoid_: Aggregate agent count, work-item state badge

**Automation failure chicklet**:
The error indicator for a failed automated launch, shown on the affected work item and rolled up to a tree ancestor only while the affected branch is collapsed. It reports launch failure without changing the committed workflow state and offers user-initiated retry; automatic retry is deferred.
_Avoid_: transition failure, state rollback warning

**Module task tree**:
The complete parent-child hierarchy of work items in the selected module,
hydrated as one local planning view. Agent-run status is joined to this hierarchy
for presentation; it is not stored as part of the hierarchy.
_Avoid_: Agent-status tree, lazily fetched branch tree

**Module tab strip**:
The single module switcher row spanning the Stories and Workspace panes, listing
every module of the active project in the recency order captured when the project
loaded. Selecting a tab is the same act as selecting that module anywhere else,
and the strip also hosts module creation.
_Avoid_: Pane header tabs, open-tab set, browser-style tabs

**Module activity badge**:
The per-module aggregate count of non-terminal agent runs — task-bound and
scratch together — shown on that module's tab, with an attention accent when any
counted run needs input or has errored. It deliberately trades per-state detail
for scannability across many tabs.
_Avoid_: Subtree lifecycle chicklets, module chicklets

**Live-terminal cycle**:
The keyboard traversal that steps through every terminal whose agent run is
live (active or attention; not exited or lost) in the current module, ordered
by the module task tree's visible row order and, within one work item, by its
terminal tab order, wrapping past the end. Each stop selects the owning work
item — expanding collapsed ancestors to reveal it — and foregrounds that
terminal. Work items are never stops themselves; their terminals are.
_Avoid_: Task cycling, agent switcher, attention queue

**Workflow graph view**:
The Settings surface that renders one issue type's effective workflow as a read-only directed graph, one tab per issue type, with start/stop and automatic edges visually distinguished. The canvas itself is never edited by direct manipulation; selecting a node opens the state attribute panel.
_Avoid_: Graph editor, drag-to-connect canvas, workflow diagram export

**State attribute panel**:
The editing surface opened by selecting a workflow graph view node. It edits the state's shared attributes (name, group/color) and the current tab's type-scoped attributes (start/stop role, outgoing transitions, launch configuration), applying each change through scoped apply.
_Avoid_: Node modal, state drawer, launch form

**Run self-termination**:
An agent-initiated action that ends only the agent's own active Studio run after
the agent decides its objective is fulfilled. It is not an MCP-server completion
decision and never accepts another run as a target.
_Avoid_: Objective completion, arbitrary run termination, self-kill

**Model configuration** (Settings section):
The Studio Settings surface listing the built-in providers, each with an activation toggle, above a single global launch default picker. It manages only which providers are activated and the one default triple; it never stores credentials, per-provider model lists, or reasoning-level lists.
_Avoid_: provider catalog editor, model catalog, credentials panel

**Launch default picker**:
The reusable Studio component that selects a (provider, model, reasoning) triple together — provider constrained to activated providers, model as a known-model dropdown that also accepts free text, reasoning from the provider's code-owned levels. It is shared by the workflow launch configuration form and the Model configuration section.
_Avoid_: provider dropdown, model field, reasoning select

**Keymap context**:
One of Studio's fixed keyboard-resolution layers — the open modal,
capture-phase chords, the focused pane, and global actions — consulted in that
precedence order. The same chord may mean different things in different keymap
contexts; the precedence order itself is not configurable.
_Avoid_: Keymap scope, shortcut group, key layer

**Binding**:
The pairing of one chord (modifier set plus one layout-aware key) with one
action inside one keymap context. Each action has exactly one binding; there
are no alternate chords or multi-key sequences.
_Avoid_: Shortcut mapping, hotkey list entry, key sequence

**Binding override**:
A user-recorded binding that replaces an action's default. Only overrides are
persisted — host-level, shared by every client of one backend — so unmodified
actions follow the app's defaults as they evolve. Removing an override restores
the default.
_Avoid_: Custom keymap file, full keymap snapshot, per-device shortcut

**Reserved chord**:
A chord the binding recorder refuses to assign because the hosting runtime owns
it. The reserved set depends on the runtime: the browser build reserves
browser-owned chords, the desktop app only unavoidable system chords, and
Esc-closes-modal is reserved everywhere.
_Avoid_: Blocked key, forbidden shortcut, system keys

**Binding recorder**:
The Settings surface where clicking a binding's key cell enters listening mode
and the next pressed chord becomes that action's binding override, subject to
reserved-chord and duplicate rules. All bindings appear as one flat list with
per-row reset and a restore-defaults action.
_Avoid_: Shortcut editor form, key dropdown, hotkey text field

**Rich document edit mode**:
The in-place rendered/WYSIWYG editing state of a task workspace document tab,
entered from the tab's own Edit affordance and returning to the rendered
read view on save or cancel. It replaces the read surface within the same tab;
it is not a separate tab, modal, or the "edit with agent" action, which remains
available alongside it.
_Avoid_: Edit tab, edit modal, agent edit

**Document revision digest**:
The content-hash token a document read returns and a save must echo back, used
to detect that the file changed between read and save. It is derived from the
document's bytes, not the filesystem mtime or the registry `updated_at` row.
_Avoid_: mtime version, ETag row, updated_at token

**Stale-save conflict**:
The rejected save that occurs when the document's on-disk bytes no longer match
the revision digest the editor holds — an agent or the watcher rewrote the file
after editing began. The dirty buffer is preserved and the user chooses to
reload the external version or overwrite it with a fresh digest.
_Avoid_: Merge conflict, overwrite error, lost update

**External-change banner**:
The non-blocking notice shown over a document being edited when the watcher
reports the underlying file changed on disk. It never replaces the dirty buffer;
it offers reload or compare. The rendered read view keeps auto-refreshing as
before.
_Avoid_: Reload prompt, conflict modal, dirty warning

**Source-only document**:
A `.md`-named file whose contents are a complete HTML document. It is detected
on the read path and excluded from rich editing; it may be edited as raw source
only (or left read-only) until renamed to `.html`, since rich editing would
rewrite the HTML application.
_Avoid_: HTML doc, broken markdown, mislabeled file

**Desktop development instance**:
One Tauri development launch of Studio with a coordinated runtime identity —
its worktree, frontend origin, backend endpoint, MCP endpoint, and data
directory — isolated so concurrent launches from different worktrees never
share ports, origins, or state.
_Avoid_: Dev window, second app copy, port profile

**Edit view**:
The two-column Studio layout — Stories pane beside the Task workspace — used
whenever installation configuration disables the sidebar, and shown when a
configured sidebar is hidden by the user's visibility preference. It has its
own modal, three-zone keyboard model.
_Avoid_: Focused view, zen mode, two-pane mode

**Full sidebar view**:
The Studio layout that adds the installation-configured sidebar panes beside
the Edit view work area and uses pane-focus navigation. It is available only
when installation configuration enables the sidebar; the user's visibility
preference then chooses between this layout and the Edit view.
_Avoid_: Default view, navigation mode, three-pane mode

**Navigation zone**:
One of the three focus targets the edit view cycles between — the Stories list,
the tab strip, or the active tab body. Shift+Tab steps forward through them
(wrapping); arrows move within the focused zone.
_Avoid_: Pane, focus region, tab group

**Navigation mode**:
The edit view's default state, in which Studio owns the keyboard: Shift+Tab
cycles navigation zones, arrows move within a zone, and Enter dives into the
active tab body. A terminal body remains in navigation mode until Enter is
pressed again to enter terminal typing mode.
_Avoid_: Command mode, normal mode, browse mode

**Terminal typing mode**:
The edit view state entered explicitly by pressing Enter while a live terminal
body is the focused navigation zone. Keystrokes then go to the agent and the
only chord Studio intercepts is Cmd+Esc — which exits typing and returns to the
Stories list.
_Avoid_: Insert mode, terminal focus, raw input mode

**Active tab**:
The tab each ticket remembers as last-selected in its Task workspace. Entering
a ticket restores it: Enter from the Stories list dives into its body, Shift+Tab
lands the tab-strip highlight on it.
_Avoid_: Current tab, default tab, open tab

**Installation feature flag**:
A capability switch declared in the installation's own local configuration file
rather than in tracker data, answering whether a product surface exists for this
installation at all. It is answerable before any planning data exists, it is read
once when the application starts, and the application never writes it.
_Avoid_: user preference, workspace setting, per-profile toggle, remote flag, A/B flag

**First-run onboarding**:
The welcome-screen-then-guided-tour sequence shown in place of the ordinary
surface while a workspace's first-run setup is still pending. It runs once per
workspace and ends only by onboarding acknowledgement.
_Avoid_: Setup wizard, tutorial mode, getting-started flow

**Welcome screen**:
The first-run surface that precedes the guided tour. Its first pane is
where the user declares which agent subscriptions they hold — declaring one
activates that provider, and the global launch default is settled here too, so
first-run onboarding never ends in a workspace that cannot launch an agent. A
second pane creating the workspace's first project appears only where the
Projects surface is enabled; otherwise the resolved project stands in and the
welcome screen is the subscriptions pane alone. Any pane can be skipped, which
acknowledges onboarding outright.
_Avoid_: Onboarding welcome modal, provider setup wizard, sign-in screen

**Guided tour**:
The coach-mark walk that follows the welcome screen, in which the user creates
their first module — naming it and choosing its module folder in one step — and
then their first Story, in place on the real surface rather than being shown a
demonstration. It ends at the ticket workspace. Where the Projects surface is
enabled it opens on the project affordance the welcome screen just exercised;
otherwise it opens on module creation. It is run-local: a reload never resumes a
half-finished tour, it restarts from the beginning while onboarding is pending.
_Avoid_: Product tour, walkthrough, tutorial steps

**Coach mark**:
One step of the guided tour, rendered as a callout attached to the live surface
element that step is about. A step's element is its anchor; every anchor belongs
to a surface that is already available in the current installation and layout.
_Avoid_: Tooltip, popover, hotspot, spotlight

**Onboarding acknowledgement**:
The monotonic act that ends first-run onboarding — finishing the guided tour or
skipping it. It is the only thing that ends onboarding: creating a project does
not, and no inverse action is exposed.
_Avoid_: Onboarding reset, dismiss flag, completing setup

**Onboarding replay**:
Re-experiencing first-run onboarding by discarding a development instance's
whole data directory, so the next launch provisions a genuinely new workspace.
Because acknowledgement has no inverse, this is how onboarding is seen twice; it
is confined to development instances and never touches the shared data
directory.
_Avoid_: Onboarding reset, re-arming onboarding, replaying the tour

**Work item**:
The aggregate the backend owns and serves as `WorkItemOut` — the thing a Story,
Implementation, or Module all are. Studio holds exactly one client-side copy of
each, keyed by id; every surface that needs one reads it by id rather than
carrying its own. Older Studio code names the same aggregate Task or Issue in
type and store names; those spellings survive only where they already exist and
name the surface, not the record.
_Avoid_: Task record, issue record, task summary

**Work-item store**:
The single owner of every work-item record Studio holds. Panes, trees, and
pickers keep the ids they need and resolve records through it, so a record can
never exist in two places and disagree with itself. It is the only place a
work-item record is written, and the status-feed revision guards live alongside
it because a guard held apart from its data protects nothing.
_Avoid_: Detail store, issue cache, work-item cache

**Selection paint**:
Rendering the newly selected work item's panel from the record Studio already
holds, in the same frame as the selection, with no request in the way. Anything
still missing — attachments, edits made elsewhere — arrives afterwards and
patches in. A loading state is correct only when the record is genuinely absent,
such as a deep link into an unloaded module; it is never correct for cycling
through a loaded list.
_Avoid_: Detail load, panel fetch, loading the selected task

**State configuration panel**:
The workspace-pane surface that presents one workflow state's agent policy for
one issue type — what launches there, and which moves lead in and out. It is
reached from that state in the Stories pane, names the state and issue type it
belongs to, and is the same policy the Settings workflow editor shows; neither
is a copy of the other. It configures a state, never a work item, so nothing it
shows or changes depends on which Story is selected.
_Avoid_: State settings modal, launch popover, per-state details tab
