import { createContext, useCallback, useLayoutEffect, useRef, type RefObject } from "react";

export const PlanPaneMoveFocus = createContext<((target: HTMLElement | null) => void) | null>(null);

/** Retain keyboard handoff ownership through temporary eligibility/read gates. */
export function usePlanPaneMoveFocus(pane: RefObject<HTMLElement | null>) {
  const requested = useRef<HTMLElement | null>(null);
  const reconcile = useCallback(() => {
    const target = requested.current;
    const heading = pane.current?.querySelector("h2");
    if (!target || !heading) return;
    const active = document.activeElement;
    if (active !== target && active !== heading && active !== document.body) {
      requested.current = null;
      return;
    }
    if (!target.isConnected || !pane.current?.contains(target)) {
      requested.current = null;
      heading.focus();
    } else if (target instanceof HTMLButtonElement && target.disabled) {
      heading.focus();
    } else {
      target.focus();
    }
  }, [pane]);
  const handoff = useCallback((target: HTMLElement | null) => {
    requested.current = target;
    // The disappearing row still owns focus during its layout cleanup.
    const heading = pane.current?.querySelector("h2");
    if (target instanceof HTMLButtonElement && target.disabled) heading?.focus();
    else target?.focus();
  }, [pane]);

  useLayoutEffect(() => {
    const clear = () => { requested.current = null; };
    const focusChanged = (event: FocusEvent) => {
      if (event.target !== requested.current && event.target !== pane.current?.querySelector("h2")) clear();
    };
    document.addEventListener("pointerdown", clear, true);
    document.addEventListener("keydown", clear, true);
    document.addEventListener("focusin", focusChanged, true);
    const observer = new MutationObserver(reconcile);
    if (pane.current) observer.observe(pane.current, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    return () => {
      clear();
      observer.disconnect();
      document.removeEventListener("pointerdown", clear, true);
      document.removeEventListener("keydown", clear, true);
      document.removeEventListener("focusin", focusChanged, true);
    };
  }, [pane, reconcile]);
  useLayoutEffect(reconcile);
  return handoff;
}
