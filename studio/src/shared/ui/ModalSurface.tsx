import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalSurfaceProps {
  title?: ReactNode;
  ariaLabel?: string;
  width?: string;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement>;
  children: ReactNode;
  onKeyDownCapture?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function ModalSurface({ title, ariaLabel, width = "w-[70ch]", onClose,
  initialFocusRef, children, onKeyDownCapture }: ModalSurfaceProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const card = cardRef.current;
    if (!card) return;
    const focusTarget =
      initialFocusRef?.current ?? card.querySelector<HTMLElement>(FOCUSABLE);
    (focusTarget ?? card).focus();
    const trapTab = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapTab, true);
    return () => {
      document.removeEventListener("keydown", trapTab, true);
      previousFocus?.focus?.();
    };
  }, [initialFocusRef]);

  function handleKey(event: KeyboardEvent<HTMLDivElement>): void {
    onKeyDownCapture?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-native-terminal-overlay
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={
          ariaLabel ?? (typeof title === "string" ? title : "Dialog")
        }
        tabIndex={-1}
        onKeyDownCapture={handleKey}
        className={`${width} max-h-[85vh] overflow-auto border border-pane-border bg-pane-panel p-4 text-text-primary outline-none`}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? (
            <div className="text-sm font-bold uppercase tracking-wider text-text-muted">
              {title}
            </div>
          ) : <span />}
          <button
            type="button"
            onClick={() => onClose()}
            aria-label="Close dialog"
            className="px-2 py-1 text-lg leading-none text-text-muted hover:bg-pane-title hover:text-text-primary"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
