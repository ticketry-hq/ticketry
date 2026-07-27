import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import { useModalStore } from "../../../app/modal/modalStore";
import { studioRuntime, type StudioPlatform } from "../../../runtime";
import {
  MODAL_ACTIONS,
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

const WorkflowSettingsPanel = lazy(async () => ({
  default: (await import("../../workflows/WorkflowSettingsPanel"))
    .WorkflowSettingsPanel,
}));

const ModelConfigurationPanel = lazy(async () => ({
  default: (await import("../../workflows/ModelConfigurationPanel"))
    .ModelConfigurationPanel,
}));

type SettingsSection = "workflow" | "models" | "keyboard";

const SECTION_LABELS: Record<SettingsSection, string> = {
  workflow: "Workflow",
  models: "Model configuration",
  keyboard: "Keyboard",
};
type RecorderMessage = { kind: "error" | "warning"; text: string };

const BROWSER_RESERVED_KEYS = new Set(["l", "n", "q", "r", "t", "w"]);

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
  const [activeSection, setActiveSection] = useState<SettingsSection>("workflow");
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

  const selectSection = (section: SettingsSection) => {
    if (section === activeSection) return;
    setRecording(null);
    setMessage(null);
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

  return (
    <ModalShell
      title={<h1 className="text-lg font-semibold normal-case tracking-normal text-text-primary">Settings</h1>}
      ariaLabel="Studio settings"
      width="w-[min(64rem,calc(100vw-2rem))]"
      bindings={[
        { actionId: MODAL_ACTIONS.close, label: "Close Settings" },
      ]}
      interceptKeyDown={captureRecording}
      onClose={close}
    >
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Settings sections"
          className="inline-flex rounded-md border border-pane-border p-0.5"
        >
          {(["workflow", "models"] as const).map((section) => (
            <button
              key={section}
              type="button"
              role="tab"
              aria-selected={activeSection === section}
              onClick={() => selectSection(section)}
              className={
                activeSection === section
                  ? "rounded bg-pane-title px-3 py-1.5 text-sm font-medium text-text-primary"
                  : "rounded px-3 py-1.5 text-sm text-text-muted hover:text-text-primary"
              }
            >
              {SECTION_LABELS[section]}
            </button>
          ))}
        </div>
        {activeSection === "workflow" ? (
          <Suspense fallback={<p className="text-sm text-text-muted">Loading workflow settings…</p>}>
            <WorkflowSettingsPanel />
          </Suspense>
        ) : activeSection === "models" ? (
          <Suspense fallback={<p className="text-sm text-text-muted">Loading model configuration…</p>}>
            <ModelConfigurationPanel />
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
    </ModalShell>
  );
}
