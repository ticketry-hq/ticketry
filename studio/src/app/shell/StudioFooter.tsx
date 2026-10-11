import { StudioFooterActions } from "./StudioFooterActions";
import { StudioFooterHints } from "./StudioFooterHints";
import { FooterModuleManagerToggle } from "./FooterModuleManagerToggle";

export function StudioFooter() {
  return (
    <div
      className="grid h-6 shrink-0 grid-cols-[1fr_auto_1fr] items-center overflow-hidden whitespace-nowrap border-t border-pane-border bg-pane-title px-3 text-xs text-text-primary"
      data-studio-status-bar
    >
      <FooterModuleManagerToggle />
      <div className="flex min-w-0 items-center justify-center gap-3">
        <StudioFooterHints />
      </div>
      <StudioFooterActions />
    </div>
  );
}
