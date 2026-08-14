import type { IssueType } from "../api/types";

interface IssueTypeLabelProps {
  issueType: Pick<IssueType, "level" | "name">;
}

export function IssueTypeLabel({ issueType }: IssueTypeLabelProps) {
  if (issueType?.level === "module") return null;

  const label = issueType.name;

  return (
    <span
      data-testid="issue-type-label"
      title={`Task type: ${label}`}
      className="inline-flex shrink-0 items-center rounded border border-pane-border bg-pane-bg px-1.5 py-0.5 text-[10px] font-medium leading-none text-text-secondary"
    >
      {label}
    </span>
  );
}
