import { WorkspaceTabStrip } from "./internal/WorkspaceTabStrip";
import { DormantWorkspaceTabs } from "./internal/DormantWorkspaceTabs";
import { WorkspaceTabBody } from "./internal/WorkspaceTabBody";
import { useTaskWorkspace } from "./internal/useTaskWorkspace";
import type { TaskWorkspaceProps } from "./types";

/** Rendered task workspace; viewers stay mounted while only visibility changes. */
export function TaskWorkspace(props: TaskWorkspaceProps) {
  const {
    bucket, moduleId, owner, workspaceActive = true, details,
    launchContext = null, conversationTitle = null,
  } = props;
  const {
    paneRef, tabStripRef, launcherTriggerRef, bodyRef, detailsSurfaceRef,
    isEditView, editViewZone, editViewBodyEngaged, navigationModality, setEditViewZone,
    highlightedTab, effActive, activeDoc, activeTermId, openDocs, closedDocs, tabs,
    navigableTabs, activeTab, workspaceTabReorder, claimPointerZone, selectWorkspaceTab,
    activateWorkspaceTerminal, closeWorkspaceDocument, closeWorkspaceTerminal,
    beginTaskAgentLaunch, rememberLaunchedTaskAgent, resumable, dormantChips, resumingRunIds,
    reopenWorkspaceDocument, resumeWorkspaceTerminal, termIds,
    requestedSurfaceRef, surfaceFocusSignal, requestedTerminalRef, terminalFocusSignal,
    engageWorkspaceTab, canFocusSurface, canFocusTerminal,
  } = useTaskWorkspace(props);

  if (!bucket) return <div className="text-text-muted">No task selected</div>;

  const showZoneChrome = isEditView && navigationModality === "keyboard";
  const bodyEngaged = isEditView && editViewBodyEngaged;
  const showTabHighlight = showZoneChrome && editViewZone === "tab-strip";
  const allowTabHoverEmphasis =
    !isEditView ||
    navigationModality === "pointer" ||
    editViewZone === "tab-strip";

  return (
    <div
      ref={paneRef}
      data-coach-anchor="workspace"
      className="flex h-full flex-col"
    >
      <WorkspaceTabStrip
        tabStripRef={tabStripRef}
        launcherTriggerRef={launcherTriggerRef}
        isEditView={isEditView}
        editViewZone={editViewZone}
        showZoneChrome={showZoneChrome}
        allowTabHoverEmphasis={allowTabHoverEmphasis}
        showTabHighlight={showTabHighlight}
        highlightedTab={highlightedTab}
        activeKind={effActive}
        activeDoc={activeDoc}
        activeTerminalId={activeTermId}
        documents={openDocs}
        terminalTabs={tabs}
        orderedTabs={navigableTabs}
        activeTab={activeTab}
        reorderDrag={workspaceTabReorder}
        bucket={bucket}
        launchContext={launchContext}
        conversationTitle={conversationTitle}
        onClaimPointerZone={claimPointerZone}
        onSetEditViewZone={setEditViewZone}
        onSelectTab={selectWorkspaceTab}
        onActivateTerminal={activateWorkspaceTerminal}
        onCloseDocument={closeWorkspaceDocument}
        onCloseTerminal={closeWorkspaceTerminal}
        onTaskAgentLaunched={rememberLaunchedTaskAgent}
        onTaskAgentLaunchStarted={beginTaskAgentLaunch}
        trailing={
          <DormantWorkspaceTabs
            closedDocuments={closedDocs}
            resumableSessions={resumable}
            resumableChips={dormantChips.resumable}
            historyChips={dormantChips.history}
            resumingRunIds={resumingRunIds}
            onReopenDocument={reopenWorkspaceDocument}
            onResumeTerminal={(session) => void resumeWorkspaceTerminal(session)}
          />
        }
      />

      <WorkspaceTabBody
        bodyRef={bodyRef}
        detailsSurfaceRef={detailsSurfaceRef}
        bucket={bucket}
        moduleId={moduleId}
        owner={owner}
        workspaceActive={workspaceActive}
        details={details}
        activeKind={effActive}
        activeDocument={activeDoc}
        openDocuments={openDocs}
        terminalIds={termIds}
        activeTerminalId={activeTermId}
        requestedSurface={requestedSurfaceRef.current}
        surfaceFocusSignal={surfaceFocusSignal}
        canFocusSurface={canFocusSurface}
        requestedTerminalId={requestedTerminalRef.current}
        terminalFocusSignal={terminalFocusSignal}
        canFocusTerminal={canFocusTerminal}
        activeTab={activeTab}
        isEditView={isEditView}
        editViewZone={editViewZone}
        showZoneChrome={showZoneChrome}
        bodyEngaged={bodyEngaged}
        onClaimPointerZone={claimPointerZone}
        onEngageTab={engageWorkspaceTab}
        onSetEditViewZone={setEditViewZone}
      />
    </div>
  );
}
