import type { MidiTransport } from "@bandwati/launchkey-adaptor";
import {
  TauriMidiTransport,
  type TauriTransportOptions,
} from "@bandwati/launchkey-adaptor/tauri";

import type { LaunchkeyMidiRuntime } from "./launchkey";

/** Native MIDI factory kept out of the platform-neutral feature code. */
export const desktopLaunchkeyMidi: LaunchkeyMidiRuntime = Object.freeze({
  listPorts: () => TauriMidiTransport.listPorts(),
  connect: async (options?: TauriTransportOptions): Promise<MidiTransport> => {
    const transport = await TauriMidiTransport.connect(options);
    return {
      get connected() {
        return transport.connected;
      },
      get ports() {
        return transport.ports ?? undefined;
      },
      onMessage: transport.onMessage.bind(transport),
      onStateChange: transport.onStateChange.bind(transport),
      send: transport.send.bind(transport),
      disconnect: transport.disconnect.bind(transport),
    };
  },
});
