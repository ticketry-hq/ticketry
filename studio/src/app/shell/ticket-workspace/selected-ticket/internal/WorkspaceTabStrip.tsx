import type { RefObject } from "react";
import type { DesignDoc, TabKind } from "../../../../../features/agents/types";
import {
  isLiveTerminalState,
  LifecycleBadge,
  presentTerminalRuns,
  providerToneClasses,
  type SessionMeta,
  type SessionTab,
} from "../../../../../features/agents/terminal";
import type { EditViewZone } from "../../../../../state/clientStore";
import { WorkspaceTab } from "./WorkspaceTab";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";
import {
  WorkspaceLauncher,
  type TicketLaunchContext,
  type WorkspaceLauncherContext,
} from "./WorkspaceLauncher";

// A run stops being live when it ends; from then on colour is neutral grey
// rather than a faded provider hue, which no one can identify anyway. The rule
// itself is shared with the dormant chips so the two rows cannot disagree.
function isLiveTerminal(tab: SessionTab): boolean {
  return isLiveTerminalState(tab.lifecycle);
}

export function WorkspaceTabStrip({
  tabStripRef,
  isEditView,
  editViewZone,
  showZoneChrome,
  allowTabHoverEmphasis,
  showTabHighlight,
  highlightedTab,
  activeKind,
  activeDoc,
  activeTerminalId,
  documents,
  terminalTabs,
  bucket,
  launchContext,
  activatedProviders,
  providersLoaded,
  providersFailed,
  onClaimPointerZone,
  onSetEditViewZone,
  onSelectTab,
  onCloseDocument,
  onCloseTerminal,
  onLaunchTaskAgent,
}: {
  tabStripRef: RefObject<HTMLDivElement>;
  isEditView: boolean;
  editViewZone: EditViewZone;
  showZoneChrome: boolean;
  allowTabHoverEmphasis: boolean;
  showTabHighlight: boolean;
  highlightedTab: TaskWorkspaceTabIdentity;
  activeKind: TabKind;
  activeDoc: DesignDoc | null;
  activeTerminalId: string | null;
  documents: readonly DesignDoc[];
  terminalTabs: readonly SessionTab[];
  bucket: string;
  launchContext: WorkspaceLauncherContext | null;
  activatedProviders: ReadonlySet<string>;
  providersLoaded: boolean;
  providersFailed: boolean;
  onClaimPointerZone: (zone: "tab-strip") => void;
  onSetEditViewZone: (zone: "tab-strip") => void;
  onSelectTab: (tab: TaskWorkspaceTabIdentity) => void;
  onCloseDocument: (docId: string) => void;
  onCloseTerminal: (sessionId: string) => void;
  onLaunchTaskAgent: (
    agent: SessionMeta["agent"],
    context: TicketLaunchContext,
  ) => void;
}) {
  return (
    <div
      ref={tabStripRef}
      role="tablist"
      aria-label="Workspace tabs"
      data-testid="workspace-tabs"
      data-navigation-zone={isEditView ? "tab-strip" : undefined}
      tabIndex={isEditView ? -1 : undefined}
      onMouseDown={isEditView ? () => onClaimPointerZone("tab-strip") : undefined}
      onFocus={isEditView ? () => onSetEditViewZone("tab-strip") : undefined}
      className={`mb-1 flex shrink-0 flex-wrap gap-1 border-b border-pane-border pb-1 outline-none transition-opacity duration-150 motion-reduce:transition-none ${
        isEditView
          ? `min-h-10 items-center px-1 py-1 ${
              showZoneChrome
                ? editViewZone === "tab-strip"
                  ? "ring-1 ring-focus-accent ring-inset"
                  : "opacity-[0.65]"
                : ""
            }`
          : ""
      }`}
    >
      <WorkspaceTab
        label="Details"
        active={activeKind === "details"}
        highlighted={showTabHighlight && highlightedTab.kind === "details"}
        allowHoverEmphasis={allowTabHoverEmphasis}
        onClick={() => onSelectTab({ kind: "details" })}
      />
      {documents.map((document) => (
        <WorkspaceTab
          key={document.id}
          label={document.label}
          active={activeKind === "doc" && activeDoc?.id === document.id}
          highlighted={
            showTabHighlight &&
            highlightedTab.kind === "doc" &&
            highlightedTab.id === document.id
          }
          allowHoverEmphasis={allowTabHoverEmphasis}
          onClick={() => onSelectTab({ kind: "doc", id: document.id })}
          onClose={() => onCloseDocument(document.id)}
        />
      ))}
      {presentTerminalRuns(
        // Tabs arrive in launch order, which is the order duplicate ordinals
        // follow.
        terminalTabs.map((tab) => ({
          key: tab.id,
          agent: tab.meta.agent,
          launchState: tab.launchState,
          launchModel: tab.launchModel,
          isPlanning: tab.meta.isPlanning,
          isInstant: tab.meta.isInstant,
          live: isLiveTerminal(tab),
        })),
      ).map((presentation, index) => {
        const tab = terminalTabs[index];
        const active = activeKind === "terminal" && activeTerminalId === tab.id;
        return (
          <WorkspaceTab
            key={tab.id}
            label={presentation.label}
            accessibleName={presentation.accessibleName}
            title={presentation.hoverTitle || undefined}
            active={active}
            highlighted={
              showTabHighlight &&
              highlightedTab.kind === "terminal" &&
              highlightedTab.id === tab.id
            }
            allowHoverEmphasis={allowTabHoverEmphasis}
            tone={providerToneClasses({
              agent: tab.meta.agent,
              live: isLiveTerminal(tab),
              selected: active,
              ground: "pane-bg",
            })}
            /* Attention axis — its own palette, independent of provider tone. */
            badge={<LifecycleBadge state={tab.lifecycle} />}
            onClick={() => onSelectTab({ kind: "terminal", id: tab.id })}
            onClose={() => onCloseTerminal(tab.id)}
            closeLabel={presentation.closeName}
          />
        );
      })}
      {launchContext && (
        <WorkspaceLauncher
          bucket={bucket}
          launchContext={launchContext}
          activatedProviders={activatedProviders}
          providersLoaded={providersLoaded}
          providersFailed={providersFailed}
          onLaunchTaskAgent={onLaunchTaskAgent}
        />
      )}
    </div>
  );
}
