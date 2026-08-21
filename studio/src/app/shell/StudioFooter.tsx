import { useSyncExternalStore } from "react";
import { useModalStore } from "../modal/modalStore";
import { studioKeymapRegistry } from "../navigation/keymapRegistry";
import { formatChordSymbols } from "../navigation/chordLabel";
import { EDIT_VIEW_BODY_DISENGAGE_CHORD } from "../navigation/three-zone/threeZoneNavigation";
import {
  useClientStore,
  type EditViewZone,
} from "../../state/clientStore";
import { IconPanelLeft, IconSettings } from "../../shared/ui/icons";
import { FooterTerminalToggle } from "../../features/terminal-panel";

// Warm the model-only Settings composition before the modal opens.
const preloadSettings = () => {
  void import("../../features/studio/modals/SettingsModal");
  void import("../../features/workflows/ModelConfigurationPanel");
};

export function StudioFooter() {
  useSyncExternalStore(
    studioKeymapRegistry.subscribe,
    studioKeymapRegistry.getRevision,
  );
  const openSettings = useModalStore((s) => s.openSettings);
  const sidebarVisible = useClientStore((s) => s.sidebarVisible);
  const editViewBodyEngaged = useClientStore(
    (s) => s.editViewBodyEngaged,
  );
  const editViewZone = useClientStore((s) => s.editViewZone);
  const toggleSidebar = useClientStore((s) => s.toggleSidebar);
  // The control stays put in both states and names its surface, not its verb,
  // so it reads as a button beside Terminal and Settings rather than as another
  // key hint. The verb it would perform lives in the label and tooltip.
  const sidebarBinding = getSidebarFooterBinding(sidebarVisible);
  const editViewBindings = sidebarVisible
    ? []
    : getEditViewFooterBindings(editViewZone, editViewBodyEngaged);

  return (
    // Three tracks, not a flex row: the two 1fr edges are always equal, so the
    // hints sit at the true centre of the footer instead of drifting with the
    // width of the controls beside them.
    <div className="grid h-6 shrink-0 grid-cols-[1fr_auto_1fr] items-center overflow-hidden whitespace-nowrap border-t border-pane-border bg-pane-title px-3 text-xs text-text-primary">
      <div className="flex min-w-0 items-center justify-start">
        {sidebarBinding ? (
          <button
            type="button"
            onClick={toggleSidebar}
            data-testid="footer-modules-toggle"
            aria-label={sidebarBinding.action}
            title={sidebarBinding.action}
            aria-expanded={sidebarVisible}
            className="flex items-center gap-1 px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary focus-visible:ring-1 focus-visible:ring-focus-accent focus-visible:ring-inset"
          >
            <IconPanelLeft size={14} />
            <span>Modules</span>
            {/* The binding trails the name so a rebound key still shows up here. */}
            <span className="font-bold text-focus-accent">
              {sidebarBinding.key}
            </span>
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center justify-center gap-3">
        {editViewBindings.map((binding) => (
          <span key={binding.label} className="flex items-center gap-1">
            {/* The disengage chip carries the same green as the engaged body ring,
                so the footer and the pane agree on the mode. */}
            <span
              className={`bg-pane-bg px-1.5 py-0.5 font-bold ${
                binding.tone === "engaged"
                  ? "text-lifecycle-success"
                  : "text-focus-accent"
              }`}
            >
              {binding.key}
            </span>
            <span className="text-text-muted">— {binding.label}</span>
          </span>
        ))}
      </div>
      {/* The terminal control is always here, in both panel states: a hidden
          panel has no header of its own to restore it from. */}
      <div className="flex min-w-0 items-center justify-end gap-3">
        <FooterTerminalToggle />
        <button
          type="button"
          onClick={openSettings}
          onPointerEnter={preloadSettings}
          onFocus={preloadSettings}
          aria-label="Open Settings"
          className="flex items-center gap-1 px-1.5 py-0.5 text-text-muted hover:bg-pane-bg hover:text-text-primary"
        >
          <IconSettings size={14} />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}

// The footer names what a key does, not which direction it points. Arrow-key
// hops between zones are already advertised by Next Zone, so a chip is earned
// only by a zone-local verb you could not guess from the arrow itself.
const EDIT_VIEW_FOOTER_ACTIONS: Record<
  EditViewZone,
  readonly {
    actionIds: readonly string[];
    label: string;
  }[]
> = {
  stories: [
    { actionIds: ["edit-view.next-zone"], label: "Next Zone" },
    { actionIds: ["edit-view.right"], label: "Expand / Dive" },
    { actionIds: ["edit-view.commit"], label: "Open Terminal" },
    { actionIds: ["edit-view.choose-provider"], label: "Choose Agent" },
  ],
  "tab-strip": [
    { actionIds: ["edit-view.next-zone"], label: "Next Zone" },
    { actionIds: ["edit-view.commit"], label: "Open" },
  ],
  "active-tab-body": [
    { actionIds: ["edit-view.next-zone"], label: "Next Zone" },
    { actionIds: ["edit-view.commit"], label: "Engage" },
  ],
  // Reaching the panel is not yet typing in it, so the verb worth naming is the
  // one that hands the keyboard to the shell.
  "terminal-panel": [
    { actionIds: ["edit-view.next-zone"], label: "Next Zone" },
    { actionIds: ["edit-view.commit"], label: "Type" },
  ],
};

type SidebarFooterBinding = {
  key: string;
  /** The next action the control performs, for its label and tooltip. */
  action: string;
};

type FooterBinding = {
  key: string;
  label: string;
  tone?: "engaged";
};

const effectiveChords = () =>
  new Map(
    studioKeymapRegistry
      .getEffectiveBindings()
      .map((binding) => [
        `${binding.context}:${binding.actionId}`,
        binding.chord,
      ]),
  );

function getSidebarFooterBinding(
  sidebarVisible: boolean,
): SidebarFooterBinding | null {
  const chord = effectiveChords().get("global:toggle-sidebar");
  if (!chord) return null;
  return {
    key: formatChordSymbols(chord),
    action: sidebarVisible ? "Close Modules pane" : "Open Modules pane",
  };
}

function getEditViewFooterBindings(
  zone: EditViewZone,
  bodyEngaged: boolean,
): FooterBinding[] {
  if (zone === "active-tab-body" && bodyEngaged) {
    return [
      {
        key: formatChordSymbols(EDIT_VIEW_BODY_DISENGAGE_CHORD),
        label: "Disengage",
        tone: "engaged",
      },
    ];
  }

  const bindings = effectiveChords();
  return EDIT_VIEW_FOOTER_ACTIONS[zone].flatMap(
    ({ actionIds, label }) => {
      const chords = actionIds.flatMap((actionId) => {
        const chord = bindings.get(`capture:${actionId}`);
        return chord ? [formatChordSymbols(chord)] : [];
      });
      return chords.length > 0 ? [{ key: chords.join(""), label }] : [];
    },
  );
}
