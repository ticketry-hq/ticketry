import {
  Terminal,
  type ForegroundOwner,
} from "../../../../../features/agents/terminal";
import {
  useTerminalStore,
  useWorkspaceTabsStore,
} from "../../../../../features/agents/terminal/appNavigation";

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
}: {
  bucket: string | null;
  owner?: ForegroundOwner;
  focusSignal?: number;
  active?: boolean;
}) {
  const activeByTask = useWorkspaceTabsStore((s) => s.activeByTask);
  const sessions = useTerminalStore((s) => s.sessions);
  const activeId = bucket ? activeByTask[bucket] : undefined;
  const visibleId = active && activeId && sessions[activeId] ? activeId : null;

  return <Terminal sessionId={visibleId} owner={owner} focusSignal={focusSignal} />;
}
