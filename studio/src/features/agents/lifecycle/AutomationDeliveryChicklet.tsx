import {
  AUTOMATION_DELIVERY_PRESENTATION,
  useTaskAutomationDelivery,
} from "../status";

interface Props {
  /** The issue's UUID (what the agent host keys Automation Attempts by). */
  issueId: string;
  /** Descendant issue UUIDs to roll up (e.g. a story's sub-tasks). */
  descendantIds?: string[];
  className?: string;
}

/**
 * Read-only chicklet naming how the newest automated transition on this Work
 * Item reached its agent: it continued the live session, or it started a fresh
 * one. Nothing else on the row distinguishes the two — a continued handoff
 * mints no run — so without this the durable delivery mode is unobservable.
 *
 * Renders nothing until a transition has actually been delivered, which keeps
 * interactive and Run now launches (they carry no automation lineage) silent.
 */
export function AutomationDeliveryChicklet({
  issueId,
  descendantIds = [],
  className,
}: Props) {
  const delivery = useTaskAutomationDelivery(issueId, descendantIds);
  if (!issueId || delivery === null) return null;
  const presentation = AUTOMATION_DELIVERY_PRESENTATION[delivery.mode];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 border border-pane-border bg-pane-panel px-1 text-[10px] font-medium leading-4 text-text-muted ${className ?? ""}`}
      data-testid="automation-delivery-chicklet"
      data-delivery-mode={delivery.mode}
      title={presentation.description}
    >
      <span aria-hidden="true">{presentation.glyph}</span>
      <span>{presentation.label}</span>
      <span className="sr-only">{presentation.description}</span>
    </span>
  );
}
