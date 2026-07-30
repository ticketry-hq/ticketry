import {
  useCallback,
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useModalStore } from "../../../app/modal/modalStore";
import { studioRuntime, type StudioPlatform } from "../../../runtime";
import {
  studioKeymapRegistry,
  type BindingOverride,
  type EffectiveBinding,
  type KeyChord,
} from "../../../app/navigation/keymapRegistry";
import { saveKeybindingOverrides } from "../../../app/navigation/keymapSettings";
import {
  bindingLabel,
  formatKeyChord,
  KeyboardSettingsPanel,
} from "./KeyboardSettingsPanel";
import { useWorkflowEditorStore } from "../../workflows/workflowEditorStore";
import {
  SETTINGS_EYEBROW_CLASS,
  SETTINGS_SECTION_HEADING_CLASS,
  SettingsStatusLine,
  settingsButtonClass,
} from "../../../shared/ui/SettingsPrimitives";
import type {
  ModelConfigurationCommitState,
  ModelConfigurationPanelHandle,
} from "../../workflows/ModelConfigurationPanel";
import {
  commitPendingSettingsChanges,
  createSettingsChangeLedger,
  observeConfirmedSettings,
  syncPendingSettingsChanges,
  type SettingsChangeLedger,
  type SettingsLedgerEntry,
} from "../../settings/changeLedger";

const WorkflowSettingsPanel = lazy(async () => ({
  default: (await import("../../workflows/WorkflowSettingsPanel"))
    .WorkflowSettingsPanel,
}));

const ModelConfigurationPanel = lazy(async () => ({
  default: (await import("../../workflows/ModelConfigurationPanel"))
    .ModelConfigurationPanel,
}));

type SettingsSection = "states" | "issue-types" | "models" | "keyboard";

interface SettingsSectionDescriptor {
  label: string;
  lede: string;
  saveGated: boolean;
}

const SECTION_DESCRIPTORS: Record<SettingsSection, SettingsSectionDescriptor> = {
  states: {
    label: "States",
    lede: "Project-wide names, groups, colors, and display order. Changes apply as you make them.",
    saveGated: false,
  },
  "issue-types": {
    label: "Issue types",
    lede: "Per-type start state and allowed transitions. Changes apply as you make them.",
    saveGated: false,
  },
  models: {
    label: "Models",
    lede: "Which providers are available to launch, and what runs when a configuration leaves it unset.",
    saveGated: true,
  },
  keyboard: {
    label: "Keyboard",
    lede: "Customize Studio keyboard shortcuts.",
    saveGated: false,
  },
};
type RecorderMessage = { kind: "error" | "warning"; text: string };
type SettingsStatus = {
  tone: "success" | "attention" | "danger";
  text: string;
};

const BROWSER_RESERVED_KEYS = new Set(["l", "n", "q", "r", "t", "w"]);
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function bindingKey(binding: Pick<EffectiveBinding, "context" | "actionId">) {
  return `${binding.context}:${binding.actionId}`;
}

function sameChord(left: KeyChord, right: KeyChord): boolean {
  return (
    left.key === right.key &&
    left.alt === right.alt &&
    left.control === right.control &&
    left.meta === right.meta &&
    left.shift === right.shift
  );
}

