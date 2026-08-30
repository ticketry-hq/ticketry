import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ServiceHealthGate } from "../app/startup/ServiceHealthGate";
import type { ServiceHealth, StudioRuntime } from "../runtime";

function runtime(health: ServiceHealth): StudioRuntime {
  return {
    platform: "desktop",
    graphQlTransport: () => { throw new Error("not used"); },
    capabilities: {
      statusFeed: true,
      nativeLifecycle: true,
      serviceSupervision: true,
      nativeTerminal: true,
      nativeFolderPicker: true,
    },
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
    expect(screen.getByText(/snapshot verification, event publication, and runtime reconciliation/))
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

  it("[overhaul-205] turns a locked startup database into an actionable launch message", () => {
    render(
      <ServiceHealthGate runtime={runtime({
        state: "failed",
        service: "runtime",
        message: "Query Error: error returned from database: (code: 5) database is locked",
        logPointer: "/tmp/ticketry.log",
      })}>
        <div>Studio</div>
      </ServiceHealthGate>,
    );

    expect(screen.getByRole("heading", {
      name: "Ticketry is already running or still closing",
    })).toBeInTheDocument();
    expect(screen.getByText(
      "Quit other Ticketry windows, wait a few seconds, then reopen the app.",
    )).toBeInTheDocument();
    expect(screen.queryByText(/Query Error|database is locked/)).not.toBeInTheDocument();
  });
});
