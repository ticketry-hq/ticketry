import { useContext } from "react";
import { useClientStore } from "../../../../../state/clientStore";
import { TEMP_TASK_ID } from "../../../../../features/agents/types";
import IssueDetail from "./IssueDetail";
import { DetailsSurfaceActiveContext } from "../internal/detailsSurfaceContext";

/**
 * Pinned, default-active tab. A normal selection renders ticket details.
 */
export function SelectedTicketDetails() {
  const detailsVisible = useContext(DetailsSurfaceActiveContext);
  const selectedTaskId = useClientStore((s) => s.selectedTaskId);

  // The New conversation row hides the workspace; see SelectedTicket.
  if (selectedTaskId === TEMP_TASK_ID) return null;

  if (!selectedTaskId) {
    return <div className="text-text-muted">No task selected</div>;
  }

  // IssueDetail resolves this id from the canonical work-item owner during
  // render. Its refresh is deliberately post-paint, so selection itself never
  // waits for a request.
  return <IssueDetail issueId={selectedTaskId} detailsVisible={detailsVisible} />;
}
