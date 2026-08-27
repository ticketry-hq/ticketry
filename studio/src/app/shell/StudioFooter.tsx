import { StudioFooterActions } from "./StudioFooterActions";
import { StudioFooterHints } from "./StudioFooterHints";

export function StudioFooter() {
  return (
    <div className="flex h-6 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-pane-border bg-pane-title px-3 text-xs text-text-primary">
      <StudioFooterHints />
      <StudioFooterActions />
    </div>
  );
}
