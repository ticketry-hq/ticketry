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

**Terminal panel**:
The collapsible Studio surface along the bottom of the ticket workspace that
hosts plain interactive shells for the selected module. It spans the Stories and
workspace panes so its extent matches its module scope, and it never shows an
agent run. Whether it is open and how tall it is belong to the window; which
shells it holds belongs to the module.
_Avoid_: Terminal drawer, bottom dock, console panel

**Panel size mode**:
Whether the terminal panel is rendering at the person's own ordinary height or
at the geometry policy's current upper bound — ordinary or maximized. It is a
size mode inside an open panel, not a third open state: hiding and reopening
keeps it, maximized height is recomputed from the window rather than stored, and
resizing the panel directly returns it to ordinary at the height it lands on.
_Avoid_: Fullscreen, expanded, zoomed panel

**Panel shell tab**:
One shell run, shown in the terminal panel. A module has several and exactly one
is visible at a time. Unlike a terminal tab it carries no agent, no lifecycle
state and no work item, and it disappears when its shell exits cleanly rather
than remaining as a record of something that happened.
_Avoid_: Terminal tab, scratch terminal, shell session

**Dead panel shell**:
A panel shell tab whose shell ended other than cleanly, kept on the strip with
the code it ended on because it is the only record of the failure. It holds no
viewer and no durable session; the action it offers is a shell restart, which
puts a newly minted shell run in its slot rather than reopening the dead one.
_Avoid_: Failed terminal, disconnected shell, stale tab

**Task workspace**:
The Studio pane for one work item, containing its Details, design-document,
and terminal tabs regardless of whether the pane is hosted inline or in a drawer.
_Avoid_: Drawer tabs, ticket panel

**Changes tab**:
The pinned workspace tab that reviews one checkout's changed files and starts
its Git action. It keeps the active diff, checkout and branch identity, and the
next safe action together. A task workspace's Changes tab
reviews that task's worktree; a module's own workspace reviews that module's
base checkout through the same tab and the same diff viewer, never a separate
Git interface. Which checkout a tab reviews is carried explicitly, so the two
never share a cached read or a command.
_Avoid_: Git panel, source-control drawer, staging tab

**Stacked Git action**:
The current-branch Git operation started from the Changes tab. It runs commit,
optional push, and optional pull-request creation as one ordered action with a
single confirmation before anything leaves the machine. It always commits every
change in the checkout: there is no file selection and no staging area, because
curation happens upstream by having an agent fix the tree. The index is reset
before the commit so nothing left staged elsewhere can ride along. Both checkout
kinds run the same action and offer the same lengths of it; only which length
leads differs — a task worktree leads with the pull-request stack, a module base
checkout with commit & push, because a base checkout normally sits on the
default branch where a pull request is refused.
_Avoid_: Git workflow, staging flow, publish action

**Provider login**:
The user's own authenticated `gh` CLI, which is the only way Ticketry reaches
GitHub. Ticketry stores no GitHub credential and supplies none: the pull
request is created by invoking `gh` in the checkout, and a `gh` that is missing
or logged out is a precondition failure the user resolves in a terminal, before
anything is committed. A created pull request is identified by its URL, which
Studio hands to the platform's own browser rather than rendering itself.
_Avoid_: GitHub integration, connected account, stored token

**Task worktree**:
The isolated git checkout owned by one top-level work item and shared by its
subtasks, branched from the module base checkout's committed HEAD. It is
created deliberately, integrated automatically when its task completes, and
removed only by an explicit, confirmed discard — the single word for that act
everywhere it appears.
_Avoid_: Branch copy, sandbox checkout, agent workspace, delete/remove/clear

**Worktrees panel**:
The right-side popover, opened from its own button beside the terminal button,
listing every task worktree of the selected module's repo with live status.
It offers exactly two acts per worktree — a confirmed discard and revealing
the directory in the platform's file manager. It never creates worktrees;
creation belongs to the work item's own details surface.
_Avoid_: Worktree manager, git sidebar, worktree tab, clear-all panel

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

**Run now action**:
The work-item Details control that sends an idea straight into implementation,
skipping Grill, Spec, and Tickets. It is offered only while the item sits in a
state the workflow lets a human move directly to `Implement`, so workflow
configuration alone decides whether it exists. A successful click relocates the
row out of Ideas and activates that work item's terminal, because the run it
started is the thing worth looking at. Distinct from an Instant run, which is
taskless and scratch-scoped.
_Avoid_: Instant change, quick implement, skip button

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

**Module folder**:
The profile-to-module link carrying the local filesystem path where that
module's code lives for that profile. The same module may link to a different
path in another profile or have no link in a fresh profile.
_Avoid_: Repo path, module directory, worktree, project folder

