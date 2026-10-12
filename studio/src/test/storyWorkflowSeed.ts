import { workItem, type HttpFixture } from "./seam";

/**
 * Gives an otherwise empty fixture project the default Story type and Ideas
 * state, so the Stories pane treats it as having a workflow (CODING-2860)
 * without placing a story in any module.
 */
export function seedStoryWorkflow(http: HttpFixture): void {
  http.workItems([workItem({ id: "story-workflow-seed", parent_id: null })]);
}
