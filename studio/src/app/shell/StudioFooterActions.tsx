import { FooterTerminalToggle } from "../../features/terminal-panel";
import { IconSettings } from "../../shared/ui/icons";
import { useModalStore } from "../modal/modalStore";

const preloadSettings = () => {
  void import("../../features/studio/modals/SettingsModal");
  void import("../../features/workflows");
};

export function StudioFooterActions() {
  const openSettings = useModalStore((state) => state.openSettings);

  return (
    <div className="ml-auto flex items-center gap-3">
      <FooterTerminalToggle />
      <button
        type="button"
        onClick={openSettings}
        onPointerEnter={preloadSettings}
        onFocus={preloadSettings}
        aria-label="Open Settings"
        className="flex items-center gap-1 px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary"
      >
        <IconSettings size={14} />
        <span>Settings</span>
      </button>
    </div>
  );
}
