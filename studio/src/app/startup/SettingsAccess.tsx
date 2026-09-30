import { IconSettings } from "../../shared/ui/icons";
import { useModalStore } from "../modal/modalStore";

// Same chunks the footer button warms, so opening Settings from a gate screen
// is not a cold lazy load.
const preloadSettings = () => {
  void import("../../features/studio/modals/SettingsModal");
  void import("../../features/workflows");
};

/**
 * Open Settings from a startup gate screen (#1371).
 *
 * The footer button and the global `e` chord both live inside `StudioShell`,
 * which the service-health and bootstrap gates replace outright. Without this
 * affordance a user held on a gate screen — routine in the web version, where
 * the frontend is served independently of the Rust adapter — cannot reach
 * Settings at all. `ModalHost` is mounted outside the gates, so the modal
 * presents over the gate screen.
 */
export function SettingsAccess() {
  const openSettings = useModalStore((state) => state.openSettings);

  return (
    <button
      type="button"
      onClick={openSettings}
      onPointerEnter={preloadSettings}
      onFocus={preloadSettings}
      aria-label="Open Settings"
      className="flex items-center gap-1 border border-pane-border px-3 py-1 text-sm text-text-muted hover:bg-pane-title hover:text-text-primary"
    >
      <IconSettings size={14} />
      <span>Settings</span>
    </button>
  );
}
