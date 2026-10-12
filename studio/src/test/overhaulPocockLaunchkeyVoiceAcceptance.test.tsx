import { screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { AGENT_RUN_ACTIONS, studioKeymapRegistry, type BindingOverride } from "../app/navigation/keymapRegistry";
import { loadKeybindingOverrides } from "../app/navigation/keymapSettings";
import { KeybindingSettings } from "../features/studio/modals/KeybindingSettings";
import { launchkeyStartup } from "../features/launchkey";

const chord = (key: string): BindingOverride["chord"] => ({ key, alt: false, control: false, meta: true, shift: false });
const voiceOverride = { context: "global", actionId: AGENT_RUN_ACTIONS.toggleVoiceTranscription, chord: chord("v") };
const settingsOverride: BindingOverride = { context: "global", actionId: "settings", chord: chord(",") };
const subscribe = async () => '{"type":"accepted"}';

afterEach(() => {
  vi.restoreAllMocks();
  studioKeymapRegistry.setOverrides([]);
});

it("Pocock never starts LaunchKey MIDI control from the mounted shell", async () => {
  const start = vi.spyOn(launchkeyStartup, "start");
  editionAcceptanceFixture().mount({ onGraphQlSubscribe: subscribe });
  await screen.findByRole("tab", { name: "Roadmap" });
  expect(start).not.toHaveBeenCalled();
});

it("Pocock registers no voice transcription action and lists it in no shortcut surface", async () => {
  editionAcceptanceFixture().mount({ children: <KeybindingSettings /> });
  await screen.findByRole("tab", { name: "Roadmap" });
  const voice = AGENT_RUN_ACTIONS.toggleVoiceTranscription;
  expect(studioKeymapRegistry.getRegisteredActionIds()).not.toContain(voice);
  expect(studioKeymapRegistry.getRegisteredActionIds()).toContain(AGENT_RUN_ACTIONS.focusAgentRun);
  for (const bindings of [studioKeymapRegistry.getEffectiveBindings(), studioKeymapRegistry.getConfigurableBindings()]) {
    expect(bindings.map(({ actionId }) => actionId)).not.toContain(voice);
  }
  expect(screen.queryByText(/voice/i)).toBeNull();
  await expect(studioKeymapRegistry.dispatch(voice)).resolves.toBe(false);
});

it("Pocock ignores a stored voice transcription override without error and leaves storage untouched", async () => {
  const f = editionAcceptanceFixture();
  const stored = [voiceOverride, settingsOverride];
  const operations: string[] = [];
  const warn = vi.spyOn(console, "warn");
  const error = vi.spyOn(console, "error");
  f.mount({ children: <KeybindingSettings />, graphQlExecute: async (document, variables) => {
    const operation = documentOperationName(document);
    operations.push(operation);
    if (operation === "LoadKeybindingSetting") {
      return { keybinding_setting: { scope: "host", key: "keybindings", value: stored, updated_at: "2026-10-12T00:00:00Z" } } as never;
    }
    return f.execute(document, variables);
  } });
  await screen.findByRole("tab", { name: "Roadmap" });
  await loadKeybindingOverrides();
  await waitFor(() => expect(studioKeymapRegistry.getOverrides()).toEqual([settingsOverride]));
  expect(studioKeymapRegistry.getEffectiveBinding("global", voiceOverride.actionId)).toBeNull();
  expect(operations).toContain("LoadKeybindingSetting");
  expect(operations).not.toContain("UpdateKeybindingSetting");
  expect(stored).toEqual([voiceOverride, settingsOverride]);
  expect(warn.mock.calls.filter(([message]) => String(message).includes("[keymap]"))).toEqual([]);
  expect(error).not.toHaveBeenCalled();
  expect(screen.queryByText(/voice/i)).toBeNull();
});
