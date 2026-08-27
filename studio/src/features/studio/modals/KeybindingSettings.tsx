import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  studioKeymapRegistry,
  type BindingOverride,
  type EffectiveBinding,
  type KeyChord,
} from "../../../app/navigation/keymapRegistry";
import { saveKeybindingOverrides } from "../../../app/navigation/keymapSettings";
import { SETTINGS_SECTION_HEADING_CLASS } from "../../../shared/ui/SettingsPrimitives";
import {
  bindingLabel,
  KeyboardSettingsPanel,
} from "./KeyboardSettingsPanel";

const MODIFIER_KEYS = new Set(["Alt", "Control", "Meta", "Shift"]);

function bindingKey(binding: EffectiveBinding): string {
  return `${binding.context}:${binding.actionId}`;
}

function chordFromEvent(event: KeyboardEvent): KeyChord {
  return {
    key: event.key,
    alt: event.altKey,
    control: event.ctrlKey,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}

function sameChord(left: KeyChord, right: KeyChord): boolean {
  return left.key === right.key &&
    left.alt === right.alt &&
    left.control === right.control &&
    left.meta === right.meta &&
    left.shift === right.shift;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Keyboard bindings could not be saved.";
}

/** Editable keybinding settings backed by the persisted registry overrides. */
export function KeybindingSettings() {
  const revision = useSyncExternalStore(
    studioKeymapRegistry.subscribe,
    studioKeymapRegistry.getRevision,
  );
  const bindings = useMemo(
    () => studioKeymapRegistry.getConfigurableBindings(),
    [revision],
  );
  const overridden = useMemo(
    () => new Set(studioKeymapRegistry.getOverrides().map(bindingKey)),
    [revision],
  );
  const [recording, setRecording] = useState<EffectiveBinding | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "error" | "warning";
    text: string;
  } | null>(null);

  const persist = useCallback(async (overrides: BindingOverride[]) => {
    setSaving(true);
    setMessage(null);
    try {
      await saveKeybindingOverrides(overrides);
    } catch (error) {
      setMessage({ kind: "error", text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }, []);

  const replaceBinding = useCallback((
    binding: EffectiveBinding,
    chord: KeyChord | null,
  ) => {
    const key = bindingKey(binding);
    const next = studioKeymapRegistry.getOverrides().filter(
      (override) => bindingKey(override) !== key,
    );
    const defaultBinding = studioKeymapRegistry.getDefaultBindings().find(
      (candidate) => bindingKey(candidate) === key,
    );
    if (chord && (!defaultBinding || !sameChord(chord, defaultBinding.chord))) {
      next.push({
        context: binding.context,
        actionId: binding.actionId,
        chord,
      });
    }
    setRecording(null);
    void persist(next);
  }, [persist]);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setRecording(null);
        setMessage(null);
        return;
      }
      const chord = chordFromEvent(event);
      const recordingKey = bindingKey(recording);
      const conflict = studioKeymapRegistry.findMatchingBinding(
        chord,
        (candidate) => bindingKey(candidate) !== recordingKey,
      );
      if (conflict) {
        setRecording(null);
        setMessage({
          kind: "warning",
          text: `That chord is already assigned to ${bindingLabel(conflict)}.`,
        });
        return;
      }
      replaceBinding(recording, chord);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, replaceBinding]);

  return (
    <div className="space-y-4">
      <header>
        <h2 className={SETTINGS_SECTION_HEADING_CLASS}>Keyboard shortcuts</h2>
        <p className="mt-0.5 text-sm text-text-muted">
          Search, record, and persist the keys that invoke Studio actions.
        </p>
      </header>
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
        onReset={(binding) => replaceBinding(binding, null)}
        onRestoreDefaults={() => {
          setRecording(null);
          void persist([]);
        }}
      />
    </div>
  );
}
