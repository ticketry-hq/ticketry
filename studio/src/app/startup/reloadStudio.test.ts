import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  reloadStudio,
  reportPendingStudioReload,
  STUDIO_RELOAD_EVIDENCE_KEY,
} from "./reloadStudio";

describe("studio reload evidence", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("persists and logs the cause before refreshing", () => {
    const refresh = vi.fn();
    reloadStudio(
      { source: "native-render-recovery", details: { attempt: 2 } },
      refresh,
    );

    expect(refresh).toHaveBeenCalledOnce();
    const stored = JSON.parse(
      window.sessionStorage.getItem(STUDIO_RELOAD_EVIDENCE_KEY)!,
    );
    expect(stored.cause).toEqual({
      source: "native-render-recovery",
      details: { attempt: 2 },
    });
    expect(typeof stored.at).toBe("string");
    expect(console.error).toHaveBeenCalledWith(
      "[studio-reload] reloading studio",
      expect.objectContaining({ cause: stored.cause }),
    );
  });

  it("reports the previous document's reload once in the next document", () => {
    reloadStudio({ source: "service-health-recovered", details: null }, () => {});

    expect(reportPendingStudioReload()).toMatchObject({
      cause: { source: "service-health-recovered" },
    });
    expect(console.warn).toHaveBeenCalledWith(
      "[studio-reload] previous document was reloaded",
      expect.objectContaining({ cause: { source: "service-health-recovered", details: null } }),
    );
    expect(window.sessionStorage.getItem(STUDIO_RELOAD_EVIDENCE_KEY)).toBeNull();
    expect(reportPendingStudioReload()).toBeNull();
  });

  it("still refreshes when evidence cannot be serialised", () => {
    const refresh = vi.fn();
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    reloadStudio({ source: "test", details: cyclic }, refresh);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
