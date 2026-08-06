import type { DocTabState } from "../../../../../features/agents/types";
import DocViewer from "./DocViewer";
import {
  docChatKey,
  useTerminalStore,
  useWorkspaceTabsStore,
} from "../../../../../features/agents/terminal";
import { useModalStore } from "../../../../modal/modalStore";
import { useTicketWorkspaceStore } from "../state/ticketWorkspaceStore";

/**
 * Generated-document tab. Markdown flips in place between sanitized reading
 * and rich document edit mode; HTML keeps its sandboxed iframe. The reload
 * token refreshes either renderer when the underlying file is rewritten.
 *
 * The "edit with agent" control (#625) is viewer chrome rendered *over* the
 * iframe, not inside the sandboxed page: it summons a fresh, doc-scoped agent
 * in the overlay (AgentPicker doc-chat mode). When that agent edits the file,
 * the watcher live-reloads this tab.
 */
export function WorkspaceDocument({
  doc,
  bucket,
  projectId,
  moduleId,
  taskId,
  ticketSeq,
  focusSignal = 0,
}: {
  doc: DocTabState;
  bucket: string;
  projectId: string | null;
  moduleId: string | null;
  taskId: string | null;
  ticketSeq: number | null;
  focusSignal?: number;
}) {
  const pushModal = useModalStore((s) => s.pushModal);
  // "edit with agent" summons a doc-chat run for THIS document. There's one such
  // run per document (openDocChat dedupes per doc), so if one is already live,
  // skip the agent picker — asking which agent to use is redundant when the pick
  // would just be discarded — and reveal this doc's running overlay instead.
  function editWithAgent(): void {
    const { chatByDoc } = useWorkspaceTabsStore.getState();
    const { sessions } = useTerminalStore.getState();
    const priorId = chatByDoc[docChatKey(bucket, doc.relPath)];
    const prior = priorId ? sessions[priorId] : null;
    if (
      prior &&
      (prior.status === "connecting" ||
        prior.status === "ready" ||
        prior.status === "reconnecting")
    ) {
      useTicketWorkspaceStore.getState().setOverlayOpen(bucket, doc.docId, true);
      return;
    }
    pushModal({
      type: "agent-picker",
      payload: {
        mode: "doc-chat",
        projectId: projectId ?? undefined,
        moduleId: moduleId ?? undefined,
        taskId: taskId ?? undefined,
        ticketSeq,
        docRelPath: doc.relPath,
        docId: doc.docId,
      },
    });
  }
  return (
    <div className="relative h-full w-full">
      <DocViewer doc={doc} focusSignal={focusSignal} editable />
      <button
        type="button"
        onClick={editWithAgent}
        className="absolute right-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-pane-border bg-pane-title/95 px-2.5 py-1 text-xs text-text-primary shadow-md hover:border-focus-accent"
        aria-label="Edit with agent"
        title="Edit this document with a coding agent"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-focus-accent" />
        edit with agent
      </button>
    </div>
  );
}
