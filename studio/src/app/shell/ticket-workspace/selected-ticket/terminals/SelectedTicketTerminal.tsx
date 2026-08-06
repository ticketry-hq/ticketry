import {
  Terminal,
  docChatKey,
  useTerminalStore,
  useWorkspaceTabsStore,
  type ForegroundOwner,
} from "../../../../../features/agents/terminal";
import { useTicketWorkspaceStore } from "../state/ticketWorkspaceStore";

/**
 * The Studio terminal host: derives WHICH session the workspace shows —
 * the selected ticket's bucket, its active tab, and the per-document doc-chat
 * overlay (#625) — and delegates the entire how-to-present protocol to the
 * shared `<Terminal>` component. Mounted once (never keyed by ticket) so
 * switching tickets only hides another ticket's terminals — it never tears
 * them down; live terminals survive ticket switches without respawn.
 */
export function SelectedTicketTerminal({
  bucket,
  owner = "studio",
  focusSignal = 0,
}: {
  bucket: string | null;
  owner?: ForegroundOwner;
  focusSignal?: number;
}) {
  const activeByTask = useWorkspaceTabsStore((s) => s.activeByTask);
  const chatByDoc = useWorkspaceTabsStore((s) => s.chatByDoc);
  const sessions = useTerminalStore((s) => s.sessions);
  const workspaces = useTicketWorkspaceStore((s) => s.workspaces);

  const wsState = bucket ? workspaces[bucket] : undefined;
  const active = wsState?.active ?? "details";
  // The active document (when a doc tab is showing) and whether ITS overlay is
  // open. Doc-chat is per-document (#625), so the run is keyed by the active
  // doc's path, and the overlay shows only when that specific doc's flag is set.
  const activeDoc =
    active === "doc"
      ? wsState?.docs.find((d) => d.docId === wsState.activeDocId) ?? null
      : null;
  const overlayActive =
    !!activeDoc && (wsState?.overlayOpenByDoc[activeDoc.docId] ?? false);
  // Exactly one session (#625): the active document's dedicated doc-chat run
  // when its overlay is open; otherwise the focused terminal tab; otherwise
  // nothing. A doc-chat session is reached only via chatByDoc — never
  // activeByTask, so it can't surface as the ticket's run.
  const docKey = activeDoc ? docChatKey(bucket, activeDoc.relPath) : null;
  const docId = docKey ? chatByDoc[docKey] : undefined;
  const activeId = bucket ? activeByTask[bucket] : undefined;
  const visibleId = !bucket
    ? null
    : overlayActive && activeDoc
      ? (docId && sessions[docId] ? docId : null)
      : active === "terminal"
        ? (activeId && sessions[activeId] ? activeId : null)
        : null;

  return <Terminal sessionId={visibleId} owner={owner} focusSignal={focusSignal} />;
}
