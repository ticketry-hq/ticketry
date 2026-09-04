import { useEffect, useRef } from "react";
import {
  MODAL_ACTIONS,
  studioKeymapRegistry,
} from "../navigation/keymapRegistry";
import { useModalStore, type ModalKeyBinding } from "./modalStore";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalShellProps {
  title?: React.ReactNode;
  ariaLabel?: string;
  bindings?: ModalKeyBinding[];
  width?: string;
  onClose?: () => void;
  initialFocusRef?: React.RefObject<HTMLElement>;
  children: React.ReactNode;
  onAction?: (actionId: string) => void;
  interceptKeyDown?: (event: KeyboardEvent) => boolean;
}

/**
 * Shared modal shell: scrim, centered card, Escape→popModal, and focus trap.
 * Initial focus prefers the supplied target, then the first focusable child.
 */
export function ModalShell({
  title,
  ariaLabel,
  bindings,
  width = "w-[70ch]",
  onClose,
  initialFocusRef,
  children,
  onAction,
  interceptKeyDown,
}: ModalShellProps) {
  const popModal = useModalStore((s) => s.popModal);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    if (!card) return;
    const focusTarget =
      initialFocusRef?.current ?? card.querySelector<HTMLElement>(FOCUSABLE);
    (focusTarget ?? card).focus();
    const trapTab = (event: KeyboardEvent) => {
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

  function handleKey(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (interceptKeyDown?.(e.nativeEvent)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Escape is intentionally checked outside configurable resolution. It is
    // the reserved, always-available escape hatch for the top modal.
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (onClose) onClose();
      else popModal();
      return;
    }
    const actionIds = new Set(
      bindings?.flatMap(({ actionId }) =>
        typeof actionId === "string" ? [actionId] : actionId,
      ),
    );
    const actionId = studioKeymapRegistry.resolve(
      "modal",
      e.nativeEvent,
      actionIds,
    );
    if (!actionId || actionId === MODAL_ACTIONS.close) return;
    e.preventDefault();
    e.stopPropagation();
    onAction?.(actionId);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      data-native-terminal-overlay
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          (onClose ?? popModal)();
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
            onClick={() => (onClose ?? popModal)()}
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
