import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach } from "vitest";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { SelectedTicketDetails } from "../app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails";
import { useAgentStatusStore } from "../features/agents/status/store";
import type { RunRecord } from "../features/agents/status/types";
import type { DesignDoc } from "../features/agents/types";
import { useStudioStore } from "../features/projects/store";
import { loadModuleTree } from "../features/work-items/queries";
import type {
  ModuleTree,
  WorkItem,
} from "../shared/api/types";
import { queryClient } from "../shared/query/queryClient";
import { queryKeys } from "../shared/query/keys";
import { useClientStore } from "../state/clientStore";
import { rankBetween } from "../features/work-items/utilities/rank";

export interface HttpFixture {
  tree(moduleId: string, tree: ModuleTree): void;
  workItems(items: WorkItem[]): void;
  runs(issueId: string, runs: RunRecord[]): void;
  documents(issueId: string, docs: DesignDoc[]): void;
  expectPatch(id: string, body: unknown): Promise<void>;
  expectReorder(
    id: string,
    body: { before_id: string | null; after_id: string | null },
  ): Promise<void>;
  failNext(status: number, body?: unknown): void;
}

export interface FeedFixture {
  workItemChanged(id: string, revision: number, membershipChanged?: boolean): void;
  runLifecycle(runId: string, state: string, at: string): void;
  disconnect(): void;
  reconnect(): void;
}

export interface StudioFixture extends HttpFixture {
  readonly notifications: FeedFixture;
}

interface PatchCall {
  id: string;
  body: unknown;
}

interface ReorderCall {
  id: string;
  body: { before_id: string | null; after_id: string | null };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

class BoundaryFixture implements StudioFixture {
  readonly trees = new Map<string, ModuleTree>();
  readonly items = new Map<string, WorkItem>();
  readonly runRows = new Map<string, RunRecord[]>();
  readonly documentRows = new Map<string, DesignDoc[]>();
  readonly patches: PatchCall[] = [];
  readonly reorders: ReorderCall[] = [];
  private nextFailure: { status: number; body: unknown } | null = null;
  private patchWaiters: Array<{
    id: string;
    body: unknown;
    resolve: () => void;
  }> = [];
  private reorderWaiters: Array<{
    id: string;
    body: ReorderCall["body"];
    resolve: () => void;
  }> = [];
  private connected = true;
  private cursor = 0;
  private readonly missedWorkItemChanges = new Map<
    string,
    { revision: number; membershipChanged: boolean }
  >();

  private applyWorkItemChange(id: string, membershipChanged: boolean): void {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.workItems.byId(id),
      exact: true,
    });
    if (membershipChanged) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all });
    }
  }

  readonly notifications: FeedFixture = {
    workItemChanged: (id, revision, membershipChanged = false) => {
      if (revision <= this.cursor) return;
      this.cursor = revision;
      if (!this.connected) {
        this.missedWorkItemChanges.set(id, { revision, membershipChanged });
        return;
      }
      this.applyWorkItemChange(id, membershipChanged);
    },
    runLifecycle: (runId, state, at) => {
      if (!this.connected) return;
      const run = [...this.runRows.values()].flat().find(
        (candidate) => candidate.agent_run_id === runId,
      );
      if (!run) return;
      useAgentStatusStore.getState().upsertRun({
        ...run,
        state: state as RunRecord["state"],
        updated_at: at,
      });
    },
    disconnect: () => {
      this.connected = false;
    },
    reconnect: () => {
      this.connected = true;
      const replay = [...this.missedWorkItemChanges.entries()].sort(
        ([, left], [, right]) => left.revision - right.revision,
      );
      this.missedWorkItemChanges.clear();
      for (const [id, change] of replay) {
        this.applyWorkItemChange(id, change.membershipChanged);
      }
    },
  };

  tree(moduleId: string, tree: ModuleTree): void {
    this.trees.set(moduleId, tree);
  }

  workItems(items: WorkItem[]): void {
    for (const item of items) this.items.set(item.id, item);
  }

  runs(issueId: string, runs: RunRecord[]): void {
    this.runRows.set(issueId, runs);
  }

  documents(issueId: string, docs: DesignDoc[]): void {
    this.documentRows.set(issueId, docs);
  }

  expectPatch(id: string, body: unknown): Promise<void> {
    if (this.patches.some((call) => call.id === id && deepEqual(call.body, body))) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.patchWaiters.push({ id, body, resolve }));
  }

  expectReorder(id: string, body: ReorderCall["body"]): Promise<void> {
    if (this.reorders.some((call) => call.id === id && deepEqual(call.body, body))) {
      return Promise.resolve();
    }
    return new Promise((resolve) => this.reorderWaiters.push({ id, body, resolve }));
  }

  failNext(status: number, body: unknown = null): void {
    this.nextFailure = { status, body };
  }

  firstModuleId(): string {
    const moduleId = this.trees.keys().next().value;
    if (!moduleId) throw new Error("The Studio fixture needs a module tree.");
    return moduleId;
  }

  projectId(): string {
    return this.items.values().next().value?.project_id ?? "project-1";
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      return json(failure.body, failure.status);
    }
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), window.location.href);
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/\/$/, "");

    if (method === "GET" && path.endsWith("/work-tracker/projects")) {
      return json([{ id: this.projectId(), name: "Project", slug: "project" }]);
    }
    if (method === "GET" && /\/work-tracker\/projects\/[^/]+\/modules$/.test(path)) {
      return json([...this.trees.keys()].map((id, index) => ({
        id,
        name: `Module ${index + 1}`,
        project_id: this.projectId(),
        sequence_id: index + 1,
        key: `MODULE-${index + 1}`,
        is_archived: false,
        issue_type: "module",
      })));
    }
    if (method === "GET" && /\/work-tracker\/projects\/[^/]+\/states$/.test(path)) {
      const states = new Map<string, WorkItem["state"]>();
      for (const item of this.items.values()) {
        if (item.state?.id) states.set(item.state.id, item.state);
      }
      return json([...states.values()]);
    }
    if (method === "GET" && path.endsWith("/work-tracker/work-items")) {
      const moduleId = url.searchParams.get("module");
      const ids = moduleId ? this.trees.get(moduleId)?.order ?? [] : [...this.items.keys()];
      return json(ids.flatMap((id) => {
        const item = this.items.get(id);
        return item ? [item] : [];
      }));
    }
    if (method === "POST" && path.endsWith("/work-tracker/work-items/batch")) {
      const body = await requestBody(request, init) as { ids?: string[] };
      return json((body.ids ?? []).flatMap((id) => {
        const item = this.items.get(id);
        return item ? [item] : [];
      }));
    }
    const itemMatch = path.match(/\/work-tracker\/work-items\/([^/]+)$/);
    if (method === "PATCH" && itemMatch) {
      const id = decodeURIComponent(itemMatch[1]);
      const body = await requestBody(request, init) as Partial<WorkItem> & {
        state_id?: string;
        issue_type_id?: string;
      };
      const current = this.items.get(id);
      if (!current) return json({ detail: "Not found" }, 404);
      const state = body.state_id
        ? [...this.items.values()]
            .map((item) => item.state)
            .find((candidate) => candidate?.id === body.state_id) ?? current.state
        : current.state;
      const issueType = body.issue_type_id
        ? [...this.items.values()]
            .map((item) => item.issue_type)
            .find((candidate) => candidate?.id === body.issue_type_id) ?? current.issue_type
        : current.issue_type;
      const updated = {
        ...current,
        ...body,
        state,
        issue_type: issueType,
        parent_id: body.parent_id === undefined ? current.parent_id : body.parent_id,
      };
      this.items.set(id, updated);
      const call = { id, body };
      this.patches.push(call);
      for (const waiter of this.patchWaiters.splice(0)) {
        if (waiter.id === id && deepEqual(waiter.body, body)) waiter.resolve();
        else this.patchWaiters.push(waiter);
      }
      return json(updated);
    }
    const reorderMatch = path.match(/\/work-tracker\/work-items\/([^/]+)\/reorder$/);
    if (method === "POST" && reorderMatch) {
      const id = decodeURIComponent(reorderMatch[1]);
      const body = await requestBody(request, init) as ReorderCall["body"];
      const current = this.items.get(id);
      if (!current) return json({ detail: "Not found" }, 404);
      const beforeRank = body.before_id
        ? this.items.get(body.before_id)?.rank ?? null
        : null;
      const afterRank = body.after_id
        ? this.items.get(body.after_id)?.rank ?? null
        : null;
      const updated = { ...current, rank: rankBetween(beforeRank, afterRank) };
      this.items.set(id, updated);
      this.reorders.push({ id, body });
      for (const waiter of this.reorderWaiters.splice(0)) {
        if (waiter.id === id && deepEqual(waiter.body, body)) waiter.resolve();
        else this.reorderWaiters.push(waiter);
      }
      return json(updated);
    }

    return json([]);
  }
}

