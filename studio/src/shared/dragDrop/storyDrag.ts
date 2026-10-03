import type { DragEvent } from "react";

// Native HTML5 drag payload for a story card, as Ticketry's planning drags
// use typed MIME payloads rather than a drag-and-drop library.
export const STORY_DRAG_TYPE = "application/x-ticketry-story";

// Browsers hide drag payloads until drop, so hover feedback (the reorder edge)
// reads the id of the story being dragged from here.
let activeStoryId: string | null = null;

export function startStoryDrag(event: DragEvent, storyId: string): void {
  event.dataTransfer.setData(STORY_DRAG_TYPE, storyId);
  event.dataTransfer.effectAllowed = "move";
  activeStoryId = storyId;
}

export function endStoryDrag(): void {
  activeStoryId = null;
}

/** The story currently being dragged in this window, if any. */
export function draggedStoryId(): string | null {
  return activeStoryId;
}

/** Whether the drag carries a story (payloads are unreadable until drop). */
export function carriesStory(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(STORY_DRAG_TYPE);
}

export function droppedStoryId(event: DragEvent): string | null {
  return event.dataTransfer.getData(STORY_DRAG_TYPE) || null;
}
