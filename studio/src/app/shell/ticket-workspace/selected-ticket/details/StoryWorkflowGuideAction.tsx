export function StoryWorkflowGuideAction({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-label="Story workflow guide"
      title="Story workflow guide"
      data-story-workflow-guide-toolbar
      onClick={(event) => {
        event.currentTarget.focus();
        onOpen();
      }}
      className="inline-flex h-7 flex-none items-center whitespace-nowrap border border-pane-border px-2 text-sm text-text-muted hover:border-text-muted hover:text-text-primary"
    >
      Story workflow guide
    </button>
  );
}
