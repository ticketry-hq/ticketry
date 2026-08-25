import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

export type AnchoredOverlayAlign = "left" | "right";

/**
 * Viewport coordinates for a `position: fixed` overlay pinned under an anchor
 * element.
 *
 * Dropdowns in this app live inside scroll containers — the workspace tab strip
 * (`overflow-x-auto`) and the issue sidebar (`overflow-y-auto`) — and an
 * absolutely positioned panel is clipped by those containers no matter how high
 * its z-index goes. Taking the panel out of flow with `fixed` is the fix; this
 * hook keeps it anchored to its trigger through scroll and resize while open.
 */
export function useAnchoredOverlayPosition(
  anchorRef: RefObject<HTMLElement>,
  open: boolean,
  align: AnchoredOverlayAlign = "left",
): CSSProperties {
  const [position, setPosition] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition(
        align === "right"
          ? { top: rect.bottom + 4, right: window.innerWidth - rect.right }
          : { top: rect.bottom + 4, left: rect.left },
      );
    };
    update();
    window.addEventListener("resize", update);
    // Passive: the handler only re-anchors the panel, never preventDefault,
    // so it must not be allowed to block scrolling.
    window.addEventListener("scroll", update, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open, align]);

  return position;
}
