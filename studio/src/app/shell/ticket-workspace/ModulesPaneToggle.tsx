import { useSyncExternalStore } from "react";

import { IconPanelLeft } from "../../../shared/ui/icons";
import { useClientStore } from "../../../state/clientStore";
import { formatChordSymbols } from "../../navigation/chordLabel";
import { studioKeymapRegistry } from "../../navigation/keymapRegistry";

export function ModulesPaneToggle() {
  useSyncExternalStore(
    studioKeymapRegistry.subscribe,
    studioKeymapRegistry.getRevision,
  );
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);
  const toggleSidebar = useClientStore((state) => state.toggleSidebar);
  const action = sidebarVisible ? "Close Modules pane" : "Open Modules pane";
  const binding = studioKeymapRegistry
    .getEffectiveBindings()
    .find(
      (candidate) =>
        candidate.context === "global"
        && candidate.actionId === "toggle-sidebar",
    );

  return (
    <button
      type="button"
      data-testid="modules-pane-toggle"
      aria-label={action}
      aria-expanded={sidebarVisible}
      title={action}
      onClick={toggleSidebar}
      className="flex h-full shrink-0 items-center gap-1 border-r border-pane-border px-2 text-xs text-text-muted hover:bg-pane-panel hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent focus-visible:ring-inset"
    >
      <IconPanelLeft size={14} />
      <span>Modules</span>
      {binding ? (
        <span className="font-bold text-focus-accent">
          {formatChordSymbols(binding.chord)}
        </span>
      ) : null}
    </button>
  );
}
