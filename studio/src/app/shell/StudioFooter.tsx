import { useSyncExternalStore } from "react";
import { useModalStore } from "../modal/modalStore";
import { studioKeymapRegistry } from "../navigation/keymapRegistry";
import { formatChordSymbols } from "../navigation/chordLabel";
import { EDIT_VIEW_BODY_DISENGAGE_CHORD } from "../navigation/three-zone/threeZoneNavigation";
import {
  useClientStore,
  type EditViewZone,
} from "../../state/clientStore";
import { IconSettings } from "../../shared/ui/icons";
import { FooterTerminalToggle } from "../../features/terminal-panel";

// Warm the model-only Settings composition before the modal opens.
const preloadSettings = () => {
  void import("../../features/studio/modals/SettingsModal");
  void import("../../features/workflows");
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
  const footerBindings = [
    // The sidebar chip stays put in both states and flips its verb, so the
    // footer always names the key that reveals — or hides — the menu panes.
    ...getSidebarFooterBindings(sidebarVisible),
    ...(sidebarVisible
      ? []
      : getEditViewFooterBindings(editViewZone, editViewBodyEngaged)),
  ];

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t border-pane-border bg-pane-title px-3 text-xs text-text-primary">
      {footerBindings.map((binding) => (
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
      {/* The terminal control is always here, in both panel states: a hidden
          panel has no header of its own to restore it from. */}
      <span className="ml-auto flex items-center">
        <FooterTerminalToggle />
      </span>
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
  );
}

const EDIT_VIEW_FOOTER_ACTIONS: Record<
  EditViewZone,
  readonly {
    actionIds: readonly string[];
    label: string;
  }[]
> = {
  stories: [
    { actionIds: ["edit-view.next-zone"], label: "Next Zone" },
    { actionIds: ["edit-view.up", "edit-view.down"], label: "Story" },
    { actionIds: ["edit-view.right"], label: "Expand / Dive" },
    { actionIds: ["edit-view.commit"], label: "Dive" },
  ],
  "tab-strip": [
    { actionIds: ["edit-view.next-zone"], label: "Next Zone" },
    { actionIds: ["edit-view.left", "edit-view.right"], label: "Tab" },
    { actionIds: ["edit-view.down"], label: "Body" },
    { actionIds: ["edit-view.commit"], label: "Open" },
  ],
  "active-tab-body": [
    { actionIds: ["edit-view.next-zone"], label: "Next Zone" },
    { actionIds: ["edit-view.up"], label: "Tabs" },
    { actionIds: ["edit-view.left"], label: "Stories" },
    { actionIds: ["edit-view.commit"], label: "Engage" },
  ],
  // Reaching the panel is already typing in it, so what the footer offers here
  // is the way back out.
  "terminal-panel": [
    { actionIds: ["edit-view.next-zone"], label: "Next Zone" },
    { actionIds: ["edit-view.up"], label: "Workspace" },
    { actionIds: ["edit-view.commit"], label: "Type" },
  ],
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

function getSidebarFooterBindings(sidebarVisible: boolean): FooterBinding[] {
  const chord = effectiveChords().get("global:toggle-sidebar");
  if (!chord) return [];
  return [
    {
      key: formatChordSymbols(chord),
      label: sidebarVisible ? "Close Menu" : "Open Menu",
    },
  ];
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
