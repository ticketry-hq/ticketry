# Shared layouts

## `studio/src/app/shell/StudioLayout.tsx`

The desktop app is a full-height, resizable multi-pane workbench: navigation panes on the left and the active workspace on the right.

```tsx
import { Panel, PanelGroup } from "react-resizable-panels";
import { StudioSidebar } from "./sidebar/StudioSidebar";
import { TicketWorkspace } from "./ticket-workspace/TicketWorkspace";

export function StudioLayout() {
  return (
    <PanelGroup direction="horizontal" className="h-full w-full">
      <StudioSidebar />
      <Panel minSize={30}>
        <TicketWorkspace />
      </Panel>
    </PanelGroup>
  );
}
```

## `studio/src/app/shell/StudioShell.tsx`

The workspace occupies all available height above a persistent 24px command-hint footer.

```tsx
import { StudioFooter } from "./StudioFooter";
import { StudioLayout } from "./StudioLayout";

export function StudioShell() {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1"><StudioLayout /></div>
      <StudioFooter />
    </div>
  );
}
```

## `studio/src/app/shell/StudioFooter.tsx`

```tsx
export function StudioFooter() {
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-pane-border bg-pane-title px-3 text-xs text-text-primary">
      <span className="flex items-center gap-1">
        <span className="bg-pane-bg px-1.5 py-0.5 font-bold text-focus-accent">⌘K</span>
        <span className="text-text-muted">— Search</span>
      </span>
      <button className="ml-auto px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary">Settings</button>
    </div>
  );
}
```
