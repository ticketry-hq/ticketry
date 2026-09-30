# Routes

Ticketry is a state-driven Tauri desktop app, not a URL-routed web product.

| View | Entry | Layout |
| --- | --- | --- |
| Main workbench | `studio/src/app/StudioApp.tsx` | `StudioShell` → `StudioLayout` |
| Project and module navigation | `studio/src/app/shell/sidebar/StudioSidebar.tsx` | Left resizable panes |
| Task workspace | `studio/src/app/shell/ticket-workspace/TicketWorkspace.tsx` | Task list and selected task panes |
| Settings | `studio/src/features/studio/modals/SettingsModal.tsx` | Modal over the workbench |

The app-server schema explorer is a new developer tool view. It should be self-contained and should not imitate a public website or marketing page.
