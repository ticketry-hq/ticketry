import {
  lazy,
  Suspense,
  useCallback,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  DesignDoc,
  TabKind,
} from "../../../../../features/agents/types";
import type { ForegroundOwner } from "../../../../../features/agents/terminal";
import {
  useClientStore,
  type EditViewZone,
} from "../../../../../state/clientStore";
import { formatChordSymbols } from "../../../../navigation/chordLabel";
import { EDIT_VIEW_BODY_DISENGAGE_CHORD } from "../../../../navigation/three-zone/threeZoneNavigation";
import { LazySelectedTicketTerminal } from "../terminals/selectedTicketTerminalLoader";
import type { TaskWorkspaceTabIdentity } from "./useTaskWorkspaceTabNavigation";

const WorkspaceDocument = lazy(async () => ({
  default: (await import("../documents/WorkspaceDocument")).WorkspaceDocument,
}));

export function WorkspaceTabBody({
  bodyRef,
  detailsSurfaceRef,
  bucket,
  owner,
  details,
  activeKind,
  activeDocument,
  openDocuments,
  terminalIds,
  activeTerminalId,
  requestedSurface,
  surfaceFocusSignal,
  requestedTerminalId,
  terminalFocusSignal,
  activeTab,
  isEditView,
  editViewZone,
  showZoneChrome,
  bodyEngaged,
  onClaimPointerZone,
  onEngageTab,
  onSetEditViewZone,
}: {
  bodyRef: RefObject<HTMLDivElement>;
  detailsSurfaceRef: RefObject<HTMLDivElement>;
  bucket: string;
  owner: ForegroundOwner;
  details: ReactNode;
  activeKind: TabKind;
  activeDocument: DesignDoc | null;
  openDocuments: readonly DesignDoc[];
  terminalIds: readonly string[];
  activeTerminalId: string | null;
  requestedSurface: TaskWorkspaceTabIdentity | null;
  surfaceFocusSignal: number;
  requestedTerminalId: string | null;
  terminalFocusSignal: number;
  activeTab: TaskWorkspaceTabIdentity;
  isEditView: boolean;
  editViewZone: EditViewZone;
  showZoneChrome: boolean;
  bodyEngaged: boolean;
  onClaimPointerZone: (zone: "active-tab-body") => void;
  onEngageTab: (tab: TaskWorkspaceTabIdentity) => void;
  onSetEditViewZone: (zone: "active-tab-body") => void;
}) {
  const [pendingNativeHides, setPendingNativeHides] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const handleNativeVisibilityPendingChange = useCallback(
    (runId: string, pending: boolean) => {
      setPendingNativeHides((current) => {
        const next = new Set(current);
        if (pending) next.add(runId);
        else next.delete(runId);
        return next.size === current.size && [...next].every((id) => current.has(id))
          ? current
          : next;
      });
    },
    [],
  );
  const terminalEngaged = bodyEngaged && activeKind === "terminal";
  const terminalRingBox =
    activeKind === "terminal" ? "top-0 bottom-0 -left-2 -right-2" : "inset-0";

  return (
    <div
      ref={bodyRef}
      data-navigation-zone={isEditView ? "active-tab-body" : undefined}
      tabIndex={isEditView ? -1 : undefined}
      onMouseDown={
        isEditView
          ? (event) => {
              onClaimPointerZone("active-tab-body");
              if (event.target instanceof HTMLElement) {
                onEngageTab(activeTab);
              }
            }
          : undefined
      }
      onFocus={
        isEditView ? () => onSetEditViewZone("active-tab-body") : undefined
      }
      onFocusCapture={
        isEditView
          ? (event) => {
              if (
                !useClientStore.getState().editViewBodyEngaged &&
                event.target instanceof HTMLElement &&
                event.target.closest(".xterm")
              ) {
                bodyRef.current?.focus({ preventScroll: true });
              }
            }
          : undefined
      }
      className={`relative min-h-0 flex-1 outline-none transition-opacity duration-150 motion-reduce:transition-none ${
        showZoneChrome && editViewZone !== "active-tab-body"
          ? "opacity-[0.65]"
          : ""
      }`}
    >
      <div
        ref={detailsSurfaceRef}
        tabIndex={-1}
        data-testid="workspace-details-surface"
        className={
          activeKind === "details"
            ? "absolute inset-0 overflow-auto"
            : "hidden"
        }
      >
        {details}
      </div>
      {/* One iframe per open document, kept mounted so switching docs
          or tabs never reloads them; visibility toggles per active doc. */}
      {openDocuments.map((document) => (
        <div
          key={document.id}
          className={
            activeKind === "doc" && activeDocument?.id === document.id
              ? "absolute inset-0"
              : "hidden"
          }
        >
          <Suspense fallback={null}>
            <WorkspaceDocument
              doc={document}
              focusSignal={
                requestedSurface?.kind === "doc" &&
                requestedSurface.id === document.id
                  ? surfaceFocusSignal
                  : 0
              }
            />
          </Suspense>
        </div>
      ))}
      {/* The single terminal host stays mounted across tab changes. Hidden
          with `invisible` (visibility:hidden) rather than `hidden`
          (display:none) so fit() never measures a zero-size container. */}
      <div
        data-testid="terminal-host-wrapper"
        className={
          activeKind === "terminal"
            ? "group absolute inset-0 flex flex-col"
            : "absolute inset-0 flex flex-col invisible pointer-events-none"
        }
      >
        <div className="relative min-h-0 flex-1">
          <Suspense fallback={null}>
            <LazySelectedTicketTerminal
              bucket={bucket}
              owner={owner}
              active={terminalIds.length > 0 && activeKind === "terminal"}
              focusSignal={
                requestedTerminalId === activeTerminalId
                  ? terminalFocusSignal
                  : 0
              }
              onNativeVisibilityPendingChange={
                handleNativeVisibilityPendingChange
              }
            />
          </Suspense>
        </div>
        {showZoneChrome && (
          <div
            aria-hidden="true"
            data-testid="terminal-mode-ring"
            data-terminal-mode={terminalEngaged ? "engaged" : "idle"}
            className={`pointer-events-none absolute ${terminalRingBox} z-50 ${
              terminalEngaged
                ? "ring-2 ring-inset ring-lifecycle-success"
                : "opacity-0"
            }`}
          />
        )}
        {showZoneChrome && terminalEngaged && activeKind === "terminal" && (
          <div
            data-testid="terminal-mode-tag"
            className="pointer-events-none absolute left-0 top-5 z-50 flex items-center gap-2 border border-l-0 border-lifecycle-success/40 bg-pane-bg/90 px-3 py-1.5 text-sm shadow-sm"
          >
            <span className="font-bold text-lifecycle-success">
              {formatChordSymbols(EDIT_VIEW_BODY_DISENGAGE_CHORD)}
            </span>
            <span className="text-text-muted">— Disengage Body</span>
          </div>
        )}
      </div>
      {pendingNativeHides.size > 0 ? (
        <div
          aria-hidden="true"
          data-testid="native-viewer-transition-shield"
          className="absolute inset-0 z-[60] bg-pane-panel"
        />
      ) : null}
      {showZoneChrome && editViewZone === "active-tab-body" && !bodyEngaged && (
        <div
          aria-hidden="true"
          data-navigation-highlight="active-tab-body"
          className={`pointer-events-none absolute ${terminalRingBox} z-50 ring-1 ring-focus-accent ring-inset`}
        />
      )}
    </div>
  );
}
