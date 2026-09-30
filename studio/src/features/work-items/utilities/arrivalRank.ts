import { compactWorktrackerId } from "../../../shared/api/generatedWorktracker";
import { rankBetween } from "./rank";

interface ArrivalRankItem {
  readonly state_id: string | null;
  readonly rank: string;
  readonly is_archived: boolean;
}

export function arrivalRank(
  items: readonly ArrivalRankItem[],
  destinationStateId: string | null,
): string {
  if (destinationStateId === null) return rankBetween(null, null);
  const destination = compactWorktrackerId(destinationStateId);
  const firstRank = items
    .filter((item) =>
      !item.is_archived
      && item.rank !== ""
      && item.state_id !== null
      && compactWorktrackerId(item.state_id) === destination
    )
    .map((item) => item.rank)
    .sort()[0] ?? null;

  return rankBetween(null, firstRank);
}
