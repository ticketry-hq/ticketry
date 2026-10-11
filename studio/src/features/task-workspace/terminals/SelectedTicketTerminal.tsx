import type { ReactNode } from "react";
import {
  RetainedTerminalViewers,
  type ForegroundOwner,
} from "../../agents/terminal";

/**
 * The Studio terminal host: derives WHICH session the workspace shows —
 * the selected ticket's bucket and active tab — and delegates presentation to the
 * shared `<Terminal>` component. Mounted once (never keyed by ticket) so
 * switching tickets only hides another ticket's terminals — it never tears
 * them down; live terminals survive ticket switches without respawn.
 */
export function SelectedTicketTerminal({
  bucket,
  owner = "studio",
  focusSignal = 0,
  canFocus,
  active = true,
  onNativeVisibilityPendingChange,
  rendererOverlay,
}: {
  bucket: string | null;
  rendererOverlay?: ReactNode;
  owner?: ForegroundOwner;
  focusSignal?: number;
  canFocus?: (target?: HTMLElement | null) => boolean;
  active?: boolean;
  onNativeVisibilityPendingChange?: (runId: string, pending: boolean) => void;
}) {
  return (
    <RetainedTerminalViewers
      rendererOverlay={rendererOverlay}
      bucket={bucket}
      owner={owner}
      canFocus={canFocus}
      focusSignal={focusSignal}
      active={active}
      onNativeVisibilityPendingChange={onNativeVisibilityPendingChange}
    />
  );
}
