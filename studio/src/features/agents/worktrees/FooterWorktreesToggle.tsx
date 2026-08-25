import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useStudioStore } from "../../projects/store";
import { useClientStore } from "../../../state/clientStore";
import { IconDependency } from "../../../shared/ui/icons";
import { WorktreesPanel } from "./WorktreesPanel";
import { studioRuntime } from "../../../runtime";
import type { WorktreeRevealRuntime } from "./OpenWorktreeInFinder";

export function FooterWorktreesToggle({
  runtime = studioRuntime(),
}: {
  runtime?: WorktreeRevealRuntime;
} = {}) {
  const projectId = useStudioStore((state) => state.selectedProjectId);
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const unavailable = !projectId || !moduleId;

  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => setOpen(false), [moduleId, projectId]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) {
        closeAndRestoreFocus();
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
    };
  }, [closeAndRestoreFocus, open]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    closeAndRestoreFocus();
  }

  const label = unavailable
    ? "Select a module to view worktrees"
    : open
      ? "Close Worktrees panel"
      : "Open Worktrees panel";

  return (
    <div ref={hostRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={unavailable}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-1 px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-muted"
      >
        <IconDependency size={14} />
        <span>Worktrees</span>
      </button>
      {open && projectId && moduleId ? (
        <WorktreesPanel
          projectId={projectId}
          moduleId={moduleId}
          runtime={runtime}
        />
      ) : null}
    </div>
  );
}
