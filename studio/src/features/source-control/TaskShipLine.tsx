import { IconExternalLink } from "../../shared/ui/icons";
import {
  SafeExternalLink,
  safeExternalHref,
} from "../../shared/ui/SafeExternalLink";
import { formatRelativeActionTime } from "./relativeTime";
import { selectLatestPrShipRecord } from "./selectors";
import { useTaskShipRecords } from "./queries";

interface TaskShipLineProps {
  projectId: string;
  taskId: string;
}

export function TaskShipLine({ projectId, taskId }: TaskShipLineProps) {
  const records = useTaskShipRecords(projectId, taskId).data ?? [];
  const shipped = selectLatestPrShipRecord(records);
  const relativeTime = shipped
    ? formatRelativeActionTime(shipped.action_at)
    : null;
  if (
    !shipped?.pr_url ||
    shipped.pr_number === null ||
    !safeExternalHref(shipped.pr_url) ||
    !relativeTime
  ) {
    return null;
  }

  return (
    <div className="mt-3 text-sm text-text-secondary" data-testid="task-ship-line">
      Shipped:{" "}
      <SafeExternalLink
        href={shipped.pr_url}
        aria-label={`Open PR #${shipped.pr_number}`}
        className="inline-flex items-center gap-1 text-focus-accent hover:underline"
      >
        PR #{shipped.pr_number}
        <IconExternalLink size={12} aria-hidden="true" />
      </SafeExternalLink>
      {" · "}
      {relativeTime}
    </div>
  );
}
