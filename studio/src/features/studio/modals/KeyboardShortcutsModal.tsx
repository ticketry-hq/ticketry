import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ModalShell } from "../../../app/modal/ModalShell";
import {
  studioKeymapRegistry,
  type EffectiveBinding,
} from "../../../app/navigation/keymapRegistry";
import { EDIT_VIEW_BODY_DISENGAGE_CHORD } from "../../../app/navigation/three-zone/threeZoneNavigation";
import {
  bindingContextLabel,
  bindingLabel,
  bindingMatchesQuery,
  formatKeyChord,
} from "./KeyboardSettingsPanel";

// Body disengagement resolves inside the edit-view capture handler rather than the
// registry, so the reference lists it explicitly to stay complete.
const FIXED_BINDINGS: readonly EffectiveBinding[] = [
  {
    context: "capture",
    actionId: "edit-view.body-disengage",
    chord: EDIT_VIEW_BODY_DISENGAGE_CHORD,
  },
];

// A short, hand-picked orientation list; the full table below stays exhaustive.
const ESSENTIALS: readonly { id: string; label: string }[] = [
  { id: "global:open-agent", label: "Launch agent" },
  { id: "global:plan", label: "Plan a feature" },
  { id: "capture:edit-view.commit", label: "Engage body" },
  { id: "capture:edit-view.body-disengage", label: "Disengage body" },
  { id: "capture:cycle-terminal-forward", label: "Next terminal" },
  { id: "global:search", label: "Search" },
  { id: "global:toggle-sidebar", label: "Toggle sidebar" },
];

function bindingId(binding: EffectiveBinding): string {
  return `${binding.context}:${binding.actionId}`;
}

export function KeyboardShortcutsModal() {
  const [query, setQuery] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const revision = useSyncExternalStore(
    studioKeymapRegistry.subscribe,
    studioKeymapRegistry.getRevision,
  );
  const bindings = useMemo(
    () => [...studioKeymapRegistry.getEffectiveBindings(), ...FIXED_BINDINGS],
    [revision],
  );
  const visibleBindings = useMemo(
    () => bindings.filter((binding) => bindingMatchesQuery(binding, query)),
    [bindings, query],
  );
  const essentials = useMemo(() => {
    const byId = new Map(bindings.map((binding) => [bindingId(binding), binding]));
    return ESSENTIALS.flatMap(({ id, label }) => {
      const binding = byId.get(id);
      return binding ? [{ label, binding }] : [];
    });
  }, [bindings]);

  return (
    <ModalShell
      title="Keyboard Shortcuts"
      ariaLabel="Keyboard Shortcuts"
      width="w-[min(56rem,calc(100vw-2rem))]"
      initialFocusRef={filterRef}
    >
      <div className="space-y-3">
        <section aria-labelledby="keyboard-shortcuts-essentials" className="space-y-2">
          <h3
            id="keyboard-shortcuts-essentials"
            className="text-xs font-semibold uppercase tracking-wide text-text-muted"
          >
            Essentials
          </h3>
          <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {essentials.map(({ label, binding }) => (
              <li
                key={bindingId(binding)}
                className="flex items-baseline justify-between gap-3 text-sm text-text-primary"
              >
                <span>{label}</span>
                <span className="font-mono text-xs text-text-primary">
                  {formatKeyChord(binding.chord)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <h3
          id="keyboard-shortcuts-all"
          className="border-t border-pane-border pt-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
        >
          All shortcuts
        </h3>

        <div>
          <label htmlFor="keyboard-shortcuts-filter" className="sr-only">
            Filter keyboard shortcuts
          </label>
          <input
            ref={filterRef}
            id="keyboard-shortcuts-filter"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by action or Keymap context"
            className="w-full rounded border border-pane-border bg-pane-bg px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-focus-accent"
          />
        </div>

        <div className="max-h-[60vh] overflow-auto rounded border border-pane-border">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Effective keyboard bindings by action and Keymap context
            </caption>
            <thead className="sticky top-0 bg-pane-title text-xs font-semibold uppercase tracking-wide text-text-muted">
              <tr>
                <th scope="col" className="px-3 py-2">Action</th>
                <th scope="col" className="px-3 py-2">Keymap context</th>
                <th scope="col" className="px-3 py-2">Binding</th>
              </tr>
            </thead>
            <tbody>
              {visibleBindings.map((binding) => (
                <BindingRow
                  key={`${binding.context}:${binding.actionId}`}
                  binding={binding}
                />
              ))}
              {visibleBindings.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center">
                    <p
                      role="status"
                      aria-live="polite"
                      className="text-sm text-text-muted"
                    >
                      No keyboard shortcuts match “{query}”.
                    </p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </ModalShell>
  );
}

function BindingRow({ binding }: { binding: EffectiveBinding }) {
  return (
    <tr className="border-t border-pane-border/70">
      <td className="px-3 py-2 text-sm text-text-primary">
        {bindingLabel(binding)}
      </td>
      <td className="px-3 py-2 text-xs text-text-muted">
        {bindingContextLabel(binding)}
      </td>
      <td className="px-3 py-2 font-mono text-xs text-text-primary">
        {formatKeyChord(binding.chord)}
      </td>
    </tr>
  );
}
