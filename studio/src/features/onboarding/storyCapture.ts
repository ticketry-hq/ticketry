import { getWorkflowCatalogSnapshot } from "../workflows/queries/projectCatalog";

/**
 * Whether the tour can teach Story capture in this project. Core projects
 * seed no Story type (CODING-2860), so their tour ends after the first module.
 * Only a cached catalog that lacks the Story type ends the tour early; an
 * unread catalog keeps the full tour.
 */
export function projectHasStoryType(projectId: string): boolean {
  const catalog = getWorkflowCatalogSnapshot(projectId);
  if (!catalog) return true;
  return catalog.issueTypes.some(
    (type) => type.level === "task" && type.name === "Story",
  );
}
