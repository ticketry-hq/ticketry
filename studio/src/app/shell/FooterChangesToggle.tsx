import { IconGitBranch } from "../../shared/ui/icons";
import { useClientStore } from "../../state/clientStore";
import { openModuleChangesWorkspace } from "./ticket-workspace/selected-ticket/internal/openChangesWorkspace";

export function FooterChangesToggle() {
  const moduleId = useClientStore((state) => state.selectedModuleId);
  const label = moduleId ? "Open module Changes" : "Select a module to open Changes";
  return (
    <button
      type="button"
      data-testid="footer-module-changes"
      aria-label={label}
      title={label}
      disabled={!moduleId}
      onClick={() => moduleId && openModuleChangesWorkspace(moduleId)}
      className="flex items-center gap-1 px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <IconGitBranch size={14} data-testid="version-control-icon" />
      <span>Changes</span>
    </button>
  );
}
