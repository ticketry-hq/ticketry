import { beforeEach, describe, expect, it, vi } from "vitest";
import { read, touch, resolveStartProject } from "./recentProjects";
import type { Project } from "../../../shared/api/types";

const KEY = "studio.recentProjects";
const P = (id: string): Project => ({ id, name: id, slug: id, description: "" });

beforeEach(() => {
  localStorage.clear();
});

describe("recentProjects", () => {
  it("touch moves an id to the front and dedupes", () => {
    touch("a");
    touch("b");
    touch("a"); // re-touch fronts it without duplicating
    expect(read()).toEqual(["a", "b"]);
  });

  it("read returns [] on missing or corrupt storage", () => {
    expect(read()).toEqual([]);
    localStorage.setItem(KEY, "{not json");
    expect(read()).toEqual([]);
    // A non-array JSON value is also rejected.
    localStorage.setItem(KEY, '{"x":1}');
    expect(read()).toEqual([]);
  });

  it("resolveStartProject picks the first surviving MRU id", () => {
    touch("gone"); // most-recent but no longer exists
    touch("p2");
    touch("p1"); // p1 is now front; p2 next; gone last
    // MRU order is [p1, p2, gone]; p1 survives → chosen.
    expect(resolveStartProject([P("p2"), P("p1")])).toBe("p1");
  });

  it("skips a stale MRU id and falls through to a survivor", () => {
    touch("p2");
    touch("gone"); // front, but not in the project list
    expect(resolveStartProject([P("p2")])).toBe("p2");
  });

  it("excludes a just-deleted id from the redirect target", () => {
    touch("p2");
    touch("p1"); // front
    expect(resolveStartProject([P("p1"), P("p2")], "p1")).toBe("p2");
  });

  it("falls back to the first project when the MRU list is empty", () => {
    expect(resolveStartProject([P("p9"), P("p8")])).toBe("p9");
  });

  it("returns null when no projects remain", () => {
    expect(resolveStartProject([])).toBeNull();
    expect(resolveStartProject([P("only")], "only")).toBeNull();
  });

  it("touch swallows a localStorage write failure", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => touch("x")).not.toThrow();
    spy.mockRestore();
  });
});
