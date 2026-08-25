import { useCallback, useEffect, useRef, type RefObject } from "react";
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
import type { WorkspaceTabReorderDrag } from "../../../../../features/workspace-tabs/internal/useWorkspaceTabReorderDrag";
import { workspaceTabIdentityKey } from "../../../../../features/workspace-tabs/ordering";
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
  orderedTabs,
  activeTab,
  reorderDrag,
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
  orderedTabs: readonly TaskWorkspaceTabIdentity[];
  activeTab: TaskWorkspaceTabIdentity;
  reorderDrag: WorkspaceTabReorderDrag;
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
  const tabRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const registerTabRef = useCallback(
    (identity: TaskWorkspaceTabIdentity, node: HTMLDivElement | null) => {
      tabRefs.current[workspaceTabIdentityKey(identity)] = node;
    },
    [],
  );
  const orderKey = orderedTabs.map(workspaceTabIdentityKey).join("\0");
  const activeKey = workspaceTabIdentityKey(activeTab);

  useEffect(() => {
    tabRefs.current[activeKey]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeKey, orderKey]);

  const documentById = new Map(documents.map((document) => [document.id, document]));
  const terminalPresentations = presentTerminalRuns(
    terminalTabs.map((tab) => ({
      key: tab.id,
      agent: tab.meta.agent,
      launchState: tab.launchState,
      launchModel: tab.launchModel,
      isPlanning: tab.meta.isPlanning,
      isInstant: tab.meta.isInstant,
      live: isLiveTerminal(tab),
    })),
  );
  const terminalById = new Map(
    terminalTabs.map((tab, index) => [
      tab.id,
      { tab, presentation: terminalPresentations[index] },
    ]),
  );

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
      className={`mb-1 flex min-w-0 shrink-0 flex-nowrap gap-1 overflow-x-auto border-b border-pane-border pb-1 outline-none transition-opacity duration-150 [scrollbar-width:none] motion-reduce:transition-none [&::-webkit-scrollbar]:hidden ${
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
      {orderedTabs.map((identity) => {
        // Details and Changes are the workspace's own pinned surfaces: one
        // label each, no id, and no close control.
        if (identity.kind === "details" || identity.kind === "changes") {
          const pinnedKind = identity.kind;
          return (
            <WorkspaceTab
              key={pinnedKind}
              label={pinnedKind === "details" ? "Details" : "Changes"}
              active={activeKind === pinnedKind}
              highlighted={
                showTabHighlight && highlightedTab.kind === pinnedKind
              }
              allowHoverEmphasis={allowTabHoverEmphasis}
              onClick={() => {
                if (!reorderDrag.consumePostDropClick()) {
                  onSelectTab({ kind: pinnedKind });
                }
              }}
              dropIntent={reorderDrag.dropIntentFor(identity)}
              registerRef={(node) => registerTabRef(identity, node)}
              dragSourceProps={reorderDrag.dragSourcePropsFor(identity)}
              dropTargetProps={reorderDrag.dropTargetPropsFor(identity)}
            />
          );
        }
        if (identity.kind === "doc") {
          const document = documentById.get(identity.id);
          if (!document) return null;
          return (
            <WorkspaceTab
              key={`doc:${document.id}`}
              label={document.label}
              active={activeKind === "doc" && activeDoc?.id === document.id}
              highlighted={
                showTabHighlight &&
                highlightedTab.kind === "doc" &&
                highlightedTab.id === document.id
              }
              allowHoverEmphasis={allowTabHoverEmphasis}
              onClick={() => {
                if (!reorderDrag.consumePostDropClick()) {
                  onSelectTab({ kind: "doc", id: document.id });
                }
              }}
              onClose={() => {
                if (!reorderDrag.consumePostDropClick()) {
                  onCloseDocument(document.id);
                }
              }}
              dropIntent={reorderDrag.dropIntentFor(identity)}
              registerRef={(node) => registerTabRef(identity, node)}
              dragSourceProps={reorderDrag.dragSourcePropsFor(identity)}
              dropTargetProps={reorderDrag.dropTargetPropsFor(identity)}
            />
          );
        }
        const terminal = terminalById.get(identity.id);
        if (!terminal) return null;
        const { tab, presentation } = terminal;
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
            onClick={() => {
              if (!reorderDrag.consumePostDropClick()) {
                onSelectTab({ kind: "terminal", id: tab.id });
              }
            }}
            onClose={() => {
              if (!reorderDrag.consumePostDropClick()) {
                onCloseTerminal(tab.id);
              }
            }}
            closeLabel={presentation.closeName}
            dropIntent={reorderDrag.dropIntentFor(identity)}
            registerRef={(node) => registerTabRef(identity, node)}
            dragSourceProps={reorderDrag.dragSourcePropsFor(identity)}
            dropTargetProps={reorderDrag.dropTargetPropsFor(identity)}
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
