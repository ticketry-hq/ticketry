import { afterEach, describe, expect, it } from "vitest";

import { useModalStore } from "./modalStore";
import {
  clearPresentedNoticeIds,
  readPresentedNoticeIds,
  recordPresentedNoticeId,
} from "./presentedNoticeStore";

const STORAGE_KEY = "ticketry.modal.presentedNotices";

function notice(id: string) {
  return {
    id,
    severity: "warning" as const,
    title: "MCP connection changed",
    message: "The MCP endpoint moved to a new port.",
    acknowledgementLabel: "Understood",
  };
}

afterEach(() => {
  clearPresentedNoticeIds();
  useModalStore.setState({ modalStack: [], presentedNoticeIds: new Set() });
});

describe("presented notice store", () => {
  it("reads nothing from an empty session", () => {
    expect(readPresentedNoticeIds()).toEqual([]);
  });

  it("returns recorded ids exactly once each", () => {
    recordPresentedNoticeId("mcp-port-rollover:43101:43219");
    recordPresentedNoticeId("mcp-unavailable");
    recordPresentedNoticeId("mcp-port-rollover:43101:43219");

    expect(readPresentedNoticeIds().sort()).toEqual([
      "mcp-port-rollover:43101:43219",
      "mcp-unavailable",
    ]);
  });

  it("treats malformed and wrongly versioned records as nothing presented", () => {
    for (const raw of [
      "not json",
      '"a string"',
      '{"version":99,"ids":["x"]}',
      '{"version":1,"ids":"x"}',
    ]) {
      window.sessionStorage.setItem(STORAGE_KEY, raw);
      expect(readPresentedNoticeIds()).toEqual([]);
    }
  });

  it("drops non-string and empty ids from a stored record", () => {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, ids: ["kept", "", 7, null] }),
    );

    expect(readPresentedNoticeIds()).toEqual(["kept"]);
  });
});

describe("notice presentation across an in-app refresh", () => {
  it("records a presented notice for the next document", () => {
    useModalStore.getState().notifyUser(notice("mcp-port-rollover:43101:43219"));

    expect(useModalStore.getState().modalStack).toHaveLength(1);
    expect(readPresentedNoticeIds()).toEqual([
      "mcp-port-rollover:43101:43219",
    ]);
  });

  it("stays silent when the replayed startup notices were already presented", () => {
    recordPresentedNoticeId("mcp-port-rollover:43101:43219");
    // A recovery refresh rebuilds the store; its dedup set reseeds from the
    // window session rather than starting empty.
    useModalStore.setState({
      modalStack: [],
      presentedNoticeIds: new Set(readPresentedNoticeIds()),
    });

    useModalStore.getState().notifyUser(notice("mcp-port-rollover:43101:43219"));

    expect(useModalStore.getState().modalStack).toHaveLength(0);
  });

  it("does not record notices that fail validation", () => {
    useModalStore
      .getState()
      .notifyUser({ ...notice("malformed"), acknowledgementLabel: "" });

    expect(useModalStore.getState().modalStack).toHaveLength(0);
    expect(readPresentedNoticeIds()).toEqual([]);
  });
});
