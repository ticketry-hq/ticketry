import type { IssueType } from "../../shared/api/types";

/** Keep backend-only orchestration roles out of Studio's issue-type catalog. */
export function visibleIssueTypes(issueTypes: IssueType[]): IssueType[] {
  return issueTypes.filter((issueType) => !issueType.is_pathfind);
}
