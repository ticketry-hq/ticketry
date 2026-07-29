import { useMemo, useState } from "react";
import type {
  EffectiveBinding,
  KeyChord,
} from "../../../app/navigation/keymapRegistry";
import {
  SETTINGS_FIELD_CLASS,
  SETTINGS_SECTION_HEADING_CLASS,
  SettingsStatusLine,
  settingsButtonClass,
} from "../../../shared/ui/SettingsPrimitives";

const ACTION_LABELS: Record<string, string> = {
  "edit-view.next-zone": "Next edit-view zone",
  "edit-view.up": "Move up in edit view",
  "edit-view.down": "Move down in edit view",
  "edit-view.left": "Move left in edit view",
  "edit-view.right": "Move right in edit view",
  "edit-view.commit": "Enter edit-view selection",
  "edit-view.body-disengage": "Disengage body",
  "cycle-terminal-forward": "Cycle terminal forward",
  "cycle-terminal-backward": "Cycle terminal backward",
  "workspace-tab-next": "Next workspace tab",
  "workspace-tab-previous": "Previous workspace tab",
  "modal.close": "Close modal",
  "modal.next": "Next modal item",
  "modal.previous": "Previous modal item",
  "modal.confirm": "Confirm modal",
  "modal.submit": "Submit modal",
  "projects.next": "Next project",
  "projects.previous": "Previous project",
  "projects.activate": "Open project",
  "modules.next": "Next module",
  "modules.previous": "Previous module",
  "modules.activate": "Open module",
  "tasks.next": "Next task",
  "tasks.previous": "Previous task",
  "tasks.activate": "Open task",
  "tasks.expand": "Expand task",
  "tasks.collapse": "Collapse task",
  search: "Search",
  "show-shortcuts": "Show keyboard shortcuts",
  "toggle-sidebar": "Toggle sidebar",
  "focus-left": "Focus left pane",
  "focus-right": "Focus right pane",
  "open-agent": "Open Agent",
  "open-agent-command": "Open Agent (Command)",
  "open-with-prompt-command": "Open Agent with Prompt (Command)",
  plan: "Plan",
  "instant-change": "Instant Change",
  status: "Status",
  settings: "Settings",
  "set-folder": "Set Folder",
  "close-tab": "Close Tab",
  "open-with-prompt": "Open with prompt",
};

const CONTEXT_LABELS: Record<EffectiveBinding["context"], string> = {
  capture: "Capture",
  modal: "Modal",
  "focused-pane": "Focused pane",
  global: "Global",
};

export function bindingLabel(binding: EffectiveBinding): string {
  if (binding.actionId.startsWith("modules.select-position-")) {
    return `Select module ${binding.actionId.slice("modules.select-position-".length)}`;
  }
  return ACTION_LABELS[binding.actionId] ?? binding.actionId;
}

export function bindingContextLabel(binding: EffectiveBinding): string {
  return CONTEXT_LABELS[binding.context];
}

