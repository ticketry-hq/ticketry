import { create } from "zustand";
import type {
  DesignDoc,
  DocTabState,
  RunChip,
  TabKind,
} from "../../../../../features/agents/types";

interface TicketWorkspaceStoreState {
  workspaces: Record<string, TicketWorkspaceViewState>;
  reset: () => void;
  ensureWorkspace: (bucket: string) => void;
  setActive: (bucket: string, active: TabKind) => void;
  setOverlayOpen: (bucket: string, docId: string, open: boolean) => void;
  setActiveDoc: (bucket: string, docId: string) => void;
  upsertDoc: (bucket: string, doc: DesignDoc, event: "created" | "updated") => void;
  hydrateDocs: (bucket: string, docs: DesignDoc[]) => void;
  closeDoc: (bucket: string, docId: string) => void;
  reopenDoc: (bucket: string, docId: string) => void;
  recordClosedRun: (bucket: string, chip: RunChip) => void;
}

export interface TicketWorkspaceViewState {
  active: TabKind;
  activeDocId: string | null;
  docs: DocTabState[];
  history: RunChip[];
  overlayOpenByDoc: Record<string, boolean>;
}

export const DEFAULT_WORKSPACE: TicketWorkspaceViewState = {
  active: "details",
  activeDocId: null,
  docs: [],
  history: [],
  overlayOpenByDoc: {},
};

function relabel(docs: DocTabState[]): DocTabState[] {
  const stems = new Map<string, number>();
  for (const doc of docs) {
    const stem = doc.relPath.split("/").pop()?.replace(/\.html?$/i, "") ?? doc.relPath;
    stems.set(stem, (stems.get(stem) ?? 0) + 1);
  }
  return docs.map((doc) => {
    const parts = doc.relPath.split("/");
    const stem = parts.pop()?.replace(/\.html?$/i, "") ?? doc.relPath;
    const duplicate = (stems.get(stem) ?? 0) > 1 && parts.length > 0;
    return { ...doc, label: duplicate ? `${parts[parts.length - 1]}/${stem}` : stem };
  });
}

export const useTicketWorkspaceStore = create<TicketWorkspaceStoreState>((set, get) => ({
  workspaces: {},

  ensureWorkspace(bucket) {
    if (get().workspaces[bucket]) return;
    set((state) => ({
      workspaces: { ...state.workspaces, [bucket]: { ...DEFAULT_WORKSPACE } },
    }));
  },

  setActive(bucket, active) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      return { workspaces: { ...state.workspaces, [bucket]: { ...current, active } } };
    });
  },

  setOverlayOpen(bucket, docId, open) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      const overlayOpenByDoc = { ...current.overlayOpenByDoc };
      if (open) overlayOpenByDoc[docId] = true;
      else delete overlayOpenByDoc[docId];
      return {
        workspaces: {
          ...state.workspaces,
          [bucket]: { ...current, overlayOpenByDoc },
        },
      };
    });
  },

  setActiveDoc(bucket, docId) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      return {
        workspaces: {
          ...state.workspaces,
          [bucket]: { ...current, active: "doc", activeDocId: docId },
        },
      };
    });
  },

  upsertDoc(bucket, doc, event) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      const existing = current.docs.find((candidate) => candidate.relPath === doc.rel_path);
      if (existing) {
        return {
          workspaces: {
            ...state.workspaces,
            [bucket]: {
              ...current,
              docs: current.docs.map((candidate) =>
                candidate.relPath === doc.rel_path
                  ? { ...candidate, docId: doc.id, reloadToken: candidate.reloadToken + 1 }
                  : candidate,
              ),
            },
          },
        };
      }
      const docs = relabel([
        ...current.docs,
        {
          docId: doc.id,
          relPath: doc.rel_path,
          label: doc.label,
          open: true,
          reloadToken: 0,
        },
      ]);
      return {
        workspaces: {
          ...state.workspaces,
          [bucket]: event === "created"
            ? { ...current, docs, active: "doc", activeDocId: doc.id }
            : { ...current, docs },
        },
      };
    });
  },

  hydrateDocs(bucket, incoming) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      const byPath = new Map(current.docs.map((doc) => [doc.relPath, doc]));
      const docs = relabel(incoming.map((doc) => {
        const known = byPath.get(doc.rel_path);
        return known
          ? { ...known, docId: doc.id }
          : {
              docId: doc.id,
              relPath: doc.rel_path,
              label: doc.label,
              open: true,
              reloadToken: 0,
            };
      }));
      const activeStillVisible = docs.some(
        (doc) => doc.docId === current.activeDocId && doc.open,
      );
      return {
        workspaces: {
          ...state.workspaces,
          [bucket]: {
            ...current,
            docs,
            activeDocId: activeStillVisible ? current.activeDocId : null,
            active: current.active === "doc" && !activeStillVisible
              ? "details"
              : current.active,
          },
        },
      };
    });
  },

  closeDoc(bucket, docId) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      const wasActive = current.active === "doc" && current.activeDocId === docId;
      const overlayOpenByDoc = { ...current.overlayOpenByDoc };
      delete overlayOpenByDoc[docId];
      return {
        workspaces: {
          ...state.workspaces,
          [bucket]: {
            ...current,
            docs: current.docs.map((doc) =>
              doc.docId === docId ? { ...doc, open: false } : doc,
            ),
            active: wasActive ? "details" : current.active,
            activeDocId: wasActive ? null : current.activeDocId,
            overlayOpenByDoc,
          },
        },
      };
    });
  },

  reopenDoc(bucket, docId) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      return {
        workspaces: {
          ...state.workspaces,
          [bucket]: {
            ...current,
            docs: current.docs.map((doc) =>
              doc.docId === docId ? { ...doc, open: true } : doc,
            ),
            active: "doc",
            activeDocId: docId,
          },
        },
      };
    });
  },

  recordClosedRun(bucket, chip) {
    set((state) => {
      const current = state.workspaces[bucket] ?? DEFAULT_WORKSPACE;
      if (
        chip.agentRunId &&
        current.history.some((entry) => entry.agentRunId === chip.agentRunId)
      ) return state;
      return {
        workspaces: {
          ...state.workspaces,
          [bucket]: { ...current, history: [...current.history, chip] },
        },
      };
    });
  },

  reset() {
    set({ workspaces: {} });
  },
}));
