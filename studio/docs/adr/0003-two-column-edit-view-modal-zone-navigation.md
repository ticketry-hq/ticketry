# Two-column edit view: modal, three-zone navigation

When the sidebar is hidden Studio collapses to a two-column edit view (Stories + Task workspace), and we redefine its keyboard navigation as a vim-style modal, three-zone model (#1307) built on the central keymap registry (ADR 0001) and single focus store (ADR 0002). The three zones — Stories list, tab strip, active tab body — are cycled forward-only by Shift+Tab (Z1 → Z2 → Z3 → Z1, wrapping, native Shift+Tab suppressed). Arrows follow the visible geometry: the horizontal axis crosses between Stories and the workspace, while the vertical axis crosses between the tab strip and body. Under the act-or-exit rule, an arrow first performs its in-zone action and traverses to the neighbouring zone only when that action is a no-op; outer edges remain hard walls. CODING-823 supersedes the original Z1 Enter decision: Enter activates the selected work item by revealing its live agent terminal or launching its configured default agent, and Shift+Enter opens the provider picker. Stories keeps navigation ownership after either Enter branch. Right Arrow is the only Z1 route that expands the selected Story and then dives into its workspace body. Enter from Z2 keeps its "commit and dive" meaning.

Landing on any body leaves Studio in navigation mode. Enter from focused Z3 engages that body, whether it is a document surface or a live terminal, and its arrows then belong to the content. While engaged, the only chord Studio intercepts is Cmd+Esc. It disengages in place, leaving Z3 focused with its navigation ring restored, so Tab, Shift+Tab, Enter, and content arrow keys remain available to the body until disengagement.

## Considered Options

- **Keep the existing four-pane h/l model.** Rejected: pane-stepping with h/l/arrows overloaded the arrow keys, offered no way into a terminal without stealing its keys, and left focus able to point at unmounted panes.
- **Steal Tab or Shift+Tab to disengage a body.** Rejected: Tab is shell/agent autocomplete and Shift+Tab is a Claude-Code-style mode toggle / reverse-complete; either would make that key unreachable inside the agent. A Cmd chord is the one class macOS never routes to the shell, mirroring vim's single insert→normal escape.

## Consequences

- Scope is the two-column edit view only; the full sidebar view keeps today's navigation unchanged.
- Cmd+Left/Right (workspace tab navigation) and Cmd+\ (live-terminal cycle) are retired — subsumed by Z2 arrows and pick-story-plus-Enter respectively.
- Each ticket remembers its last-active tab: Right Arrow from Z1 expands the selected Story and dives into that tab, while Shift+Tab from Z1 lands the Z2 highlight on it.
- Focusing or diving into a body does not engage its content. Enter on focused Z3 is the explicit navigation-to-engagement transition for both document and terminal bodies; Cmd+Esc reverses it without changing zones.
- No URL / deep-links: the inert `BrowserRouter` and dead `navigate()` calls are removed, and chip jumps (child issues, blockers, findings) become in-app ticket selection. View state (view mode, selected ticket, per-ticket last-active tab) persists in localStorage; focused zone does not (always opens on Z1).