export function formatKeyChord(chord: KeyChord): string {
  const namedKeys: Record<string, string> = {
    Escape: "Esc",
    ArrowDown: "↓",
    ArrowUp: "↑",
    ArrowLeft: "←",
    ArrowRight: "→",
    " ": "Space",
  };
  const key =
    namedKeys[chord.key] ??
    (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  return [
    chord.control && "Ctrl",
    chord.alt && "Alt",
    chord.shift && "Shift",
    chord.meta && "Cmd",
    key,
  ]
    .filter(Boolean)
    .join("+");
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function isSubsequence(needle: string, haystack: string): boolean {
  let needleIndex = 0;
  for (const character of haystack) {
    if (character === needle[needleIndex]) needleIndex += 1;
    if (needleIndex === needle.length) return true;
  }
  return needle.length === 0;
}

export function bindingMatchesQuery(
  binding: EffectiveBinding,
  query: string,
): boolean {
  const terms = normalizeSearchText(query).trim().split(/\s+/);
  if (terms[0] === "") return true;
  const searchableText = normalizeSearchText(
    `${bindingLabel(binding)} ${CONTEXT_LABELS[binding.context]}`,
  );
  return terms.every((term) => isSubsequence(term, searchableText));
}

interface KeyboardSettingsPanelProps {
  bindings: EffectiveBinding[];
  overridden: ReadonlySet<string>;
  recordingKey: string | null;
  message: { kind: "error" | "warning"; text: string } | null;
  saving: boolean;
  onRecord: (binding: EffectiveBinding) => void;
  onReset: (binding: EffectiveBinding) => void;
  onRestoreDefaults: () => void;
}

export function KeyboardSettingsPanel({
  bindings,
  overridden,
  recordingKey,
  message,
  saving,
  onRecord,
  onReset,
  onRestoreDefaults,
}: KeyboardSettingsPanelProps) {
  const [query, setQuery] = useState("");
  const visibleBindings = useMemo(
    () => bindings.filter((binding) => bindingMatchesQuery(binding, query)),
    [bindings, query],
  );

  return (
    <section aria-label="Keyboard settings" className="min-w-0 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className={SETTINGS_SECTION_HEADING_CLASS}>Bindings</h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Select a key cell, then press one chord. Esc cancels recording.
          </p>
        </div>
        <button
          type="button"
          onClick={onRestoreDefaults}
          disabled={saving || overridden.size === 0}
          className={settingsButtonClass("secondary", "shrink-0")}
        >
          Restore defaults
        </button>
      </div>

      <div>
        <label htmlFor="binding-search" className="sr-only">
          Search bindings
        </label>
        <input
          id="binding-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search actions or contexts"
          className={`${SETTINGS_FIELD_CLASS} w-full`}
        />
      </div>

      {message ? (
        <SettingsStatusLine
          tone={message.kind === "error" ? "danger" : "attention"}
        >
          {message.text}
        </SettingsStatusLine>
      ) : null}

      <div className="overflow-hidden rounded border border-pane-border">
        <div className="grid grid-cols-[minmax(12rem,1fr)_8rem_12rem_5rem] gap-3 border-b border-pane-border px-3 py-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
          <span>Action</span>
          <span>Context</span>
          <span>Binding</span>
          <span className="text-right">Reset</span>
        </div>
        <div className="max-h-[55vh] overflow-auto">
          {visibleBindings.map((binding) => {
            const key = `${binding.context}:${binding.actionId}`;
            const label = bindingLabel(binding);
            const locked = binding.actionId === "modal.close";
            return (
              <div
                key={key}
                className="grid grid-cols-[minmax(12rem,1fr)_8rem_12rem_5rem] items-center gap-3 border-b border-pane-border/70 px-3 py-2 last:border-b-0"
              >
                <span className="text-sm text-text-primary">{label}</span>
                <span className="text-sm text-text-muted">
                  {CONTEXT_LABELS[binding.context]}
                </span>
                <button
                  type="button"
                  aria-label={`Record ${label} binding`}
                  onClick={() => onRecord(binding)}
                  disabled={locked || saving}
                  className={`${settingsButtonClass("secondary", "text-left font-mono")} ${
                    recordingKey === key
                      ? "bg-pane-title"
                      : "bg-pane-bg"
                  }`}
                >
                  {locked
                    ? `${formatKeyChord(binding.chord)} · Locked`
                    : recordingKey === key
                      ? "Press a chord…"
                      : formatKeyChord(binding.chord)}
                </button>
                <div className="text-right">
                  {overridden.has(key) ? (
                    <button
                      type="button"
                      aria-label={`Reset ${label} binding`}
                      onClick={() => onReset(binding)}
                      disabled={saving}
                      className={settingsButtonClass("secondary")}
                    >
                      Reset
                    </button>
                  ) : (
                    <span className="text-sm text-text-muted/60">Default</span>
                  )}
                </div>
              </div>
            );
          })}
          {visibleBindings.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-text-muted">
              No bindings match “{query}”.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
