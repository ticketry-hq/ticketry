import { useWorkItem } from "./queries";
import { formatFindingLocation } from "./findingLocation";

export function FindingLocationLabel({ issueId }: { issueId: string }) {
  const { data } = useWorkItem(issueId);
  const location = formatFindingLocation(data?.description);
  return location ? (
    <span
      className="hidden flex-none truncate font-mono text-xs text-text-muted sm:inline"
      data-testid="finding-location"
      title={location}
    >
      {location}
    </span>
  ) : null;
}
