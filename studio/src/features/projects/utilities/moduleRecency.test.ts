import { afterEach, describe, expect, it } from "vitest";
import {
  fetchModuleActivity,
  registerModuleRecencyProvider,
  sortModulesByRecency,
} from "./moduleRecency";

type M = { id: string; name: string; last_activity?: string };
const mods = (...ids: string[]): M[] => ids.map((id) => ({ id, name: id }));

// Restore the default no-op provider so provider tests don't leak across files.
afterEach(() => registerModuleRecencyProvider(async () => ({})));

describe("sortModulesByRecency", () => {
  it("ranks modules by activity desc, untouched keep input order at tail", () => {
    const sorted = sortModulesByRecency(mods("a", "b", "c", "d"), {
      b: "2026-06-12T09:00:00+00:00",
      d: "2026-06-18T09:00:00+00:00",
    });
    expect(sorted.map((m) => m.id)).toEqual(["d", "b", "a", "c"]);
    // The timestamp is merged onto the leading module.
    expect(sorted[0].last_activity).toBe("2026-06-18T09:00:00+00:00");
  });

  it("ties preserve original input order (stable)", () => {
    const ts = "2026-06-12T09:00:00+00:00";
    const sorted = sortModulesByRecency(mods("a", "b", "c"), { b: ts, a: ts });
    expect(sorted.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("empty activity map → original order preserved", () => {
    const sorted = sortModulesByRecency(mods("a", "b", "c"), {});
    expect(sorted.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });
});

describe("module-recency provider seam", () => {
  it("defaults to an empty activity map with no provider registered", async () => {
    // afterEach installs the no-op provider; assert it yields the empty map.
    registerModuleRecencyProvider(async () => ({}));
    await expect(fetchModuleActivity("p1")).resolves.toEqual({});
  });

  it("returns the registered provider's map", async () => {
    registerModuleRecencyProvider(async (projectId) => ({
      [`${projectId}-m`]: "2026-06-18T09:00:00+00:00",
    }));
    await expect(fetchModuleActivity("p1")).resolves.toEqual({
      "p1-m": "2026-06-18T09:00:00+00:00",
    });
  });

  it("swallows a provider failure to an empty map", async () => {
    registerModuleRecencyProvider(async () => {
      throw new Error("runs endpoint down");
    });
    await expect(fetchModuleActivity("p1")).resolves.toEqual({});
  });
});
