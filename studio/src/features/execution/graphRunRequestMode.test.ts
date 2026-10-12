import { describe, expect, it } from "vitest";
import { EDITION } from "../../shared/config/edition";
import { graphRunRequestMode } from "./graphRunRequestMode";

// Runs under the default (core) and the Pocock Vitest configurations.
describe("Graph Run request mode", () => {
  it("keeps the caller's mode, and leaves an omitted mode unset, when parallel runs are available", () => {
    expect(graphRunRequestMode(undefined, true)).toBeNull();
    expect(graphRunRequestMode("parallel", true)).toBe("parallel");
    expect(graphRunRequestMode("serial", true)).toBe("serial");
  });

  it("sends serial for every request when parallel runs are unavailable", () => {
    expect(graphRunRequestMode(undefined, false)).toBe("serial");
    expect(graphRunRequestMode("parallel", false)).toBe("serial");
    expect(graphRunRequestMode("serial", false)).toBe("serial");
  });

  it(`binds the compiled ${EDITION} edition's parallel capability by default`, () => {
    const omitted = EDITION === "core" ? null : "serial";
    const parallel = EDITION === "core" ? "parallel" : "serial";
    expect(graphRunRequestMode(undefined)).toBe(omitted);
    expect(graphRunRequestMode("parallel")).toBe(parallel);
    expect(graphRunRequestMode("serial")).toBe("serial");
  });
});
