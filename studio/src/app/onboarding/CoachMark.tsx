import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

interface Props {
  anchor: string;
  title: string;
  description: string;
  children?: ReactNode;
  focusDialog?: boolean;
}

interface Placement {
  top: number;
  left: number;
  side: "above" | "below" | "left" | "right";
}

interface Rect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

const CALLOUT_GAP = 8;
const VIEWPORT_MARGIN = 16;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

/**
 * Places the teaching card beside the highlighted surface. The first side
 * with enough room wins; when a small viewport has no perfect side, the
 * roomiest side is clamped on screen rather than allowed to disappear beyond
 * an edge.
 */
export function coachMarkPlacement({
  anchor,
  boundary = anchor,
  callout,
  viewport,
  preferHorizontal = false,
}: {
  anchor: Rect;
  boundary?: Rect;
  callout: Pick<Rect, "width" | "height">;
  viewport: { width: number; height: number };
  preferHorizontal?: boolean;
}): Placement {
  const spaces = {
    below: viewport.height - VIEWPORT_MARGIN - boundary.bottom,
    above: boundary.top - VIEWPORT_MARGIN,
    right: viewport.width - VIEWPORT_MARGIN - boundary.right,
    left: boundary.left - VIEWPORT_MARGIN,
  };
  const required = {
    below: callout.height + CALLOUT_GAP,
    above: callout.height + CALLOUT_GAP,
    right: callout.width + CALLOUT_GAP,
    left: callout.width + CALLOUT_GAP,
  };
  const preferred: Placement["side"][] = preferHorizontal
    ? ["right", "left", "below", "above"]
    : ["below", "above", "right", "left"];
  const side =
    preferred.find((candidate) => spaces[candidate] >= required[candidate]) ??
    [...preferred].sort((left, right) => spaces[right] - spaces[left])[0]!;
  const maxLeft = viewport.width - VIEWPORT_MARGIN - callout.width;
  const maxTop = viewport.height - VIEWPORT_MARGIN - callout.height;
  const alignedLeft = clamp(
    anchor.left + (anchor.width - callout.width) / 2,
    VIEWPORT_MARGIN,
    maxLeft,
  );
  const alignedTop = clamp(
    anchor.top + (anchor.height - callout.height) / 2,
    VIEWPORT_MARGIN,
    maxTop,
  );

  switch (side) {
    case "above":
      return {
        side,
        top: clamp(
          boundary.top - CALLOUT_GAP - callout.height,
          VIEWPORT_MARGIN,
          maxTop,
        ),
        left: alignedLeft,
      };
    case "left":
      return {
        side,
        top: alignedTop,
        left: clamp(
          boundary.left - CALLOUT_GAP - callout.width,
          VIEWPORT_MARGIN,
          maxLeft,
        ),
      };
    case "right":
      return {
        side,
        top: alignedTop,
        left: clamp(boundary.right + CALLOUT_GAP, VIEWPORT_MARGIN, maxLeft),
      };
    case "below":
      return {
        side,
        top: clamp(boundary.bottom + CALLOUT_GAP, VIEWPORT_MARGIN, maxTop),
        left: alignedLeft,
      };
  }
  throw new Error(`Unsupported coach-mark side: ${side satisfies never}`);
}

/** Anchored teaching callout. It is intentionally non-modal and never traps focus. */
export default function CoachMark({
  anchor,
  title,
  description,
  children,
  focusDialog = true,
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const highlightedAnchorRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const highlightAnchor = useCallback((target: HTMLElement | null) => {
    if (highlightedAnchorRef.current === target) return;
    highlightedAnchorRef.current?.removeAttribute("data-coach-highlight");
    target?.setAttribute("data-coach-highlight", "true");
    highlightedAnchorRef.current = target;
  }, []);

  const place = useCallback(() => {
    const target = document.querySelector<HTMLElement>(
      `[data-coach-anchor="${anchor}"]`,
    );
    anchorRef.current = target;
    highlightAnchor(target);
    if (!target) {
      setPlacement(null);
      return;
    }
    const callout = dialogRef.current?.getBoundingClientRect();
    if (!callout || callout.width <= 0 || callout.height <= 0) {
      setPlacement(null);
      return;
    }
    setPlacement(
      coachMarkPlacement({
        anchor: target.getBoundingClientRect(),
        callout,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [anchor, highlightAnchor]);

  useLayoutEffect(() => {
    place();
    if (focusDialog) dialogRef.current?.focus();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      highlightAnchor(null);
    };
  }, [highlightAnchor, place]);

  return (
    <aside
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-placement={placement ? "anchored" : "in-flow"}
      data-placement-side={placement?.side}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        anchorRef.current?.focus();
      }}
      style={placement ? { position: "fixed", top: placement.top, left: placement.left } : undefined}
      className={`${
        placement ? "z-[70]" : "relative z-10 mx-4 my-3"
      } w-[min(22rem,calc(100vw-2rem))] border border-focus-accent bg-pane-panel p-4 text-left shadow-2xl outline-none focus:ring-2 focus:ring-focus-accent`}
    >
      <h2 id={titleId} className="text-base font-semibold text-text-primary">
        {title}
      </h2>
      <p id={descriptionId} className="mt-1 text-sm leading-5 text-text-secondary">
        {description}
      </p>
      {children != null ? <div className="mt-4">{children}</div> : null}
    </aside>
  );
}
