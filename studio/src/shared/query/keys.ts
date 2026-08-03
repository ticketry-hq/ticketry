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
    all: ["modules"] as const,
    byProject: (projectId: string) => ["modules", projectId] as const,
  },

  states: {
    all: ["states"] as const,
    byProject: (projectId: string) => ["states", projectId] as const,
  },

  issueTypes: {
    all: ["issue-types"] as const,
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
    all: ["work-items"] as const,
    detail: (id: string) => ["work-items", "detail", id] as const,
    children: (parentId: string) => ["work-items", "children", parentId] as const,
    byProject: (projectId: string) => ["work-items", "project", projectId] as const,
  },

  settings: {
    all: ["settings"] as const,
    byProject: (projectId: string) => ["settings", projectId] as const,
  },
} as const;
