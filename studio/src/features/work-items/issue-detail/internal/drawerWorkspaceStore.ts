import { create } from "zustand";
import { useConfigStore } from "../../../agents/stores/configStore";
import type {
  DesignDoc,
  DocTabState,
  Profile,
  RunChip,
  TabKind,
} from "../../../agents/types";
import { resolveIssueWorkspaceContext } from "./issueWorkspaceContext";
import type { IssueWorkspaceModuleContext } from "./issueWorkspaceContext";
import { useIssueStore } from "./issueStore";

type ResourceStatus = "idle" | "loading" | "ready" | "not_ready" | "degraded" | "error";

interface ResourceState {
  status: ResourceStatus;
  error: string | null;
}

export interface DrawerLaunchContext {
  projectId: string;
  moduleId: string | null;
  taskId: string;
  taskKey: string;
  taskName: string;
  ticketSeq: number | null;
  profileReady: boolean;
  profile: Profile | null;
}

export interface IssueDrawerWorkspaceViewModel {
  issueKey: string;
  /** Identifier only; the canonical work-item store owns the record. */
  taskId: string | null;
  projectId: string | null;
  module: IssueWorkspaceModuleContext | null;
  profile: ResourceState & { profile: Profile | null };
  launchContext: DrawerLaunchContext | null;
  loading: boolean;
  error: string | null;
}

interface DrawerWorkspaceState {
  byIssueKey: Record<string, IssueDrawerWorkspaceViewModel>;
  workspaces: Record<string, TicketWorkspace>;
  hydrate: (issueKey: string) => Promise<void>;
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

export interface TicketWorkspace {
  active: TabKind;
  activeDocId: string | null;
  docs: DocTabState[];
  history: RunChip[];
  overlayOpenByDoc: Record<string, boolean>;
}

export const DEFAULT_WORKSPACE: TicketWorkspace = {
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyView(issueKey: string): IssueDrawerWorkspaceViewModel {
  return {
    issueKey,
    taskId: null,
    projectId: null,
    module: null,
    profile: { status: "idle", error: null, profile: null },
    launchContext: null,
    loading: false,
    error: null,
  };
}

function currentProfile(): Profile | null {
  const { profiles, recentProfileIndex } = useConfigStore.getState();
  return recentProfileIndex === null ? null : profiles[recentProfileIndex] ?? null;
}

function profileState(): IssueDrawerWorkspaceViewModel["profile"] {
  const profile = currentProfile();
  // Launch only needs a selected local profile; it must not gate on anything
  // beyond that profile and the module folder needed as the working directory.
  if (!profile) {
    return {
      status: "not_ready",
      error: "No Studio profile is selected.",
      profile: null,
    };
  }
  return { status: "ready", error: null, profile };
}

const hydrateRuns = new Map<string, number>();

export const useIssueDrawerWorkspaceStore = create<DrawerWorkspaceState>((set, get) => ({
  byIssueKey: {},
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

  async hydrate(issueKey) {
    const run = (hydrateRuns.get(issueKey) ?? 0) + 1;
    hydrateRuns.set(issueKey, run);
    const prior = get().byIssueKey[issueKey] ?? emptyView(issueKey);
    set({
      byIssueKey: {
        ...get().byIssueKey,
        [issueKey]: {
          ...prior,
          loading: true,
          error: null,
          profile: { ...prior.profile, status: "loading", error: null },
        },
      },
    });

    try {
      const [context, configResult] = await Promise.all([
        resolveIssueWorkspaceContext(issueKey),
        useConfigStore.getState().loadConfig().then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        ),
      ]);
      if (run !== hydrateRuns.get(issueKey)) return;

      const taskId = context.task.id;
      useIssueStore.getState().hydrateWorkItems([context.task]);
      get().ensureWorkspace(taskId);

      const profile = configResult.ok
        ? profileState()
        : { status: "error" as const, error: message(configResult.error), profile: null };

      set({
        byIssueKey: {
          ...get().byIssueKey,
          [issueKey]: {
            ...emptyView(issueKey),
            loading: true,
            taskId,
            projectId: context.projectId,
            module: context.module,
            profile,
            launchContext: {
              projectId: context.projectId,
              moduleId: context.module.moduleId,
              taskId,
              taskKey: context.task.key,
              taskName: context.task.name,
              ticketSeq: context.task.sequence_id,
              profileReady: profile.status === "ready",
              profile: profile.profile,
            },
          },
        },
      });

      set({
        byIssueKey: {
          ...get().byIssueKey,
          [issueKey]: {
            ...get().byIssueKey[issueKey],
            loading: false,
          },
        },
      });
    } catch (error) {
      if (run !== hydrateRuns.get(issueKey)) return;
      set({
        byIssueKey: {
          ...get().byIssueKey,
          [issueKey]: {
            ...emptyView(issueKey),
            loading: false,
            error: message(error),
            profile: { status: "idle", error: null, profile: null },
          },
        },
      });
    }
  },

  reset() {
    hydrateRuns.clear();
    set({ byIssueKey: {}, workspaces: {} });
  },
}));
