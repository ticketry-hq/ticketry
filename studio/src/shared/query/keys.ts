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

  // The module task tree: summaries + states + subtask buckets in one payload
  // (mirrors api.getTasks).
  tasks: {
    all: ["tasks"] as const,
    byModule: (projectId: string, moduleId: string) =>
      ["tasks", projectId, moduleId] as const,
  },

  workItems: {
    index: ["work-items", "index"] as const,
    detail: (id: string) => ["work-items", "detail", id] as const,
    children: (parentId: string) => ["work-items", "children", parentId] as const,
    byProject: (projectId: string, filters: object = {}) =>
      ["work-items", "project", projectId, filters] as const,
  },

  workspace: ["workspace"] as const,

  workflows: {
    byProject: (projectId: string) =>
      ["workflows", "project", projectId] as const,
    byIssueType: (issueTypeId: string) =>
      ["workflows", "issue-type", issueTypeId] as const,
    stateImpact: (stateId: string) =>
      ["workflows", "state-impact", stateId] as const,
    stateCounts: (projectId: string) =>
      ["workflows", "state-counts", projectId] as const,
  },

  providers: {
    catalog: ["providers", "catalog"] as const,
    capabilities: ["providers", "capabilities"] as const,
  },

  worktrees: {
    status: (taskId: string, parentId?: string | null, moduleId?: string | null) =>
      ["worktrees", taskId, { parentId: parentId ?? null, moduleId: moduleId ?? null }] as const,
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
    content: (documentId: string, relativePath: string) =>
      ["documents", "content", documentId, relativePath] as const,
  },

  terminalSessions: {
    persistedIndex: ["terminal-sessions", "persisted-index"] as const,
    resumableIndex: ["terminal-sessions", "resumable-index"] as const,
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
      { taskId: taskId ?? null, projectId: projectId ?? null, moduleId: moduleId ?? null },
    ] as const,
  },

  agentStatus: {
    byProject: (projectId: string) => ["agent-status", projectId] as const,
  },
} as const;
