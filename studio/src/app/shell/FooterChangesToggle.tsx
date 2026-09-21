import { IconGitBranch } from "../../shared/ui/icons";
import {
  leaveChangesWorkspace,
  openModuleChangesWorkspace,
  useChangesWorkspace,
} from "../../features/agents/worktrees";
import { useClientStore } from "../../state/clientStore";

export function FooterChangesToggle() {
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const changesActive = useChangesWorkspace((state) => state.active);
  const label = changesActive
    ? "Back to planning workspace"
    : moduleId
      ? "Open module Changes"
      : "Select a module to open Changes";
  const handleClick = () => {
    if (changesActive) {
      leaveChangesWorkspace();
      requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(
          '[data-testid="footer-module-changes"]',
        )?.focus();
      });
      return;
    }
    if (moduleId) openModuleChangesWorkspace(moduleId);
  };
  return (
    <button
      type="button"
      data-testid="footer-module-changes"
      aria-label={label}
      title={label}
      disabled={!changesActive && !moduleId}
      onClick={handleClick}
      aria-pressed={changesActive}
      className={
        // Full-height and flush with the pane above when active, so the
        // Changes view reads as emerging from this button rather than
        // floating over an unrelated status bar.
        "flex h-full items-center gap-1 px-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent "
        + (changesActive
          ? "bg-pane-bg font-semibold text-text-primary shadow-[inset_0_-2px_0_0_#7aa2f7]"
          : "text-text-muted hover:bg-pane-bg hover:text-text-primary")
      }
    >
      <IconGitBranch size={14} data-testid="version-control-icon" />
      <span>{changesActive ? "Back" : "Changes"}</span>
    </button>
  );
}
