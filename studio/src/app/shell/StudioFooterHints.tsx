import { useSyncExternalStore } from "react";
import {
  useClientStore,
  type EditViewZone,
} from "../../state/clientStore";
import { formatChordSymbols } from "../navigation/chordLabel";
import {
  studioKeymapRegistry,
  type KeyChord,
} from "../navigation/keymapRegistry";
import { EDIT_VIEW_BODY_DISENGAGE_CHORD } from "../navigation/three-zone/threeZoneNavigation";

type FooterHint = {
  key: string;
  label: string;
  tone?: "engaged";
};

const EDIT_VIEW_ACTIONS: Record<
  EditViewZone,
  readonly { actionIds: readonly string[]; label: string }[]
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
  "terminal-panel": [
    { actionIds: ["edit-view.next-zone"], label: "Next Zone" },
    { actionIds: ["edit-view.up"], label: "Workspace" },
    { actionIds: ["edit-view.commit"], label: "Type" },
  ],
};

export function StudioFooterHints() {
  useSyncExternalStore(
    studioKeymapRegistry.subscribe,
    studioKeymapRegistry.getRevision,
  );
  const sidebarVisible = useClientStore((state) => state.sidebarVisible);
  const bodyEngaged = useClientStore((state) => state.editViewBodyEngaged);
  const zone = useClientStore((state) => state.editViewZone);
  const hints = getFooterHints(sidebarVisible, zone, bodyEngaged);

  return hints.map((hint) => <FooterHintItem key={hint.label} hint={hint} />);
}

function FooterHintItem({ hint }: { hint: FooterHint }) {
  const keyTone =
    hint.tone === "engaged"
      ? "text-lifecycle-success"
      : "text-focus-accent";

  return (
    <span className="flex items-center gap-1">
      <span className={`bg-pane-bg px-1.5 py-0.5 font-bold ${keyTone}`}>
        {hint.key}
      </span>
      <span className="text-text-muted">— {hint.label}</span>
    </span>
  );
}

function getFooterHints(
  sidebarVisible: boolean,
  zone: EditViewZone,
  bodyEngaged: boolean,
): FooterHint[] {
  const chords = getEffectiveChords();
  const sidebarChord = chords.get("global:toggle-sidebar");
  const sidebarHints = sidebarChord
    ? [
        {
          key: formatChordSymbols(sidebarChord),
          label: sidebarVisible ? "Close Menu" : "Open Menu",
        },
      ]
    : [];

  if (sidebarVisible) return sidebarHints;
  return [...sidebarHints, ...getEditViewHints(chords, zone, bodyEngaged)];
}

function getEditViewHints(
  chords: Map<string, KeyChord>,
  zone: EditViewZone,
  bodyEngaged: boolean,
): FooterHint[] {
  if (zone === "active-tab-body" && bodyEngaged) {
    return [
      {
        key: formatChordSymbols(EDIT_VIEW_BODY_DISENGAGE_CHORD),
        label: "Disengage",
        tone: "engaged",
      },
    ];
  }

  return EDIT_VIEW_ACTIONS[zone].flatMap(({ actionIds, label }) => {
    const keys = actionIds.flatMap((actionId) => {
      const chord = chords.get(`capture:${actionId}`);
      return chord ? [formatChordSymbols(chord)] : [];
    });
    return keys.length > 0 ? [{ key: keys.join(""), label }] : [];
  });
}

function getEffectiveChords() {
  return new Map(
    studioKeymapRegistry
      .getEffectiveBindings()
      .map((binding) => [
        `${binding.context}:${binding.actionId}`,
        binding.chord,
      ]),
  );
}
