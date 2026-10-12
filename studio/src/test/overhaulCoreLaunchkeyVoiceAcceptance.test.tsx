import { screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { editionAcceptanceFixture } from "./editionAcceptanceFixture";
import { AGENT_RUN_ACTIONS, studioKeymapRegistry } from "../app/navigation/keymapRegistry";
import { launchkeyStartup } from "../features/launchkey";
import { initializeStudioRuntime, studioRuntime } from "../runtime";

afterEach(() => vi.restoreAllMocks());

it("core starts LaunchKey MIDI control from the mounted shell as before", async () => {
  const start = vi.spyOn(launchkeyStartup, "start");
  editionAcceptanceFixture().mount({ onGraphQlSubscribe: async () => '{"type":"accepted"}' });
  await screen.findByRole("tab", { name: "Roadmap" });
  await waitFor(() => expect(start).toHaveBeenCalledWith(studioRuntime()));
});

it("core registers the voice transcription action and dispatches it through the runtime", async () => {
  editionAcceptanceFixture().mount();
  await screen.findByRole("tab", { name: "Roadmap" });
  const toggle = vi.fn(async () => {});
  const runtime = studioRuntime();
  initializeStudioRuntime({ ...runtime, launchkey: { ...runtime.launchkey, toggleHandyTranscription: toggle } });
  expect(studioKeymapRegistry.getRegisteredActionIds()).toEqual(
    expect.arrayContaining(Object.values(AGENT_RUN_ACTIONS)),
  );
  await expect(studioKeymapRegistry.dispatch(AGENT_RUN_ACTIONS.toggleVoiceTranscription)).resolves.toBe(true);
  expect(toggle).toHaveBeenCalledOnce();
});