function chordFromEvent(event: KeyboardEvent): KeyChord {
  return {
    key: event.key.length === 1 && !event.shiftKey
      ? event.key.toLocaleLowerCase()
      : event.key,
    alt: event.altKey,
    control: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

function reservedReason(chord: KeyChord, platform: StudioPlatform): string | null {
  if (chord.key === "Escape") return "Esc is reserved for closing or cancelling modals.";
  const key = chord.key.toLocaleLowerCase();
  if (
    platform === "browser" &&
    (chord.meta || chord.control) &&
    BROWSER_RESERVED_KEYS.has(key)
  ) {
    return `${formatKeyChord(chord)} is owned by the browser.`;
  }
  if (
    (chord.meta && (chord.key === " " || chord.key === "Tab")) ||
    (chord.control && chord.alt && chord.key === "Delete")
  ) {
    return `${formatKeyChord(chord)} is reserved by the operating system.`;
  }
  return null;
}

interface SettingsModalProps {
  runtimePlatform?: StudioPlatform;
}

export function SettingsModal({ runtimePlatform }: SettingsModalProps = {}) {
  const popModal = useModalStore((state) => state.popModal);
  const workflowNotice = useWorkflowEditorStore((state) => state.notice);
  const workflowError = useWorkflowEditorStore((state) => state.error);
  const ledgerProjectId = useWorkflowEditorStore((state) => state.projectId);
  const ledgerLoading = useWorkflowEditorStore((state) => state.loading);
  const ledgerAction = useWorkflowEditorStore((state) => state.action);
  const ledgerStates = useWorkflowEditorStore((state) => state.states);
  const ledgerIssueTypes = useWorkflowEditorStore((state) => state.issueTypes);
  const ledgerWorkflows = useWorkflowEditorStore((state) => state.workflows);
  const [activeSection, setActiveSection] = useState<SettingsSection>("states");
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
  const [recording, setRecording] = useState<EffectiveBinding | null>(null);
  const [message, setMessage] = useState<RecorderMessage | null>(null);
  const [saving, setSaving] = useState(false);
  useSyncExternalStore(
    studioKeymapRegistry.subscribe,
    studioKeymapRegistry.getRevision,
  );
  const bindings = studioKeymapRegistry.getConfigurableBindings();
  const overrides = studioKeymapRegistry.getOverrides();
  const overridden = new Set(overrides.map(bindingKey));
  const platform = runtimePlatform ?? studioRuntime().platform;
  const close = () => popModal();

  useEffect(() => {
    setLedger((current) =>
      observeConfirmedSettings(current, {
        projectId: ledgerProjectId,
        loading: ledgerLoading,
        action: ledgerAction,
        states: ledgerStates,
        issueTypes: ledgerIssueTypes,
        workflows: ledgerWorkflows,
      }));
  }, [
    ledgerAction,
    ledgerIssueTypes,
    ledgerLoading,
    ledgerProjectId,
    ledgerStates,
    ledgerWorkflows,
  ]);

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

  const selectSection = (section: SettingsSection) => {
    if (section === activeSection) return;
    setRecording(null);
    setMessage(null);
    setModelStatus(null);
    setActiveSection(section);
  };

  const persist = async (
    next: BindingOverride[],
    previous: BindingOverride[],
  ) => {
    studioKeymapRegistry.setOverrides(next);
    setSaving(true);
    try {
      await saveKeybindingOverrides(next);
    } catch {
      studioKeymapRegistry.setOverrides(previous);
      setMessage({
        kind: "error",
        text: "Could not save the binding. The previous bindings were restored.",
      });
    } finally {
      setSaving(false);
    }
  };

  const resetBinding = (binding: EffectiveBinding) => {
    setRecording(null);
    setMessage(null);
    void persist(
      overrides.filter((override) => bindingKey(override) !== bindingKey(binding)),
      overrides,
    );
  };

  const restoreDefaults = () => {
    setRecording(null);
    setMessage(null);
    void persist([], overrides);
  };

  const captureRecording = (event: KeyboardEvent): boolean => {
    if (!recording) return false;
    if (event.key === "Escape") {
      setRecording(null);
      setMessage(null);
      return true;
    }
    const nextChord = chordFromEvent(event);
    const reserved = reservedReason(nextChord, platform);
    if (reserved) {
      setMessage({ kind: "error", text: reserved });
      setRecording(null);
      return true;
    }
    const duplicate = studioKeymapRegistry.findMatchingBinding(
      nextChord,
      (binding) =>
        bindingKey(binding) !== bindingKey(recording) &&
        binding.context === recording.context,
    );
    if (duplicate) {
      setMessage({
        kind: "error",
        text: `${formatKeyChord(nextChord)} is already bound to ${bindingLabel(duplicate)} in ${duplicate.context}.`,
      });
      setRecording(null);
      return true;
    }
    const shadowed = studioKeymapRegistry.findMatchingBinding(
      nextChord,
      (binding) =>
        binding.context !== recording.context,
    );
    const defaults = studioKeymapRegistry.getDefaultBindings();
    const defaultBinding = defaults.find(
      (binding) => bindingKey(binding) === bindingKey(recording),
    );
    const withoutCurrent = overrides.filter(
      (override) => bindingKey(override) !== bindingKey(recording),
    );
    const nextOverrides =
      defaultBinding && sameChord(defaultBinding.chord, nextChord)
        ? withoutCurrent
        : [
            ...withoutCurrent,
            { ...recording, chord: nextChord },
          ];
    setRecording(null);
    setMessage(
      shadowed
        ? {
            kind: "warning",
            text: `${formatKeyChord(nextChord)} also binds ${bindingLabel(shadowed)} in ${shadowed.context}; context precedence decides which action runs.`,
          }
        : null,
    );
    void persist(nextOverrides, overrides);
    return true;
  };

  const workflowStatus: SettingsStatus | null = workflowError
    ? { tone: "danger", text: workflowError }
    : workflowNotice
      ? { tone: "success", text: workflowNotice }
      : null;
  const status = activeSection === "models" ? modelStatus : workflowStatus;

  return (
    <SettingsFrame interceptKeyDown={captureRecording} onClose={close}>
      <div className="grid min-h-0 grid-cols-[13rem_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
        <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] border-r border-pane-border bg-pane-bg max-md:block max-md:border-b max-md:border-r-0">
          <div
            role="tablist"
            aria-label="Settings sections"
            aria-orientation="vertical"
            className="flex min-h-0 flex-col gap-0.5 overflow-y-auto p-2 max-md:flex-row max-md:flex-wrap max-md:overflow-hidden"
          >
            <RailGroup label="Workflow" first>
              {(["states", "issue-types"] as const).map((section) => (
                <RailItem
                  key={section}
                  active={activeSection === section}
                  label={SECTION_DESCRIPTORS[section].label}
                  onSelect={() => selectSection(section)}
                />
              ))}
            </RailGroup>
            <RailGroup label="Configuration">
              <RailItem
                active={activeSection === "models"}
                label={SECTION_DESCRIPTORS.models.label}
                onSelect={() => selectSection("models")}
              />
            </RailGroup>
          </div>
          <AppliedChangesLedger entries={ledger.entries} />
        </aside>

        <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-pane-panel">
          {status ? (
            <SettingsStatusLine
              tone={status.tone}
              className="mx-5 mb-0.5 mt-3"
            >
              {status.text}
            </SettingsStatusLine>
          ) : null}

          <div
            data-testid="settings-scroll-container"
            className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto"
          >
            <header className="border-b border-pane-border px-5 py-4">
              <h2 className={SETTINGS_SECTION_HEADING_CLASS}>
                {SECTION_DESCRIPTORS[activeSection].label}
              </h2>
              <p className="mt-0.5 text-sm text-text-muted">
                {SECTION_DESCRIPTORS[activeSection].lede}
              </p>
            </header>
            <div className="min-w-0 px-5 py-4">
              {activeSection === "states" || activeSection === "issue-types" ? (
                <Suspense fallback={<p className="text-sm text-text-muted">Loading workflow settings…</p>}>
                  <WorkflowSettingsPanel activeSection={activeSection} />
                </Suspense>
              ) : activeSection === "models" ? (
                <Suspense fallback={<p className="text-sm text-text-muted">Loading model configuration…</p>}>
                  <ModelConfigurationPanel
                    ref={modelConfigurationRef}
                    onChangesApplied={commitModelChanges}
                    onCommitStateChange={updateModelCommitState}
                    onStatusChange={setModelStatus}
                  />
                </Suspense>
              ) : (
                <KeyboardSettingsPanel
                  bindings={bindings}
                  overridden={overridden}
                  recordingKey={recording ? bindingKey(recording) : null}
                  message={message}
                  saving={saving}
                  onRecord={(binding) => {
                    setMessage(null);
                    setRecording(binding);
                  }}
                  onReset={resetBinding}
                  onRestoreDefaults={restoreDefaults}
                />
              )}
            </div>
          </div>

          {SECTION_DESCRIPTORS[activeSection].saveGated ? (
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
          ) : null}
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
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
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
  interceptKeyDown,
  onClose,
}: {
  children: ReactNode;
  interceptKeyDown: (event: KeyboardEvent) => boolean;
  onClose: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const setActiveBindings = useModalStore((state) => state.setActiveBindings);

  useEffect(() => {
    setActiveBindings([{ key: "Esc", label: "Close Settings" }]);
    return () => setActiveBindings(null);
  }, [setActiveBindings]);

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
          if (interceptKeyDown(event.nativeEvent)) {
            event.preventDefault();
            event.stopPropagation();
          } else if (event.key === "Escape") {
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
