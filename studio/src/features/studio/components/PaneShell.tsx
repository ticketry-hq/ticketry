import { forwardRef, useEffect, useRef } from "react";
import type { FocusedPane } from "../stores/uiStore";
import { useUIStore } from "../stores/uiStore";

interface PaneShellProps {
  title?: string;
  pane: FocusedPane;
  children?: React.ReactNode;
}

/**
 * Pane wrapper: title header, scrollable body, and a focusable root that
 * carries `tabIndex={-1}` so the global keymap's focusLeft/focusRight can
 * move DOM focus into it. The pane root also reports clicks/focus back
 * into `uiStore.setFocusedPane` so a click can shift focus too.
 */
export const PaneShell = forwardRef<HTMLDivElement, PaneShellProps>(
  function PaneShell({ title, pane, children }, externalRef) {
    const focusedPane = useUIStore((s) => s.focusedPane);
    const editViewZone = useUIStore((s) => s.editViewZone);
    const navigationModality = useUIStore((s) => s.navigationModality);
    const sidebarVisible = useUIStore((s) => s.sidebarVisible);
    const setFocusedPane = useUIStore((s) => s.setFocusedPane);
    const setEditViewZone = useUIStore((s) => s.setEditViewZone);
    const setNavigationModality = useUIStore((s) => s.setNavigationModality);
    const innerRef = useRef<HTMLDivElement | null>(null);

    const isEditView = !sidebarVisible;
    const isStoriesZone = isEditView && pane === "tasks";
    const isWorkspaceZoneHost =
      isEditView && pane === "details-or-terminal";
    const focused = isEditView
      ? isStoriesZone
        ? editViewZone === "stories"
        : true
      : focusedPane === pane;
    const suppressStoriesZoneChrome =
      isStoriesZone && navigationModality === "pointer";
    const emphasisClass = isWorkspaceZoneHost
      ? ""
      : suppressStoriesZoneChrome
        ? ""
        : focused
          ? "ring-1 ring-focus-accent ring-inset"
          : "opacity-[0.65]";

    // Bring DOM focus into the pane wrapper when focusedPane changes to us.
    useEffect(() => {
      if (focused && !isWorkspaceZoneHost && innerRef.current) {
        if (document.activeElement !== innerRef.current) {
          innerRef.current.focus({ preventScroll: true });
        }
      }
    }, [focused, isWorkspaceZoneHost]);

    function claimFocus(): void {
      if (isStoriesZone) {
        setEditViewZone("stories");
      } else {
        setFocusedPane(pane);
      }
    }

    function claimPointerFocus(): void {
      if (isStoriesZone) {
        setNavigationModality("pointer");
      }
      claimFocus();
    }

    function setRefs(node: HTMLDivElement | null): void {
      innerRef.current = node;
      if (typeof externalRef === "function") externalRef(node);
      else if (externalRef) externalRef.current = node;
    }

    return (
      <div
        ref={setRefs}
        tabIndex={isWorkspaceZoneHost ? undefined : -1}
        data-pane={pane}
        data-navigation-zone={isStoriesZone ? "stories" : undefined}
        onMouseDown={claimPointerFocus}
        onFocus={claimFocus}
        className={`hide-scrollbars flex h-full flex-col border-r border-pane-border bg-pane-panel outline-none transition-opacity duration-150 motion-reduce:transition-none ${emphasisClass}`}
      >
        {title && (
          <div className="h-7 shrink-0 bg-pane-title px-2 text-center text-xs font-bold uppercase leading-7 tracking-wider text-text-primary">
            {title}
          </div>
        )}
        <div className="flex-1 overflow-auto p-2 text-sm">{children}</div>
      </div>
    );
  },
);
