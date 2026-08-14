import type { RefObject } from "react";
import type { DesignDoc, TabKind } from "../../../../../features/agents/types";
import {
  LifecycleBadge,
  type LifecycleState,
  type SessionMeta,
  type SessionTab,
} from "../../../../../features/agents/terminal";
import type { EditViewZone } from "../../../../../state/clientStore";
import { terminalLabel } from "./terminalLabel";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";
import {
  WorkspaceLauncher,
  type TicketLaunchContext,
  type WorkspaceLauncherContext,
} from "./WorkspaceLauncher";

function WorkspaceTab({
  label,
  active,
  highlighted,
  allowHoverEmphasis,
  dim,
  lifecycle,
  onClick,
  onClose,
  closeLabel,
}: {
  label: string;
  active: boolean;
  highlighted?: boolean;
  allowHoverEmphasis: boolean;
  dim?: boolean;
  lifecycle?: LifecycleState;
  onClick: () => void;
  onClose?: () => void;
  closeLabel?: string;
}) {
  return (
    <div
      role="tab"
      aria-selected={active}
      aria-label={label}
      data-highlighted={highlighted || undefined}
      onClick={onClick}
      className={`flex shrink-0 cursor-pointer items-center gap-2 border px-2 py-0.5 text-xs ${
        active
          ? "border-focus-accent bg-pane-title text-text-primary"
          : `border-pane-border bg-pane-bg text-text-muted ${
              allowHoverEmphasis ? "hover:bg-pane-title" : ""
            }`
      } ${highlighted ? "ring-1 ring-focus-accent ring-inset" : ""} ${
        dim ? "opacity-60" : ""
      }`}
    >
      <span>{label}</span>
      {/* Attention axis — distinct from the tab's selected/dim transport cues. */}
      {lifecycle && <LifecycleBadge state={lifecycle} />}
      {onClose && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="text-text-muted hover:text-text-primary"
          aria-label={closeLabel ?? `Close ${label}`}
        >
          ×
        </button>
      )}
    </div>
  );
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
  ticketSeq,
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
  ticketSeq?: number | null;
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
      {terminalTabs.map(({ id, meta, lifecycle }) => (
        <WorkspaceTab
          key={id}
          label={terminalLabel(meta, ticketSeq)}
          active={activeKind === "terminal" && activeTerminalId === id}
          highlighted={
            showTabHighlight &&
            highlightedTab.kind === "terminal" &&
            highlightedTab.id === id
          }
          allowHoverEmphasis={allowTabHoverEmphasis}
          dim={
            lifecycle === "exited" ||
            lifecycle === "lost" ||
            lifecycle === "error"
          }
          lifecycle={lifecycle}
          onClick={() => onSelectTab({ kind: "terminal", id })}
          onClose={() => onCloseTerminal(id)}
          closeLabel={`Close terminal ${terminalLabel(meta, ticketSeq)}`}
        />
      ))}
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
