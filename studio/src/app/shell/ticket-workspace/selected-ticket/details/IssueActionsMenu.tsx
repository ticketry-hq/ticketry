import { useEffect, useRef, useState } from "react";

interface IssueActionsMenuProps {
  hasSubtasks: boolean;
  onDelete: () => Promise<void>;
}

export default function IssueActionsMenu({
  hasSubtasks,
  onDelete,
}: IssueActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const dismissOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("mousedown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("mousedown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  const chooseDelete = () => {
    setOpen(false);
    void onDelete();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Issue actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="issue-actions-menu"
        title="Issue actions"
        data-testid="issue-actions-trigger"
        onClick={() => setOpen((value) => !value)}
        className="rounded px-1.5 py-0.5 text-base leading-none text-text-secondary transition-colors hover:bg-pane-title hover:text-text-primary"
      >
        ⋯
      </button>

      {open && (
        <div
          id="issue-actions-menu"
          role="menu"
          aria-label="Issue actions"
          className="absolute right-0 top-full z-10 mt-1 min-w-[150px] border border-pane-border bg-pane-panel py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={hasSubtasks}
            title={hasSubtasks ? "Remove sub-tasks first" : "Delete this issue"}
            data-testid="delete-issue"
            onClick={chooseDelete}
            className="block w-full px-3 py-1.5 text-left text-sm text-lifecycle-danger hover:bg-pane-title disabled:cursor-not-allowed disabled:text-text-muted"
          >
            Delete issue…
          </button>
        </div>
      )}
    </div>
  );
}
