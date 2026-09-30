import type {
  MidiTransport,
  PortDescription,
} from "@bandwati/launchkey-adaptor";

export interface LaunchkeyMidiPorts {
  readonly inputs: readonly PortDescription[];
  readonly outputs: readonly PortDescription[];
}

export interface LaunchkeyMidiSelection {
  readonly midiInput?: string;
  readonly dawInput?: string;
  readonly midiOutput?: string;
  readonly dawOutput?: string;
}

export interface LaunchkeyMidiRuntime {
  listPorts(): Promise<LaunchkeyMidiPorts>;
  connect(options?: {
    readonly ports?: LaunchkeyMidiSelection;
  }): Promise<MidiTransport>;
}

/** Platform-neutral operations consumed by the Launchkey feature. */
export interface LaunchkeyRuntime {
  midi(): LaunchkeyMidiRuntime | null;
  toggleHandyTranscription(): Promise<void>;
  /** Submit one carriage return through an existing terminal viewer. */
  submitTerminal(viewerHandle: string): Promise<void>;
}

/** Browser and test implementation that performs no native work. */
export const inertLaunchkeyRuntime: LaunchkeyRuntime = Object.freeze({
  midi: () => null,
  toggleHandyTranscription: async () => {},
  submitTerminal: async (_viewerHandle: string) => {},
});
