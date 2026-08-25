import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAnchoredOverlayPosition } from "../../../../../../shared/ui/anchoredOverlayPosition";

interface PopoverProps {
  /** The clickable trigger; receives open, onClick, and disabled states to render the button directly. */
  trigger: (props: { open: boolean; onClick: () => void; disabled?: boolean }) => ReactNode;
  /** The popover body; `close` dismisses it. */
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  disabled?: boolean;
  "data-testid"?: string;
}

// A small click-to-open popover with outside-click + Escape dismissal, shared
// by every inline field picker. Mirrors the ProjectSwitcher dropdown idiom.
export default function Popover({
  trigger,
  children,
  align = "left",
  disabled,
  "data-testid": testId,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The panel is position:fixed so it escapes any ancestor scroll container —
  // the pickers live inside the issue sidebar (overflow-y-auto), which would
  // otherwise clip a shrink-to-fit panel wider than the sidebar.
  const pos = useAnchoredOverlayPosition(ref, open, align);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref} data-testid={testId}>
      {trigger({ open, onClick: () => setOpen((v) => !v), disabled })}
      {open && (
        <div
          style={pos}
          className="fixed z-50 w-max min-w-[200px] max-w-[380px] overflow-hidden border border-pane-border bg-pane-panel py-1 shadow-2xl"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

interface OptionProps {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}

// A uniform popover row used by the pickers.
export function PopoverOption({ selected, onClick, children }: OptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-base hover:bg-pane-title ${
        selected ? "text-focus-accent" : "text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}
