import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServiceHealthGate } from "../app/startup/ServiceHealthGate";
import { inertLaunchkeyRuntime, type ServiceHealth, type StudioRuntime } from "../runtime";
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

const failure: ServiceHealth = {
  state: "failed",
  service: "planner",
  message: "Ticketry planner could not bind 127.0.0.1:43210: address already in use",
  logPointer: "/tmp/ticketry.log",
};

function expectDiagnostics() {
  expect(screen.getByText("Ticketry planner could not bind 127.0.0.1:43210: address already in use")).toBeInTheDocument();
  expect(screen.getByText("/tmp/ticketry.log")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Settings" })).toBeEnabled();
  expect(screen.queryByText("Studio ready")).not.toBeInTheDocument();
}

describe("planner startup recovery", () => {
  it("[overhaul-425] offers normal desktop restart guidance after a planner bind failure", () => {
    const retryServices = vi.fn();
    render(<ServiceHealthGate runtime={{ ...runtime(failure), serviceRecovery: "restart", retryServices }}>
      <div>Studio ready</div>
    </ServiceHealthGate>);

    expectDiagnostics();
    expect(screen.getByText(/quit and reopen Ticketry to retry startup/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(retryServices).not.toHaveBeenCalled();
  });

  it("[overhaul-426] preserves Retry for a recoverable runtime and exposes rejection feedback", async () => {
    const retryServices = vi.fn().mockRejectedValue("Port remains occupied");
    render(<ServiceHealthGate runtime={{ ...runtime(failure), serviceRecovery: "retry", retryServices }}>
      <div>Studio ready</div>
    </ServiceHealthGate>);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Retrying…" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Port remains occupied");
    expect(screen.getByRole("alert")).toHaveTextContent("retry or restart Ticketry");
    expectDiagnostics();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(retryServices).toHaveBeenCalledOnce();
  });
});
