import IssueDetail from "./IssueDetail";
import { useIssueDrawerWorkspace } from "./useIssueDrawerWorkspace";
import { WorkspacePane } from "./WorkspacePane";

// The issue's tabbed workspace — the Details / Doc / Terminal tab strip over
// the routed content — extracted from IssueDrawerHost (#837) so the drawer
// overlay and the Backlog's inline workspace pane render the identical
// assembly and can never drift. The host contributes only chrome (backdrop,
// header, resize); everything tab-shaped lives here.

interface Props {
  /** The issue's KEY-N (or id); IssueDetail self-loads from it (#827). */
  issueKey: string;
  /** Foreground-registry surface for the Terminal tab (CODIN-749). */
  owner?: "drawer" | "studio";
  /** Host signal selecting the first workspace stop (Details). */
  entrySignal?: number;
  /** Horizontal-axis handoff before the pinned Details tab. */
  onBeforeFirstTab?: () => void;
  /** The issue-drawer overlay owns Command-arrows modally. */
  modal?: boolean;
}

export default function IssueWorkspace({
  issueKey,
  owner = "drawer",
  entrySignal = 0,
  onBeforeFirstTab,
  modal = false,
}: Props) {
  const { workspace } = useIssueDrawerWorkspace(issueKey);
  const task = workspace?.task ?? null;

  return (
    <WorkspacePane
      bucket={task?.id ?? null}
      projectId={workspace?.projectId ?? null}
      moduleId={workspace?.module?.moduleId ?? null}
      ticketKey={task?.key}
      owner={owner}
      entrySignal={entrySignal}
      onBeforeFirstTab={onBeforeFirstTab}
      modal={modal}
      launchContext={
        workspace?.launchContext
          ? { kind: "task", ...workspace.launchContext }
          : null
      }
      details={<IssueDetail issueId={issueKey} />}
    />
  );
}
