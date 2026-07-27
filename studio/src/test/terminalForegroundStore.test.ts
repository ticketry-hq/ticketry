import { describe, it, expect, beforeEach } from "vitest";

import {
  foregroundKey,
  isStudioEligible,
  resolveOwner,
  useTerminalForegroundStore,
} from "../features/agents/terminal/internal/foregroundStore";

const store = useTerminalForegroundStore;

beforeEach(() => {
  store.setState({ claims: {}, hostTargets: {} });
});

describe("terminalForegroundStore — foreground key", () => {
  it("prefers the durable run id, else the live session id", () => {
    expect(foregroundKey({ agentRunId: "run-1", sessionId: "sess-1" })).toBe(
      "run-1",
    );
    expect(foregroundKey({ agentRunId: null, sessionId: "tmp_x" })).toBe(
      "tmp_x",
    );
  });
});

describe("terminalForegroundStore — arbitration", () => {
  it("resolves an unclaimed key to studio by default", () => {
    expect(resolveOwner(store.getState(), "k1")).toBe("studio");
  });

  it("acquire(drawer) wins, release reverts to studio", () => {
    store.getState().acquire("k1", "drawer");
    expect(resolveOwner(store.getState(), "k1")).toBe("drawer");
    store.getState().release("k1");
    expect(resolveOwner(store.getState(), "k1")).toBe("studio");
  });

  it("acquire(studio) is equivalent to releasing the key", () => {
    store.getState().acquire("k1", "drawer");
    store.getState().acquire("k1", "studio");
    expect(resolveOwner(store.getState(), "k1")).toBe("studio");
    expect(store.getState().claims).toEqual({});
  });

  it("is per-session: claiming X leaves Y studio-eligible", () => {
    store.getState().acquire("X", "drawer");
    expect(resolveOwner(store.getState(), "X")).toBe("drawer");
    expect(resolveOwner(store.getState(), "Y")).toBe("studio");
  });

  it("releaseOwner(drawer) clears every drawer claim at once", () => {
    store.getState().acquire("a", "drawer");
    store.getState().acquire("b", "drawer");
    store.getState().releaseOwner("drawer");
    expect(store.getState().claims).toEqual({});
    expect(resolveOwner(store.getState(), "a")).toBe("studio");
    expect(resolveOwner(store.getState(), "b")).toBe("studio");
  });

  it("rekey moves a claim; the old key reverts to studio", () => {
    store.getState().acquire("tmp_1", "drawer");
    store.getState().rekey("tmp_1", "run-1");
    expect(resolveOwner(store.getState(), "tmp_1")).toBe("studio");
    expect(resolveOwner(store.getState(), "run-1")).toBe("drawer");
  });

  it("rekey is a no-op when the key is unchanged or unclaimed", () => {
    store.getState().rekey("a", "a");
    expect(store.getState().claims).toEqual({});
    store.getState().rekey("missing", "other");
    expect(store.getState().claims).toEqual({});
  });

});

describe("terminalForegroundStore — isStudioEligible", () => {
  const meta = { agentRunId: null as string | null, sessionId: "sess-1" };

  it("is true for an unclaimed session and false once the drawer claims it", () => {
    expect(isStudioEligible(store.getState(), meta)).toBe(true);
    store.getState().acquire("sess-1", "drawer");
    expect(isStudioEligible(store.getState(), meta)).toBe(false);
  });
});

describe("terminalForegroundStore — host targets", () => {
  it("registers and unregisters a mount target per owner", () => {
    const el = { id: "studio-host" } as unknown as HTMLElement;
    store.getState().registerHost("studio", el);
    expect(store.getState().hostTargets.studio).toBe(el);
    store.getState().unregisterHost("studio");
    expect(store.getState().hostTargets.studio).toBeUndefined();
  });
});
