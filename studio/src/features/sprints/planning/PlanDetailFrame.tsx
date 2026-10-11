import type { ReactNode } from "react";
import { reviewFocus, useRemovalFocus } from "./useRemovalFocus";

export function PlanDetailFrame({ openItem, children, onClose }: {
  openItem: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const panel = useRemovalFocus<HTMLElement>((element) => reviewFocus(element, openItem));
  return <aside ref={panel} aria-label="Selected ticket" className="flex min-h-0 min-w-0 flex-col border-l border-pane-border bg-pane-panel md:w-[38%]">
    <button type="button" aria-label="Close selected ticket" onClick={onClose}
      className="self-end px-3 py-1 text-text-muted">×</button>
    {children}
  </aside>;
}

export function PlanDetailContent({ children }: { children: ReactNode }) {
  const content = useRemovalFocus<HTMLDivElement>((element) =>
    element.closest("aside")?.querySelector('button[aria-label="Close selected ticket"]') ?? null);
  return <div ref={content} className="flex min-h-0 flex-1 flex-col">{children}</div>;
}
