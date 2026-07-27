import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceTabsStore } from "../../features/agents/terminal";

describe("workspaceTabsStore", () => {
  beforeEach(() => {
    useWorkspaceTabsStore.setState({
      byTaskId: {},
      activeByTask: {},
      chatByDoc: {},
      focusRequest: null,
      focusSequence: 0,
    });
  });

  it("rekeys every tab pointer after a session acknowledgement", () => {
    const tabs = useWorkspaceTabsStore.getState();
    tabs.tabOpened("task-1", "tmp-1");
    tabs.docChatOpened("task-1::a.html", "tmp-1");
    tabs.tabRekeyed("tmp-1", "server-1");

    expect(useWorkspaceTabsStore.getState()).toMatchObject({
      byTaskId: { "task-1": ["server-1"] },
      activeByTask: { "task-1": "server-1" },
      chatByDoc: { "task-1::a.html": "server-1" },
    });
  });

  it("focuses the adjacent tab when the active tab closes", () => {
    const tabs = useWorkspaceTabsStore.getState();
    tabs.tabOpened("task-1", "a");
    tabs.tabOpened("task-1", "b");
    tabs.tabOpened("task-1", "c");
    tabs.tabFocused("task-1", "b");
    tabs.tabClosed("b");

    expect(useWorkspaceTabsStore.getState().byTaskId["task-1"]).toEqual(["a", "c"]);
    expect(useWorkspaceTabsStore.getState().activeByTask["task-1"]).toBe("c");
  });

  it("clears a document pointer when its hidden session closes", () => {
    const tabs = useWorkspaceTabsStore.getState();
    tabs.docChatOpened("task-1::a.html", "doc-1");
    tabs.tabClosed("doc-1");
    expect(useWorkspaceTabsStore.getState().chatByDoc).toEqual({});
  });

  it("keeps terminal focus requests monotonic after the requested tab closes", () => {
    const tabs = useWorkspaceTabsStore.getState();
    tabs.tabOpened("task-1", "a");
    tabs.tabOpened("task-1", "b");
    tabs.tabFocused("task-1", "a");
    tabs.tabClosed("a");
    expect(useWorkspaceTabsStore.getState().focusRequest).toBeNull();
    tabs.tabFocused("task-1", "b");

    expect(useWorkspaceTabsStore.getState().focusRequest).toEqual({
      sessionId: "b",
      sequence: 2,
    });
  });
});
