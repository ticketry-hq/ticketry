import { FooterTerminalToggle } from "../../features/terminal-panel";
import {
  AppUpdateAvailabilityIndicator,
  useAppUpdateAvailable,
} from "../../features/app-updates";
import { IconSettings } from "../../shared/ui/icons";
import { useModalStore } from "../modal/modalStore";
import { FooterChangesToggle } from "./FooterChangesToggle";

const preloadSettings = () => {
  void import("../../features/studio/modals/SettingsModal");
  void import("../../features/workflows");
};

export function StudioFooterActions() {
  const openSettings = useModalStore((state) => state.openSettings);
  const updateAvailable = useAppUpdateAvailable();

  return (
    <div className="flex min-w-0 items-center justify-end gap-3">
      <FooterChangesToggle />
      <FooterTerminalToggle />
      <button
        type="button"
        onClick={openSettings}
        onPointerEnter={preloadSettings}
        onFocus={preloadSettings}
        aria-label="Open Settings"
        aria-describedby={
          updateAvailable ? "settings-update-available" : undefined
        }
        className="flex items-center gap-1 px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary"
      >
        <IconSettings size={14} />
        <span>Settings</span>
        <AppUpdateAvailabilityIndicator descriptionId="settings-update-available" />
      </button>
    </div>
  );
}
