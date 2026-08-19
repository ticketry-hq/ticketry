// Central query-key registry. Every server resource cached by TanStack Query
// names its key here so invalidation sites and the status-feed adapter cannot
// drift from the hooks that populate the cache.
//
// Hierarchy is deliberate: invalidating `queryKeys.tasks.all` clears every
// module's task tree, `queryKeys.tasks.byModule(p, m)` exactly one.

export const queryKeys = {
  config: ["config"] as const,

  projects: {
    all: ["projects"] as const,
  },

  modules: {
    byProject: (projectId: string) => ["modules", projectId] as const,
  },

  states: {
    byProject: (projectId: string) => ["states", projectId] as const,
  },

  issueTypes: {
    byProject: (projectId: string) => ["issue-types", projectId] as const,
  },

  // Module membership only: root ids, parent-to-child ids, and server order.
  tasks: {
    all: ["tasks"] as const,
    byModule: (projectId: string, moduleId: string) =>
      ["tasks", projectId, moduleId] as const,
    detail: (projectId: string, taskId: string) =>
      ["tasks", projectId, "details", taskId] as const,
    emptyTree: ["tasks", "none"] as const,
    emptyDetail: ["tasks", "no-details"] as const,
  },

  workItems: {
    byId: (id: string) => ["workItem", id] as const,
    attachments: (id: string) => ["workItem", id, "attachments"] as const,
    index: ["work-items", "index"] as const,
    detail: (id: string) => ["work-items", "detail", id] as const,
    children: (parentId: string) => ["work-items", "children", parentId] as const,
    byProject: (projectId: string, filters: object = {}) =>
      ["work-items", "project", projectId, filters] as const,
  },

  workspace: ["workspace"] as const,

  workflows: {
    // The one normalized workflow-catalogue read every workflow/settings
    // reader selects from, so a settings load costs one catalogue round-trip.
    catalog: (projectId: string) =>
      ["workflows", "catalog", projectId] as const,
    byProject: (projectId: string) =>
      ["workflows", "project", projectId] as const,
    byIssueType: (issueTypeId: string) =>
      ["workflows", "issue-type", issueTypeId] as const,
    stateCounts: (projectId: string) =>
      ["workflows", "state-counts", projectId] as const,
  },

  providers: {
    catalog: ["providers", "catalog"] as const,
    capabilities: ["providers", "capabilities"] as const,
  },

  // One top-level Work Item owns one checkout and every descendant shares it,
  // so the owner leads the key: `owned(ownerId)` is the exact holding a durable
  // `worktree.changed`/`worktree.deleted` fact names, and every child view of
  // that same checkout sits underneath it and converges with it.
  worktrees: {
    all: ["worktrees", "status"] as const,
    owned: (topLevelTaskId: string) =>
      ["worktrees", "status", topLevelTaskId] as const,
    status: (
      topLevelTaskId: string,
      taskId: string,
      moduleId?: string | null,
    ) =>
      [
        "worktrees",
        "status",
        topLevelTaskId,
        { taskId, moduleId: moduleId ?? null },
      ] as const,
  },

  documents: {
    registry: (
      scope: "task" | "scratch",
      ownerId: string,
      projectId?: string | null,
      moduleId?: string | null,
    ) => [
      "documents",
      "registry",
      scope,
      ownerId,
      { projectId: projectId ?? null, moduleId: moduleId ?? null },
    ] as const,
  },

  terminalSessions: {
    persisted: (taskId: string) =>
      ["terminal-sessions", "persisted", taskId] as const,
    scratch: (projectId: string, moduleId?: string | null) =>
      ["terminal-sessions", "scratch", projectId, moduleId ?? null] as const,
    resumable: (
      taskId?: string | null,
      projectId?: string | null,
      moduleId?: string | null,
    ) => [
      "terminal-sessions",
      "resumable",
      {
        taskId: taskId ?? null,
        projectId: projectId ?? null,
        moduleId: moduleId ?? null,
      },
    ] as const,
  },
} as const;
