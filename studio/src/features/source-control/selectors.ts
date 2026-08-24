import type { ShipRecord } from "@worktracker/typescript-sdk/models";
import { safeExternalHref } from "../../shared/ui/SafeExternalLink";
import { formatRelativeActionTime } from "./relativeTime";

type RenderablePrShipRecord = ShipRecord & {
  pr_number: number;
  pr_url: string;
};

export function selectLatestPrShipRecord(
  records: readonly ShipRecord[],
): RenderablePrShipRecord | null {
  return records.find(
    (record): record is RenderablePrShipRecord =>
      record.pr_url !== null &&
      record.pr_number !== null &&
      safeExternalHref(record.pr_url) !== null &&
      formatRelativeActionTime(record.action_at) !== null,
  ) ?? null;
}
