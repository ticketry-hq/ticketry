import { useTasksStore } from "../../../../features/studio/stores/tasksStore";

const TASKS_PANE_SELECTOR = '[data-pane="tasks"]';
const IDEA_ENTRY_SELECTOR = '[data-idea-entry="true"]';
const SEARCH_INPUT_SELECTOR = 'input[aria-label="Search stories"]';
const STORY_ROW_SELECTOR = "[data-task-id]";
const STORY_TREE_SELECTOR = '[role="tree"]';

function focusAndReveal(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest" });
}

export function focusIdeaEntry(): void {
  const entry = document.querySelector<HTMLElement>(
    `${TASKS_PANE_SELECTOR} ${IDEA_ENTRY_SELECTOR}`,
  );
  if (entry) focusAndReveal(entry);
}

export function focusStoriesSearch(): void {
  const search = document.querySelector<HTMLElement>(
    `${TASKS_PANE_SELECTOR} ${SEARCH_INPUT_SELECTOR}`,
  );
  if (search) focusAndReveal(search);
}

export function focusFirstStory(from: HTMLElement | null): void {
  const firstStory = from
    ?.closest(TASKS_PANE_SELECTOR)
    ?.querySelector<HTMLElement>(STORY_ROW_SELECTOR);
  const taskId = firstStory?.dataset.taskId;
  if (!firstStory || !taskId) return;

  useTasksStore.setState({
    selectedTaskId: taskId,
    workspaceSelection: { kind: "task" },
  });
  focusAndReveal(firstStory);
}

export function focusStoryTree(from: HTMLElement | null): void {
  const tree = from
    ?.closest(TASKS_PANE_SELECTOR)
    ?.querySelector<HTMLElement>(STORY_TREE_SELECTOR);
  if (tree) focusAndReveal(tree);
}
