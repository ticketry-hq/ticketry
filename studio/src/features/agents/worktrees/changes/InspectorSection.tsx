import { useRef, type ReactNode } from "react";

import {
  branchInspectorSectionOpen,
  setBranchInspectorSection,
  useBranchInspector,
  type BranchInspectorSection,
} from "./branchInspectorState";

export function InspectorSection({ section, title, chip, children }: {
  section: BranchInspectorSection;
  title: string;
  chip?: string | null;
  children: ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const open = useBranchInspector((state) => branchInspectorSectionOpen(state, section));
  return (
    <details
      ref={detailsRef}
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        if (!nextOpen && event.currentTarget.contains(document.activeElement)) {
          event.currentTarget.querySelector("summary")?.focus({ preventScroll: true });
        }
        setBranchInspectorSection(section, nextOpen);
      }}
      className="border-b border-pane-border"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent">
        <span aria-hidden="true" className="w-2 text-xs text-text-muted">{open ? "▾" : "▸"}</span>
        {title}
        {chip ? <span className="ml-auto border border-pane-border px-1.5 py-0.5 font-mono text-xs font-normal text-text-secondary">{chip}</span> : null}
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
    </details>
  );
}
