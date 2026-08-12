import {
  RetainedTerminalViewers,
  type ForegroundOwner,
} from "../../../../../features/agents/terminal";

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
  active = true,
  onNativeVisibilityPendingChange,
}: {
  bucket: string | null;
  owner?: ForegroundOwner;
  focusSignal?: number;
  active?: boolean;
  onNativeVisibilityPendingChange?: (runId: string, pending: boolean) => void;
}) {
  return (
    <RetainedTerminalViewers
      bucket={bucket}
      owner={owner}
      focusSignal={focusSignal}
      active={active}
      onNativeVisibilityPendingChange={onNativeVisibilityPendingChange}
    />
  );
}
