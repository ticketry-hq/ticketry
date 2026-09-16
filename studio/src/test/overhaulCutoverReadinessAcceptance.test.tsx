import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ServiceHealthGate } from "../app/startup/ServiceHealthGate";
import {
  inertLaunchkeyRuntime,
  type ServiceHealth,
  type StudioRuntime,
} from "../runtime";
import { quietAppUpdatesRuntime } from "./appUpdatesRuntimeFixture";

function runtime(health: ServiceHealth): StudioRuntime {
  return {
    platform: "desktop",
    graphQlTransport: () => { throw new Error("not used"); },
    launchkey: inertLaunchkeyRuntime,
    capabilities: {
      statusFeed: true,
      nativeLifecycle: true,
      serviceSupervision: true,
      nativeTerminal: true,
      nativeFolderPicker: true,
      appUpdates: true,
    },
    appUpdates: quietAppUpdatesRuntime(),
    startup: () => ({
      serviceHealth: health,
      initialNotices: [],
    }),
    subscribeServiceHealth: () => () => {},
    subscribeUserNotices: () => () => {},
    retryServices: async () => {},
    readWorkTracker: async () => { throw new Error("not used"); },
    writeWorkTracker: async () => { throw new Error("not used"); },
    readSettings: async () => { throw new Error("not used"); },
    writeSettings: async () => { throw new Error("not used"); },
    statusStream: () => null,
    documentUrl: () => "",
    pickFolder: async () => null,
  };
}

describe("cutover readiness", () => {
  it("[overhaul-289] opens Studio when services became ready before the WebView subscribed", () => {
    // No health event is delivered: the early startup worker has already
    // finished, so the initial configuration must be sufficient to open Studio.
    render(
      <ServiceHealthGate runtime={runtime({
        state: "ready",
        service: null,
        message: null,
        logPointer: null,
      })}>
        <button type="button">Create work item</button>
      </ServiceHealthGate>,
    );

    expect(screen.getByRole("button", { name: "Create work item" })).toBeEnabled();
    expect(screen.queryByText("Preparing Ticketry data")).not.toBeInTheDocument();
  });

  it("[overhaul-156] keeps Studio closed through adoption and names the recovery boundary", () => {
    render(
      <ServiceHealthGate runtime={runtime({
        state: "migrating",
        service: "adoption",
        message: null,
        logPointer: null,
      })}>
        <button type="button">Create work item</button>
      </ServiceHealthGate>,
    );

    expect(screen.getByRole("heading", { name: "Preparing Ticketry data" }))
      .toBeInTheDocument();
    expect(screen.getByText(/snapshot verification and event publication finish/))
      .toBeInTheDocument();
    expect(screen.getByText(/Terminal recovery finishes behind the open window/))
      .toBeInTheDocument();
    expect(screen.getByText(/automatic restore point until Studio opens/))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create work item" }))
      .not.toBeInTheDocument();
  });

  it("[overhaul-157] distinguishes each blocked startup class", () => {
    const cases = [
      ["UnsupportedSource", "This Ticketry data version is unsupported"],
      ["SemanticRefusal", "Ticketry found data it cannot safely carry forward"],
      ["SnapshotFailed", "Ticketry could not verify a recovery snapshot"],
      ["BridgePostconditionFailed", "Ticketry could not transform this installation"],
      ["PostflightFailed", "Ticketry could not verify the updated installation"],
      ["restore the verified recovery snapshot", "This installation needs recovery"],
      ["local service unavailable", "Ticketry services could not start"],
    ] as const;

    for (const [message, heading] of cases) {
      const view = render(
        <ServiceHealthGate runtime={runtime({
          state: "failed",
          service: "adoption",
          message,
          logPointer: null,
        })}>
          <div>Studio</div>
        </ServiceHealthGate>,
      );
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("[overhaul-159] reports the application log without a retired sidecar notice", () => {
    render(
      <ServiceHealthGate runtime={runtime({
        state: "failed",
        service: "runtime",
        message: "Runtime startup failed",
        logPointer: "/tmp/ticketry.log",
      })}>
        <div>Studio</div>
      </ServiceHealthGate>,
    );

    expect(screen.getByText("Application log:")).toBeInTheDocument();
    expect(screen.getByText("/tmp/ticketry.log")).toBeInTheDocument();
    expect(screen.queryByText(/sidecar/i)).not.toBeInTheDocument();
  });
});
