import { describe, expect, it, vi } from "vitest";

import type { StudioRuntime } from "../../runtime";

const services = vi.hoisted(() => ({
  events: [] as string[],
  statusStart: vi.fn(() => services.events.push("status")),
  statusStop: vi.fn(),
  deadlinesStart: vi.fn(),
  deadlinesStop: vi.fn(),
  launchkeyStart: vi.fn(() => services.events.push("launchkey")),
}));

vi.mock("../../features/agents/status/stream/statusStreamFeed", () => ({
  statusStreamFeed: {
    start: services.statusStart,
    stop: services.statusStop,
  },
}));

vi.mock("../../features/agents/status", () => ({
  startStallDeadlines: services.deadlinesStart,
  stopStallDeadlines: services.deadlinesStop,
}));

vi.mock("../../features/launchkey", () => ({
  launchkeyStartup: { start: services.launchkeyStart },
}));

import { startAgentStatusServices } from "./startAgentStatusServices";

describe("agent status startup services", () => {
  it("starts Launchkey after the agent status stream is available", () => {
    const runtime = { platform: "desktop" } as StudioRuntime;
    const createProxy = vi.fn();

    const stop = startAgentStatusServices("project-1", createProxy, runtime);

    expect(services.events).toEqual(["status", "launchkey"]);
    expect(services.statusStart).toHaveBeenCalledWith("project-1", {
      createProxy,
    });
    expect(services.launchkeyStart).toHaveBeenCalledWith(runtime);
    expect(services.deadlinesStart).toHaveBeenCalledOnce();

    stop();

    expect(services.statusStop).toHaveBeenCalledOnce();
    expect(services.deadlinesStop).toHaveBeenCalledOnce();
  });
});
