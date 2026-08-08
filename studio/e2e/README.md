# Ticketry web acceptance suite

Run the complete browser suite from the repository root:

```sh
npm run test:e2e --workspace @worktracker/studio
```

Playwright starts `scripts/web-dev.mjs --temp-sqlite` on dedicated test ports.
That launcher creates and provisions a new SQLite profile for the invocation,
points every web service at it, and deletes the profile when Playwright shuts
the server down. The suite never opens the developer or desktop application
database.

The `setup` Playwright project runs before Chromium. It creates the temporary
catalog row for `codex / gpt-5.6-luna / medium` when necessary and completes
the real provider-onboarding UI. Luna is test data in the disposable database,
not a checked-in production catalog change.

## Covered browser seams

- first-run provider onboarding and saved global model defaults;
- visible module switching, idea capture, search, Story details, retyping,
  parent/child relationships, blockers, state moves, ordering, and deletion;
- task/workspace pane dragging and persisted layout;
- keyboard shortcut discovery, filtering, focus restoration, and search focus;
- States, Issue Types/workflows, transition permissions, launch configuration,
  and Models settings, including save/discard/reload behavior;
- canonical Markdown document discovery, editing, unsaved tab switches, saving,
  and reload persistence;
- Local scratch workspace Plan/Instant launcher-menu behavior without starting
  a real provider process;
- optimistic rollback, external updates, reconnect replay, and expansion state
  in the numbered overhaul regression.

The Playwright project intentionally contains no skipped tests. Behaviors that
need precise lifecycle state without executing a real coding agent are owned by
the executable numbered acceptance gate instead:

- `[overhaul-07]` collapsed branches retain descendant activity;
- `[overhaul-08]` keyboard terminal cycling enters collapsed branches;
- `[overhaul-09]` an externally lost terminal remains visibly dead;
- `[overhaul-10]` a dismissed terminal stays dismissed after restoration;
- `[overhaul-13]` a scratch launch produces its run summary.

Run that deterministic UI/state boundary alongside Playwright with:

```sh
npm run test:overhaul --workspace @worktracker/studio
```

The obsolete far-left Projects/Modules sidebar is intentionally outside this
suite. Native Ghostty/Tauri rendering, real provider processes, and tmux death
or reconnect behavior require the desktop smoke/acceptance harness rather than
a deterministic web Playwright run.