**Module base checkout**:
The git checkout at a module's module folder — the working tree module shells
and agent launches already run in, normally sitting on the default branch. It
is reviewed like a task worktree but compared against nothing, because it has
no merge target of its own.
_Avoid_: Module repo, main worktree, base worktree

**Module tab strip**:
The single module switcher row spanning the Stories and Workspace panes, listing
the profile's visible modules of the active project in the canonical module
order, with module creation at its leftmost point. Selecting a tab is the same
act as selecting that module anywhere else. The strip may be empty when every
tab has been hidden.
_Avoid_: Pane header tabs, browser-style tabs

**Hidden module tab**:
A module removed from the module tab strip via the tab's close affordance,
without deleting or archiving the module. The module keeps its place in the
canonical module order, stays in the Modules sidebar (where its module
activity badge still appears), and selecting it in the sidebar restores its
tab and selects it. The hidden set is installation data stored by the backend
and shared by every client of the installation, and it is never undone by
agent activity. Keyboard position shortcuts count visible tabs only, so a
hidden module has no position shortcut.
_Avoid_: Closed module, archived module, removed module

**Canonical module order**:
The one project-wide module order every module surface — sidebar, tab strip,
backlog grouping, module pickers, keyboard position shortcuts — renders
identically. It is the recency order until the project is first manually
reordered, and the manually set order from then on; a newly created module
always enters at the front. In recency mode that front placement is held
explicitly until the new module has agent activity of its own, since it would
otherwise sort behind every module that has ever been worked in.
_Avoid_: Recency order, per-surface order, tab order

**Manual module order**:
The shared, user-arranged canonical module order a project acquires on its
first module drag, seeded from the order visible at that moment. It belongs to
the project, not the user, and once set it is never reshuffled by agent
activity.
_Avoid_: Pinned modules, per-user module order, sort preference

**Module jump badge**:
A small keycap hint shown inline on a module tab while the Command key is held
alone, naming the chord that jumps to that module. It appears only where the
module jump bindings themselves are available, disappears the moment another
modifier joins, the key is released, or the window loses focus, and is never
focusable or interactive.
_Avoid_: Shortcut overlay, hint bar, command indicator

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
The Studio Settings surface for the persisted Provider, model, and
reasoning-level catalog. It toggles activation on Provider rows, adds model rows
under a provider, maintains each model's permitted reasoning-level links, and
edits the validated global launch default. Credentials and executable adapters
remain outside this catalog.
_Avoid_: hardcoded provider list, free-text model setting, credentials panel

**Launch default picker**:
The reusable Studio component that selects a (provider, model, reasoning)
triple from catalog rows: an activated Provider, one of its model rows, and one
of that model's linked reasoning levels. It offers an add-model action instead
of accepting free text and is shared by workflow launch configuration and the
Model configuration section.
_Avoid_: free-text model, code-owned reasoning list, unrelated dropdown trio

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
The two-column Studio layout with the Stories pane beside the Task workspace,
shown when the user's persisted layout choice hides the sidebar. It has its
own modal, three-zone keyboard model.
_Avoid_: Focused view, zen mode, two-pane mode

**Full sidebar view**:
The Studio layout that adds the Modules sidebar beside the Edit view work area
and uses pane-focus navigation. It is shown when the user's persisted layout
choice shows the sidebar.
_Avoid_: Default view, navigation mode, three-pane mode

**Navigation zone**:
One of the three focus targets the edit view cycles between — the Stories list,
the tab strip, or the active tab body. Shift+Tab steps forward through them
(wrapping); arrows are zone-local with one exception — Right from the Stories
list, on a story with nothing left to expand, dives into the active tab body.
_Avoid_: Pane, focus region, tab group

**Navigation mode**:
The edit view's default state, in which Studio owns the keyboard: Shift+Tab
cycles navigation zones, arrows move within a zone, and Enter — or Right on a
story with nothing left to expand — dives into the active tab body. A terminal
body remains in navigation mode until Enter is pressed again to enter terminal
typing mode.
_Avoid_: Command mode, normal mode, browse mode

**Terminal typing mode**:
The edit view state entered explicitly by pressing Enter while a live terminal
body is the focused navigation zone. Keystrokes then go to the agent and the
only chord Studio intercepts is Cmd+Esc — which leaves typing mode and returns
to the un-engaged active tab body, still the focused navigation zone. Left then
returns to the Stories list.
_Avoid_: Insert mode, terminal focus, raw input mode

