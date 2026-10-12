import type { IssueLevel } from "../types";

/** The generated server string is narrowed once for workflow domain consumers. */
export function selectIssueTypeLevel<T extends { level: string }>(
  row: T,
): Omit<T, "level"> & { level: IssueLevel } {
  return { ...row, level: row.level as IssueLevel };
}
