import { forwardRef, useEffect, useRef } from "react";
import type { FocusedPane } from "../../state/clientStore";
import { useClientStore } from "../../state/clientStore";
import { isDialogFocusTarget } from "../../shared/utilities/keyboard";

interface PaneShellProps {
  title?: string;
  titleCasing?: "uppercase" | "preserve";
  pane: FocusedPane;
  children?: React.ReactNode;
}

/**
 * Pane wrapper: title header, bounded body, and a focusable root that carries
 * `tabIndex={-1}` so the global keymap's focusLeft/focusRight can move DOM
 * focus into it. Stories scroll here; the selected workspace's active surface
 * owns its scrolling. The pane root also reports clicks/focus back into
 * `clientStore.setFocusedPane` so a click can shift focus too.
 */
export const PaneShell = forwardRef<HTMLDivElement, PaneShellProps>(
  function PaneShell(
    { title, titleCasing = "uppercase", pane, children },
    externalRef,
  ) {
    const focusedPane = useClientStore((s) => s.focusedPane);
    const editViewZone = useClientStore((s) => s.editViewZone);
    const navigationModality = useClientStore((s) => s.navigationModality);
    const sidebarVisible = useClientStore((s) => s.sidebarVisible);
    const setFocusedPane = useClientStore((s) => s.setFocusedPane);
    const setEditViewZone = useClientStore((s) => s.setEditViewZone);
    const setNavigationModality = useClientStore((s) => s.setNavigationModality);
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
        if (
          !isDialogFocusTarget(document.activeElement)
          && !innerRef.current.contains(document.activeElement)
        ) {
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
          <div
            data-testid={`${pane}-pane-title`}
            data-title-casing={titleCasing}
            className={`h-7 shrink-0 bg-pane-title px-2 text-center text-xs font-bold leading-7 tracking-wider text-text-primary ${
              titleCasing === "uppercase" ? "uppercase" : ""
            }`}
          >
            {title}
          </div>
        )}
        {/* The workspace pane hosts the terminal, which must sit flush against
            the pane's bottom edge — no padding below it. */}
        <div
          data-testid={`${pane}-pane-body`}
          className={`min-h-0 flex-1 text-sm ${
            pane === "details-or-terminal"
              ? "overflow-hidden px-2 pt-2 pb-0"
              : "overflow-auto p-2"
          }`}
        >
          {children}
        </div>
      </div>
    );
  },
);
