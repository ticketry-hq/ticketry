# Studio frontend map

Start with `main.tsx`, which initializes the browser or desktop runtime and
mounts `app/StudioApp.tsx`.

The visible application composition is deliberately mirrored under `app/`:

```text
StudioApp
└─ StudioShell
   ├─ StudioLayout
   │  ├─ StudioSidebar
   │  │  ├─ ProjectsPane
   │  │  └─ ModulesPane
   │  └─ TicketWorkspace
   │     ├─ ModuleTabStrip
   │     ├─ TasksPane
   │     └─ SelectedTicket
   │        ├─ details
   │        ├─ documents
   │        ├─ terminals
   │        └─ agent launcher
   ├─ StudioFooter
   └─ OnboardingTour
```

## Directory responsibilities

- `app/startup/` owns readiness, bootstrap, and first-run gates.
- `app/shell/` owns everything persistently visible in the Studio window.
- `app/shell/ticket-workspace/` owns the main module-and-ticket working area.
- `app/shell/ticket-workspace/tasks/` owns the searchable task tree.
- `app/shell/ticket-workspace/selected-ticket/` owns the selected ticket's
  details, document tabs, terminal tabs, agent launcher, and workspace state.
- `features/` retains supporting product capabilities and data projections that
  are consumed by more than one part of the application tree.
- `shared/` contains product-agnostic UI and infrastructure only.
- `runtime/` is the browser/Tauri boundary.

Prefer placing a component beneath the application surface that owns it. Hoist
it only when two active production surfaces need the same implementation; test
reuse or historical reuse alone is not a reason to create a shared layer.
