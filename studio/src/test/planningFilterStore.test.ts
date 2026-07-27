import { toggleEpic, NO_EPIC } from "../features/work-items/internal/backlogStore";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { usePlanningFilterStore } from "../features/work-items/internal/planningFilterStore";

const pf = () => usePlanningFilterStore.getState();
const KEY = (pid: string) => `studio.planningFilter:v1:${pid}`;

beforeEach(() => {
  localStorage.clear();
  usePlanningFilterStore.setState({
    projectId: null,
    epicIds: [],
    stateIds: [],
  });
});

describe("planningFilterStore · axes", () => {
  it("starts all-empty (empty = all)", () => {
    expect(pf().epicIds).toEqual([]);
    expect(pf().stateIds).toEqual([]);
  });

  it("a setter replaces an axis wholesale", () => {
    pf().setStateIds(["s1", "s2"]);
    expect(pf().stateIds).toEqual(["s1", "s2"]);
    pf().setStateIds(["s3"]);
    expect(pf().stateIds).toEqual(["s3"]);
  });

  it("toggling via the shared toggleEpic helper adds then removes", () => {
    pf().setProject("p1");
    pf().setEpicIds(toggleEpic(pf().epicIds, "m1"));
    expect(pf().epicIds).toEqual(["m1"]);
    pf().setEpicIds(toggleEpic(pf().epicIds, NO_EPIC));
    expect(pf().epicIds).toEqual(["m1", NO_EPIC]);
    pf().setEpicIds(toggleEpic(pf().epicIds, "m1"));
    expect(pf().epicIds).toEqual([NO_EPIC]);
  });
});

describe("planningFilterStore · persistence", () => {
  it("a mutation writes the per-project key", () => {
    pf().setProject("p1");
    pf().setStateIds(["st7"]);
    expect(JSON.parse(localStorage.getItem(KEY("p1"))!)).toEqual({
      epicIds: [],
      stateIds: ["st7"],
    });
  });

  it("setProject on a fresh project loads all-empty", () => {
    pf().setProject("brand-new");
    expect(pf().projectId).toBe("brand-new");
    expect(pf().epicIds).toEqual([]);
    expect(pf().stateIds).toEqual([]);
  });

  it("setProject rehydrates a previously stored selection", () => {
    localStorage.setItem(
      KEY("p1"),
      JSON.stringify({ epicIds: ["m1"], stateIds: ["st1"] }),
    );
    pf().setProject("p1");
    expect(pf().epicIds).toEqual(["m1"]);
    expect(pf().stateIds).toEqual(["st1"]);
  });

  it("switching projects swaps the live selection", () => {
    pf().setProject("p1");
    pf().setEpicIds(["m1"]);
    pf().setProject("p2");
    expect(pf().epicIds).toEqual([]); // p2 has nothing stored
    pf().setProject("p1");
    expect(pf().epicIds).toEqual(["m1"]); // p1's selection restored
  });
});

describe("planningFilterStore · reconcile (pruning)", () => {
  it("drops stale ids against the live id sets", () => {
    pf().setProject("p1");
    pf().setEpicIds(["m1", "m-gone"]);
    pf().setStateIds(["st1", "st-gone"]);
    pf().reconcile({ moduleIds: ["m1"], stateIds: ["st1"] });
    expect(pf().epicIds).toEqual(["m1"]);
    expect(pf().stateIds).toEqual(["st1"]);
  });

  it("an all-stale axis collapses to [] (= all)", () => {
    pf().setProject("p1");
    pf().setStateIds(["st-gone-1", "st-gone-2"]);
    pf().reconcile({ moduleIds: [], stateIds: ["st1"] });
    expect(pf().stateIds).toEqual([]);
  });

  it("never prunes the NO_EPIC sentinel", () => {
    pf().setProject("p1");
    pf().setEpicIds([NO_EPIC, "m-gone"]);
    pf().reconcile({ moduleIds: [], stateIds: [] });
    expect(pf().epicIds).toEqual([NO_EPIC]);
  });

  it("persists the pruned result", () => {
    pf().setProject("p1");
    pf().setEpicIds(["m1", "m-gone"]);
    pf().reconcile({ moduleIds: ["m1"], stateIds: [] });
    expect(JSON.parse(localStorage.getItem(KEY("p1"))!).epicIds).toEqual(["m1"]);
  });
});

describe("planningFilterStore · resilience", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a throwing localStorage degrades to all-empty without throwing", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => pf().setProject("p1")).not.toThrow();
    expect(pf().epicIds).toEqual([]);
    expect(() => pf().setEpicIds(["m1"])).not.toThrow();
    expect(pf().epicIds).toEqual(["m1"]); // in-memory still applies
  });
});
