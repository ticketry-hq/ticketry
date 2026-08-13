import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useModalStore } from "../../../app/modal/modalStore";
import {
  SETTINGS_EYEBROW_CLASS,
  SETTINGS_SECTION_HEADING_CLASS,
  SettingsStatusLine,
  settingsButtonClass,
} from "../../../shared/ui/SettingsPrimitives";
import type {
  ModelConfigurationCommitState,
  ModelConfigurationPanelHandle,
} from "../../workflows";
import {
  commitPendingSettingsChanges,
  createSettingsChangeLedger,
  syncPendingSettingsChanges,
  type SettingsChangeLedger,
  type SettingsLedgerEntry,
} from "../../settings/changeLedger";

const ModelConfigurationPanel = lazy(async () => ({
  default: (await import("../../workflows"))
    .ModelConfigurationPanel,
}));

const MODELS_LEDE =
  "Which providers are available to launch, and what runs when a configuration leaves it unset.";

type SettingsStatus = {
  tone: "success" | "attention" | "danger";
  text: string;
};

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function SettingsModal() {
  const popModal = useModalStore((state) => state.popModal);
  const [ledger, setLedger] = useState<SettingsChangeLedger>(
    createSettingsChangeLedger,
  );
  const [modelStatus, setModelStatus] = useState<SettingsStatus | null>(null);
  const [modelCommitState, setModelCommitState] =
    useState<ModelConfigurationCommitState>({
      outstandingCount: 0,
      saving: false,
      changes: [],
    });
  const modelConfigurationRef = useRef<ModelConfigurationPanelHandle>(null);
  const close = () => popModal();

  const updateModelCommitState = useCallback(
    (state: ModelConfigurationCommitState) => {
      setModelCommitState(state);
      setLedger((current) =>
        syncPendingSettingsChanges(current, "Models", state.changes));
    },
    [],
  );

  const commitModelChanges = useCallback((changes: string[]) => {
    setLedger((current) =>
      commitPendingSettingsChanges(current, "Models", changes));
  }, []);

  return (
    <SettingsFrame onClose={close}>
      <div className="grid min-h-0 grid-cols-[13rem_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
        <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] border-r border-pane-border bg-pane-bg max-md:block max-md:border-b max-md:border-r-0">
          <div
            role="tablist"
            aria-label="Settings sections"
            aria-orientation="vertical"
            className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-2 max-md:flex-row max-md:flex-wrap max-md:overflow-hidden"
          >
            <RailGroup label="Configuration" first>
              <RailItem
                active
                label="Models"
              />
            </RailGroup>
          </div>
          <AppliedChangesLedger entries={ledger.entries} />
        </aside>

        <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-pane-panel">
          {modelStatus ? (
            <SettingsStatusLine
              tone={modelStatus.tone}
              className="mx-5 mb-0.5 mt-3"
            >
              {modelStatus.text}
            </SettingsStatusLine>
          ) : null}

          <div
            data-testid="settings-scroll-container"
            className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto"
          >
            <header className="border-b border-pane-border px-5 py-4">
              <h2 className={SETTINGS_SECTION_HEADING_CLASS}>
                Models
              </h2>
              <p className="mt-0.5 text-sm text-text-muted">
                {MODELS_LEDE}
              </p>
            </header>
            <div className="min-w-0 px-5 py-4">
              <Suspense fallback={<p className="text-sm text-text-muted">Loading model configuration…</p>}>
                <ModelConfigurationPanel
                  ref={modelConfigurationRef}
                  onChangesApplied={commitModelChanges}
                  onCommitStateChange={updateModelCommitState}
                  onStatusChange={setModelStatus}
                />
              </Suspense>
            </div>
          </div>

          <div
            role="region"
            aria-label="Settings commit actions"
            className="flex items-center justify-between gap-4 border-t border-pane-border bg-pane-panel px-5 py-3"
          >
            <span
              className={
                modelCommitState.outstandingCount > 0
                  ? "text-sm text-lifecycle-attention"
                  : "text-sm text-text-muted"
              }
            >
              {modelCommitState.outstandingCount === 0
                ? "No unsaved changes"
                : modelCommitState.outstandingCount === 1
                  ? "1 unsaved change"
                  : `${modelCommitState.outstandingCount} unsaved changes`}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={
                  modelCommitState.saving ||
                  modelCommitState.outstandingCount === 0
                }
                onClick={() => modelConfigurationRef.current?.discard()}
                className={settingsButtonClass("secondary")}
              >
                Discard
              </button>
              <button
                type="button"
                disabled={
                  modelCommitState.saving ||
                  modelCommitState.outstandingCount === 0
                }
                onClick={() => modelConfigurationRef.current?.save()}
                className={settingsButtonClass("primary")}
              >
                {modelCommitState.saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </SettingsFrame>
  );
}

function formatLedgerTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function AppliedChangesLedger({
  entries,
}: {
  entries: SettingsLedgerEntry[];
}) {
  const visible = entries.slice(0, 3);
  return (
    <div className="border-t border-pane-border px-3.5 pb-3.5 pt-3 max-md:hidden">
      <div className={SETTINGS_EYEBROW_CLASS}>Applied</div>
      <div
        role="log"
        aria-label="Applied changes"
        aria-live="polite"
        className="mt-2.5"
      >
        {visible.length === 0 ? (
          <p className="border-l border-pane-border py-0.5 pl-3 text-xs text-text-muted">
            No changes yet.
          </p>
        ) : (
          <ul className="relative grid gap-2 pl-3 before:absolute before:bottom-1 before:left-0 before:top-1 before:w-px before:bg-pane-border">
            {visible.map((entry, index) => (
              <li
                key={entry.id}
                data-tone={entry.tone}
                className={`settings-ledger-entry relative ${
                  entry.transition === "commit"
                    ? "settings-ledger-entry-commit"
                    : "settings-ledger-entry-in"
                } ${index === 1 ? "opacity-70" : index === 2 ? "opacity-45" : ""}`}
              >
                <span
                  aria-hidden="true"
                  className={`settings-ledger-marker absolute -left-[14px] top-[5px] size-[5px] rounded-full ${
                    entry.tone === "pending"
                      ? "border border-lifecycle-attention bg-transparent"
                      : "bg-lifecycle-success"
                  }`}
                />
                <div className="flex items-baseline gap-1.5">
                  <time className="font-mono text-xs tabular-nums text-text-muted">
                    {entry.timestamp === null
                      ? "--:--"
                      : formatLedgerTime(entry.timestamp)}
                  </time>
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
                    {entry.section}
                  </span>
                </div>
                <p
                  className={`mt-px [overflow-wrap:anywhere] text-xs ${
                    entry.tone === "pending"
                      ? "text-lifecycle-attention"
                      : "text-text-primary"
                  }`}
                >
                  <span className="sr-only">
                    {entry.tone === "pending" ? "Pending: " : "Applied: "}
                  </span>
                  {entry.summary}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RailGroup({
  children,
  first = false,
  label,
}: {
  children: ReactNode;
  first?: boolean;
  label: string;
}) {
  const headingId = useId();

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="contents max-md:flex max-md:gap-0.5"
    >
      <h2
        id={headingId}
        className={`mx-2 mb-1 border-b border-pane-border pb-1.5 text-sm font-semibold tracking-wide text-text-primary max-md:hidden ${
          first ? "pt-1" : "pt-3"
        }`}
      >
        {label}
      </h2>
      {children}
    </div>
  );
}

function RailItem({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={
        active
          ? "rounded border-l-2 border-focus-accent bg-pane-title px-2 py-1.5 text-left text-sm font-medium text-text-primary"
          : "rounded border-l-2 border-transparent px-2 py-1.5 text-left text-sm text-text-secondary hover:text-text-primary"
      }
    >
      {label}
    </button>
  );
}

function SettingsFrame({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    if (!card) return;
    (card.querySelector<HTMLElement>(FOCUSABLE) ?? card).focus();
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!elements.length) {
        event.preventDefault();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === card)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapTab, true);
    return () => {
      document.removeEventListener("keydown", trapTab, true);
      previousFocus?.focus?.();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Studio settings"
        tabIndex={-1}
        onKeyDownCapture={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        className="grid h-[min(42rem,calc(100vh-3rem))] w-[min(64rem,calc(100vw-2rem))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded border border-pane-border bg-pane-panel text-text-primary outline-none max-md:h-[calc(100vh-1.5rem)] max-md:w-[calc(100vw-1.5rem)]"
      >
        <div className="flex items-center justify-between gap-3 border-b border-pane-border px-4 py-3">
          <h1 className="text-lg font-semibold text-text-primary">Settings</h1>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded px-2 py-1 text-lg leading-none text-text-muted hover:bg-pane-title hover:text-text-primary"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
