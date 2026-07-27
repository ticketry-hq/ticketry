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
  const dialogRef = useRef<HTMLElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const place = useCallback(() => {
    const target = document.querySelector<HTMLElement>(
      `[data-coach-anchor="${anchor}"]`,
    );
    anchorRef.current = target;
    if (!target) {
      setPlacement(null);
      return;
    }
    const rect = target.getBoundingClientRect();
    setPlacement({ top: rect.bottom + 8, left: rect.left });
  }, [anchor]);

  useLayoutEffect(() => {
    place();
    if (focusDialog) dialogRef.current?.focus();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [place]);

  return (
    <aside
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-placement={placement ? "anchored" : "in-flow"}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        anchorRef.current?.focus();
      }}
      style={placement ? { position: "fixed", top: placement.top, left: placement.left } : undefined}
      className={`${
        placement ? "z-[70]" : "relative z-10 mx-4 my-3"
      } w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-focus-accent bg-pane-panel p-4 text-left shadow-2xl outline-none focus:ring-2 focus:ring-focus-accent`}
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
