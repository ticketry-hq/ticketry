import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ServiceHealthGate } from "../app/startup/ServiceHealthGate";
import type {
  ServiceHealth,
  ServiceHealthListener,
  StudioRuntime,
} from "../runtime";

function health(state: ServiceHealth["state"]): ServiceHealth {
  return {
    state,
    service: "backend",
    message: null,
    logPointer: null,
  };
}

function runtimeHealthHarness() {
  let listener: ServiceHealthListener | null = null;
  const retryServices = vi.fn().mockResolvedValue(undefined);
  const runtime = {
    platform: "desktop",
    capabilities: {
      statusFeed: true,
      websocketTerminal: true,
      nativeLifecycle: false,
      serviceSupervision: true,
      nativeTerminal: false,
      nativeFolderPicker: true,
    },
    readWorkTracker: (routes: Parameters<StudioRuntime["readWorkTracker"]>[0]) =>
      routes.graphQl(async () => {
        throw new Error("GraphQL is not used by this test.");
      }),
    writeWorkTracker: (routes: Parameters<StudioRuntime["writeWorkTracker"]>[0]) =>
      routes.graphQl(async () => {
        throw new Error("GraphQL is not used by this test.");
      }),
    readSettings: (routes: Parameters<StudioRuntime["readSettings"]>[0]) =>
      routes.graphQl(async () => {
        throw new Error("GraphQL is not used by this test.");
      }),
    writeSettings: (routes: Parameters<StudioRuntime["writeSettings"]>[0]) =>
      routes.graphQl(async () => {
        throw new Error("GraphQL is not used by this test.");
      }),
    statusStream: () => null,
    documentUrl: (documentId: string, relPath: string) =>
      `/api/docs/${documentId}/${relPath}`,
    pickFolder: async () => null,
    startup: () => ({
      endpoints: {
        workTrackerApi: "/api/work-tracker",
        agentApi: "/api",
        statusApi: "/api",
        terminalWebSocket: "/ws/terminal",
      },
      values: { workTrackerApiKey: "" },
      serviceHealth: health("ready"),
      initialNotices: [],
    }),
    retryServices,
    subscribeServiceHealth: (next: ServiceHealthListener) => {
      listener = next;
      next(health("ready"));
      return () => {
        listener = null;
      };
    },
    subscribeUserNotices: () => () => {},
  } as StudioRuntime;

  return {
    runtime,
    retryServices,
    publish(next: ServiceHealth) {
      act(() => listener?.(next));
    },
  };
}

describe("ServiceHealthGate", () => {
  it("blocks Studio while the supervised pair is recovering, then reloads once it is ready", () => {
    const harness = runtimeHealthHarness();
    const reload = vi.fn();

    render(
      <ServiceHealthGate runtime={harness.runtime} reload={reload}>
        <button type="button">Create work item</button>
      </ServiceHealthGate>,
    );

    harness.publish(health("recovering"));

    expect(
      screen.getByRole("heading", { name: "Reconnecting to the local server" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create work item" }))
      .not.toBeInTheDocument();

    harness.publish(health("ready"));

    expect(reload).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("heading", { name: "Reconnecting to the local server" }),
    ).not.toBeInTheDocument();
  });

  it("does not reload for ready health that was not preceded by recovery", () => {
    const harness = runtimeHealthHarness();
    const reload = vi.fn();

    render(
      <ServiceHealthGate runtime={harness.runtime} reload={reload}>
        <div>Studio ready</div>
      </ServiceHealthGate>,
    );

    harness.publish(health("ready"));

    expect(screen.getByText("Studio ready")).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows a diagnosable give-up and invokes the fixed retry action once", () => {
    const harness = runtimeHealthHarness();

    render(
      <ServiceHealthGate runtime={harness.runtime}>
        <div>Studio ready</div>
      </ServiceHealthGate>,
    );

    harness.publish({
      state: "failed",
      service: "backend",
      message: "Pinned port is already in use",
      logPointer: "desktop sidecar log buffer",
    });

    expect(
      screen.getByRole("heading", { name: "Ticketry services could not start" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Pinned port is already in use"))
      .toBeInTheDocument();
    expect(screen.getByText("desktop sidecar log buffer"))
      .toBeInTheDocument();
    expect(screen.queryByText("Studio ready")).not.toBeInTheDocument();

    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    fireEvent.click(retry);

    expect(harness.retryServices).toHaveBeenCalledOnce();
    expect(harness.retryServices).toHaveBeenCalledWith();
  });

  it("returns to the failure screen when Retry fails", async () => {
    const harness = runtimeHealthHarness();
    harness.retryServices.mockRejectedValueOnce(new Error("retry failed"));

    render(
      <ServiceHealthGate runtime={harness.runtime}>
        <div>Studio ready</div>
      </ServiceHealthGate>,
    );
    harness.publish({
      state: "failed",
      service: "backend",
      message: "Pinned port is still in use",
      logPointer: "desktop sidecar log buffer",
    });

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("button", { name: "Retry" }))
      .toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Ticketry services could not start" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Studio ready")).not.toBeInTheDocument();
  });
});