**Workspace tab order**:
The arrangement of a work item's Task workspace tabs — Details, documents and
terminal tabs alike — as set by dragging tabs horizontally within the strip.
Stored per work item and shared by every client of the installation. New tabs
join at the right end; a reopened tab returns to its remembered place. The
live-terminal cycle visits terminals in this order.
_Avoid_: Tab order (unqualified), launch order (that's only the default)

**Active tab**:
The tab each ticket remembers as last-selected in its Task workspace. Entering
a ticket restores it: Enter — or Right on a story with nothing left to expand —
from the Stories list dives into its body, Shift+Tab lands the tab-strip
highlight on it.
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
Implementation, or Module all are. Older Studio code names the same aggregate
Task or Issue in type and store names; those spellings survive only where they
already exist and name the surface, not the record.
_Avoid_: Task record, issue record, task summary

**Work-item entry**:
The one holding of a work item's field values, keyed by that work item's id.
Panes, trees, and pickers keep the ids they need and resolve the record through
its entry, so every surface reading one work item reads the same object. A
change to that work item reaches every surface at once, because there is one
place for it to reach.
_Avoid_: Work-item store, detail store, issue cache, record cache

**Record copy**:
Any second holding of a work item's field values outside its work-item entry —
a collection that carries whole records, a re-shaped summary type, a row that
carries a name, a component's own snapshot. Named so it can be prohibited: two
copies of one record are two answers to the same question, and the one being
read is decided by accident. The prohibition is enforced by tests, not by
convention, because it was asserted in prose twice and was false both times.
_Avoid_: Cache entry, projection, denormalised view

**Membership**:
Which work items belong to a collection and in what order — a module's tree, a
state section's rows, a parent's children. The server decides it and sends it as
ids, and Studio holds it as ids, never as records, so membership can go stale
without any record disagreeing with itself.
_Avoid_: Task list, tree data, section contents

**Row**:
What a planning pane renders one line from: an id and the structural facts of
its position — depth, parent, whether it can expand, whether it is expanded — and
never a field of the record it points at. A row for the module scratch
workspace carries no work-item id at all, because the scratch workspace is not
a work item. Rows are computed on read and kept nowhere, so the rendered view
exists only as what is on screen.
_Avoid_: Task summary, list item, tree node, presentation record

**Client store**:
The one holding of everything the server never said — which pane has focus, what
is expanded, what is selected, what is typed but not sent, which tab a workspace
is on. Every value in it is an id, a boolean, a number, a stack of things the
person did, or their own text. Because there is one, a test can read all of it
and assert that nothing a server said has found its way in.
_Avoid_: UI store, view store, app state, local state

**Intent and validity**:
The rule the client store follows for anything that points at something: the
store keeps what the person last chose, and a derivation decides whether that
choice still exists. A workspace left on a terminal tab whose run has since been
dismissed shows its Details, and nothing has to correct the stored value.
_Avoid_: Stale pointer, fallback state, reconciliation

**Terminal tab**:
One agent run, shown in a task workspace. A work item has many runs and so many
tabs; a run has one tmux session for its whole life, named from the run's own
id, so reattaching returns to the same session rather than making another. What
the tab shows is that session; what the tab *is* is the run. It names the run's
launch state and carries its provider as colour; it does not name the work item,
which the workspace around it already identifies.
_Avoid_: Terminal session tab, tmux tab, agent tab

**Launch state**:
The workflow state a run's work item was in at the moment that run spawned,
kept as it was rather than following the work item afterwards. It is what tells
two conversations on one work item apart: a run begun while the item sat in
Grill is a Grill conversation for the rest of its life, whatever the item does
next. A run with no work item behind it has no launch state, and neither does
one that began before this was recorded — in both cases the absence is the
honest answer, never a substituted one.
_Avoid_: Current state, ticket status, run status, state at render

**Provider colour**:
The one colour that stands for a provider wherever a run appears, carrying who
is working without a word for it. It says only which provider, never which
model and never how the run is faring, and a run that has finished gives it up
entirely — so colour on a strip means a run still going. Reversing which side
of a tab the colour falls on, its ground or its lettering, is how that tab says
it is the chosen one.
_Avoid_: Agent colour, model colour, status colour, provider badge

**Run liveness**:
Whether an agent run is starting, working, waiting, or finished, and when that
last changed. It arrives only as values pushed on the status feed, never by a
read, so the store that receives it is the run's one holding for it and not a
copy of anything. A run that never opened a terminal has liveness all the same.
_Avoid_: Terminal status, session state, tmux liveness, terminated_at

**Work-item batch read**:
The single request that carries many work-item ids and returns their records.
Every pane asks for one work item at a time; the requests it makes inside a
short window leave together as one. It exists so that one holding per work item
costs one request rather than one request per work item, and so that no reply is
ever written into a holding other than its own.
_Avoid_: List read, bulk fetch, prefetch, cache seeding

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
