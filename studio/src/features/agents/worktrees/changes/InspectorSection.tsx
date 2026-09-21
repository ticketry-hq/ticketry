import type { ReactNode } from "react";

import {
  branchInspectorSectionOpen,
  setBranchInspectorSection,
  useBranchInspector,
  type BranchInspectorSection,
} from "./branchInspectorState";

/**
 * One disclosure inside the branch inspector.
 *
 * The summary carries a state chip so a collapsed section still reports what
 * it holds; a reader never has to open all four to find the one that is
 * blocked. Open state is remembered per section for the session.
 */
export function InspectorSection({
  section,
  title,
  chip,
  chipTone = "muted",
  children,
}: {
  section: BranchInspectorSection;
  title: string;
  chip?: string | null;
  chipTone?: "danger" | "attention" | "success" | "muted";
  children: ReactNode;
}) {
  const open = useBranchInspector((state) => branchInspectorSectionOpen(state, section));
  const dot = chipTone === "danger"
    ? "bg-lifecycle-danger"
    : chipTone === "attention"
      ? "bg-lifecycle-attention"
      : chipTone === "success"
        ? "bg-lifecycle-success"
        : "bg-text-muted";
  return (
    <details
      open={open}
      onToggle={(event) => setBranchInspectorSection(section, event.currentTarget.open)}
      className="border-b border-pane-border"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 font-medium text-text-primary">
        <span aria-hidden="true" className="w-2 text-xs text-text-muted">{open ? "▾" : "▸"}</span>
        {title}
        {chip ? (
          <span className="ml-auto flex items-center gap-1.5 border border-pane-border px-1.5 py-0.5 font-mono text-xs font-normal text-text-secondary">
            <span aria-hidden="true" className={`size-2 ${dot}`} />
            {chip}
          </span>
        ) : null}
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3">{children}</div>
    </details>
  );
}