async function requestBody(request: Request | null, init?: RequestInit): Promise<unknown> {
  const body = init?.body ?? (request ? await request.clone().text() : null);
  if (typeof body !== "string") return body ?? {};
  return body ? JSON.parse(body) : {};
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

let restoreFetch: (() => void) | null = null;

export function fixture(): StudioFixture {
  return new BoundaryFixture();
}

export function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "story-1",
    name: "Story",
    project_id: "project-1",
    sequence_id: 1,
    state: { id: "state-1", name: "Idea", group: "backlog", color: null },
    state_revision: 1,
    description: "",
    parent_id: "module-1",
    sub_issues_count: 0,
    key: "MEML-1",
    is_archived: false,
    created_at: "2026-08-06T12:00:00Z",
    updated_at: "2026-08-06T12:00:00Z",
    rank: "a",
    issue_type: {
      id: "story",
      name: "Story",
      level: "task",
      color: null,
      sort_order: 1,
    },
    blocked_by_ids: [],
    blocks_ids: [],
    ...overrides,
  };
}

function StudioBehaviourSurface({ children }: { children?: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <div>
        <section role="region" aria-label="Stories">
          <TasksPane />
        </section>
        <section role="region" aria-label="Details">
          <SelectedTicketDetails />
        </section>
        {children}
      </div>
    </QueryClientProvider>
  );
}

export function mountStudio({ http }: { http: HttpFixture; route?: string }): RenderResult {
  if (!(http instanceof BoundaryFixture)) {
    throw new Error("mountStudio requires the HTTP fixture returned by fixture().");
  }
  const previousFetch = globalThis.fetch;
  globalThis.fetch = http.fetch.bind(http);
  restoreFetch = () => {
    globalThis.fetch = previousFetch;
  };

  queryClient.clear();
  useStudioStore.setState({
    selectedProjectId: http.projectId(),
    activeView: "backlog",
    error: null,
  });
  useClientStore.setState({
    selectedModuleId: http.firstModuleId(),
    selectedTaskId: null,
    workspaceSelection: { kind: "task" },
    storySearchQuery: "",
    expandedIdsByModule: {},
    collapsedStateIds: new Set(),
    toasts: [],
    dialogs: [],
  });
  useAgentStatusStore.setState({
    projectId: http.projectId(),
    runs: {},
    automationAttempts: {},
    automationByTask: {},
  });
  void loadModuleTree(http.projectId(), http.firstModuleId());

  return render(<StudioBehaviourSurface />);
}

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});
