import type { LaunchkeyMidiRuntime, StudioRuntime } from "../../runtime";
import {
  createLaunchkeyController,
  type LaunchkeyController,
} from "./launchkeyController";

type CreateLaunchkeyController = (options: {
  readonly midi: LaunchkeyMidiRuntime;
}) => LaunchkeyController;

export interface LaunchkeyStartup {
  start(runtime: StudioRuntime): void;
}

export function createLaunchkeyStartup({
  createController = createLaunchkeyController,
}: {
  readonly createController?: CreateLaunchkeyController;
} = {}): LaunchkeyStartup {
  let controller: LaunchkeyController | null = null;

  return {
    start(runtime) {
      if (runtime.platform !== "desktop" || controller) return;
      const midi = runtime.launchkey.midi();
      if (!midi) return;
      controller = createController({ midi });
      void controller.start().catch(() => {});
    },
  };
}

export const launchkeyStartup = createLaunchkeyStartup();
