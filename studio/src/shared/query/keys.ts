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

  modulePresentations: {
    all: ["module-presentations"] as const,
  },

  moduleLinks: {
    all: ["module-links"] as const,
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

  workspaceTabs: {
    byWorkItem: (id: string) => ["workItem", id, "workspace-tab-order"] as const,
  },

  onboarding: ["onboarding"] as const,

  workflows: {
    byProject: (projectId: string) =>
      ["workflows", "project", projectId] as const,
    byIssueType: (issueTypeId: string) =>
      ["workflows", "issue-type", issueTypeId] as const,
    transitionsByIssueType: (issueTypeId: string) =>
      ["workflows", "issue-type", issueTypeId, "transitions"] as const,
    stateCounts: (projectId: string) =>
      ["workflows", "state-counts", projectId] as const,
  },

  providers: {
    catalog: ["providers", "catalog"] as const,
    capabilities: ["providers", "capabilities"] as const,
  },

  worktrees: {
    all: ["worktrees"] as const,
    records: (moduleId: string) => ["worktrees", "records", moduleId] as const,
    byTask: (taskId: string) => ["worktrees", taskId] as const,
    status: (taskId: string, parentId?: string | null, moduleId?: string | null) =>
      [...queryKeys.worktrees.byTask(taskId), { parentId: parentId ?? null, moduleId: moduleId ?? null }] as const,
  },

  // Source-control review reads. The checkout kind is part of every key, so a
  // module base checkout and a task worktree can never serve each other's
  // cached answer. Invalidating a checkout's `changes` key is the single
  // refresh point every commit/push mutation has to hit; the per-file diffs
  // hang off it so one invalidation clears both.
  sourceControl: {
    worktreeChanges: (
      taskId: string,
      parentId?: string | null,
      moduleId?: string | null,
    ) =>
      [
        "source-control",
        "changes",
        "worktree",
        taskId,
        { parentId: parentId ?? null, moduleId: moduleId ?? null },
      ] as const,
    worktreeFileDiff: (
      taskId: string,
      path: string,
      parentId?: string | null,
      moduleId?: string | null,
    ) =>
      [
        ...queryKeys.sourceControl.worktreeChanges(taskId, parentId, moduleId),
        "file-diff",
        path,
      ] as const,
    worktreePushPreview: (
      taskId: string,
      parentId?: string | null,
      moduleId?: string | null,
    ) =>
      [
        ...queryKeys.sourceControl.worktreeChanges(taskId, parentId, moduleId),
        "push-preview",
      ] as const,
    moduleChanges: (moduleId: string) =>
      ["source-control", "changes", "module", moduleId] as const,
    moduleFileDiff: (moduleId: string, path: string) =>
      [
        ...queryKeys.sourceControl.moduleChanges(moduleId),
        "file-diff",
        path,
      ] as const,
    modulePushPreview: (moduleId: string) =>
      [
        ...queryKeys.sourceControl.moduleChanges(moduleId),
        "push-preview",
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
