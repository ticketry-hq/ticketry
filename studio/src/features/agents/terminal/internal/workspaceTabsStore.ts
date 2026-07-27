import { create } from "zustand";
import type { SessionId } from "../../types";

export interface WorkspaceTabsState {
  byTaskId: Record<string, SessionId[]>;
  activeByTask: Record<string, SessionId>;
  chatByDoc: Record<string, SessionId>;
  focusRequest: { sessionId: SessionId; sequence: number } | null;
  focusSequence: number;
  tabOpened: (bucket: string, sessionId: SessionId, select?: boolean) => void;
  docChatOpened: (key: string, sessionId: SessionId) => void;
  tabRekeyed: (from: SessionId, to: SessionId) => void;
  tabSelected: (bucket: string, sessionId: SessionId) => void;
  tabFocused: (bucket: string, sessionId: SessionId) => void;
  tabClosed: (sessionId: SessionId) => void;
}

export const useWorkspaceTabsStore = create<WorkspaceTabsState>((set) => ({
  byTaskId: {},
  activeByTask: {},
  chatByDoc: {},
  focusRequest: null,
  focusSequence: 0,

  tabOpened(bucket, sessionId, select = true) {
    set((state) => ({
      byTaskId: {
        ...state.byTaskId,
        [bucket]: [...(state.byTaskId[bucket] ?? []), sessionId],
      },
      activeByTask: select || state.activeByTask[bucket] === undefined
        ? { ...state.activeByTask, [bucket]: sessionId }
        : state.activeByTask,
    }));
  },

  docChatOpened(key, sessionId) {
    set((state) => ({ chatByDoc: { ...state.chatByDoc, [key]: sessionId } }));
  },

  tabRekeyed(from, to) {
    if (from === to) return;
    set((state) => ({
      byTaskId: Object.fromEntries(
        Object.entries(state.byTaskId).map(([bucket, ids]) => [
          bucket,
          ids.map((id) => (id === from ? to : id)),
        ]),
      ),
      activeByTask: Object.fromEntries(
        Object.entries(state.activeByTask).map(([bucket, id]) => [
          bucket,
          id === from ? to : id,
        ]),
      ),
      chatByDoc: Object.fromEntries(
        Object.entries(state.chatByDoc).map(([key, id]) => [
          key,
          id === from ? to : id,
        ]),
      ),
      focusRequest:
        state.focusRequest?.sessionId === from
          ? { ...state.focusRequest, sessionId: to }
          : state.focusRequest,
    }));
  },

  tabSelected(bucket, sessionId) {
    set((state) => ({
      activeByTask: { ...state.activeByTask, [bucket]: sessionId },
      focusRequest: null,
    }));
  },

  tabFocused(bucket, sessionId) {
    set((state) => ({
      activeByTask: { ...state.activeByTask, [bucket]: sessionId },
      focusRequest: {
        sessionId,
        sequence: state.focusSequence + 1,
      },
      focusSequence: state.focusSequence + 1,
    }));
  },

  tabClosed(sessionId) {
    set((state) => {
      const byTaskId = { ...state.byTaskId };
      const activeByTask = { ...state.activeByTask };
      for (const [bucket, ids] of Object.entries(state.byTaskId)) {
        if (!ids.includes(sessionId)) continue;
        const index = ids.indexOf(sessionId);
        const remaining = ids.filter((id) => id !== sessionId);
        if (remaining.length === 0) {
          delete byTaskId[bucket];
          delete activeByTask[bucket];
        } else {
          byTaskId[bucket] = remaining;
          if (activeByTask[bucket] === sessionId) {
            activeByTask[bucket] = remaining[Math.min(index, remaining.length - 1)];
          }
        }
      }
      const chatByDoc = Object.fromEntries(
        Object.entries(state.chatByDoc).filter(([, id]) => id !== sessionId),
      );
      return {
        byTaskId,
        activeByTask,
        chatByDoc,
        focusRequest:
          state.focusRequest?.sessionId === sessionId
            ? null
            : state.focusRequest,
      };
    });
  },
}));
