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
  Attachment,
  IssueType,
  ModuleTree,
  State,
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
  attachments(issueId: string, attachments: Attachment[]): void;
  transitionRank(id: string, rank: string): void;
  expectPatch(id: string, body: unknown): Promise<void>;
  expectReorder(
    id: string,
    body: { before_id: string | null; after_id: string | null },
  ): Promise<void>;
  graphRunCount(id: string): number;
  graphRunModes(id: string): Array<string | null>;
  runNowCount(id: string): number;
  /** Fails the next Run Now POST only, leaving other requests untouched. */
  failNextRunNow(status: number, body?: unknown): void;
  /** Holds Run Now responses until the returned release is called. */
  holdRunNow(): () => void;
  setRunNowTransitionEnabled(enabled: boolean): void;
  refreshRunNowCapabilities(issueTypeId: string): Promise<void>;
  /** Fails the next graph-run POST only, leaving other requests untouched. */
  failNextGraphRun(status: number, body?: unknown): void;
  /** Holds graph-run responses until the returned release is called. */
  holdGraphRuns(): () => void;
  setSubtreeRunEnabled(enabled: boolean): void;
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

interface GraphRunCall {
  id: string;
  /** The requested execution mode, or null when the caller omitted it. */
  mode: string | null;
}

interface RunNowCall {
  id: string;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

class BoundaryFixture implements StudioFixture {
  readonly trees = new Map<string, ModuleTree>();
  readonly items = new Map<string, WorkItem>();
  readonly states = new Map<string, State>();
  readonly issueTypes = new Map<string, IssueType>();
  readonly runRows = new Map<string, RunRecord[]>();
  readonly documentRows = new Map<string, DesignDoc[]>();
  readonly attachmentRows = new Map<string, Attachment[]>();
  readonly patches: PatchCall[] = [];
  readonly reorders: ReorderCall[] = [];
  readonly graphRuns: GraphRunCall[] = [];
  readonly runNowCalls: RunNowCall[] = [];
  private graphRunFailures: Array<{ status: number; body: unknown }> = [];
  private graphRunGate: Promise<void> | null = null;
  private runNowFailures: Array<{ status: number; body: unknown }> = [];
  private runNowGate: Promise<void> | null = null;
  private subtreeRunEnabled = true;
  private runNowTransitionEnabled = true;
  private readonly transitionRanks = new Map<string, string>();
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
    for (const item of items as FixtureWorkItem[]) {
      if (item.__state?.id) this.states.set(item.__state.id, item.__state);
      if (item.__issueType) this.issueTypes.set(item.__issueType.id, item.__issueType);
      const { __state: _state, __issueType: _issueType, ...record } = item;
      this.items.set(item.id, record);
    }
  }

  runs(issueId: string, runs: RunRecord[]): void {
    this.runRows.set(issueId, runs);
  }

  documents(issueId: string, docs: DesignDoc[]): void {
    this.documentRows.set(issueId, docs);
  }

  attachments(issueId: string, attachments: Attachment[]): void {
    this.attachmentRows.set(issueId, attachments);
  }

  transitionRank(id: string, rank: string): void {
    this.transitionRanks.set(id, rank);
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

  graphRunCount(id: string): number {
    return this.graphRuns.filter((candidate) => candidate.id === id).length;
  }

  graphRunModes(id: string): Array<string | null> {
    return this.graphRuns
      .filter((candidate) => candidate.id === id)
      .map((candidate) => candidate.mode);
  }

  runNowCount(id: string): number {
    return this.runNowCalls.filter((candidate) => candidate.id === id).length;
  }

  failNextRunNow(status: number, body: unknown = null): void {
    this.runNowFailures.push({ status, body });
  }

  holdRunNow(): () => void {
    let release = (): void => {};
    this.runNowGate = new Promise<void>((resolve) => {
      release = () => {
        this.runNowGate = null;
        resolve();
      };
    });
    return release;
  }

  setRunNowTransitionEnabled(enabled: boolean): void {
    this.runNowTransitionEnabled = enabled;
  }

  async refreshRunNowCapabilities(issueTypeId: string): Promise<void> {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.workflows.transitionsByIssueType(issueTypeId),
      exact: true,
    });
  }

  failNextGraphRun(status: number, body: unknown = null): void {
    this.graphRunFailures.push({ status, body });
  }

  holdGraphRuns(): () => void {
    let release = (): void => {};
    this.graphRunGate = new Promise<void>((resolve) => {
      release = () => {
        this.graphRunGate = null;
        resolve();
      };
    });
    return release;
  }

  setSubtreeRunEnabled(enabled: boolean): void {
    this.subtreeRunEnabled = enabled;
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
      return json([
        {
          id: this.projectId(),
          name: "Project",
          slug: "project",
          manual_module_order: false,
        },
      ]);
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
      return json([...this.states.values()]);
    }
    if (
      method === "GET" &&
      /\/work-tracker\/projects\/[^/]+\/issue-types$/.test(path)
    ) {
      return json([...this.issueTypes.values()]);
    }
    const transitionCollectionMatch = path.match(
      /\/work-tracker\/issue-types\/([^/]+)\/transitions$/,
    );
    if (method === "GET" && transitionCollectionMatch) {
      const issueTypeId = decodeURIComponent(transitionCollectionMatch[1]);
      const ideas = [...this.states.values()].find((state) => state.name === "Ideas");
      const implement = [...this.states.values()].find((state) => state.name === "Implement");
      return json(
        this.runNowTransitionEnabled && ideas?.id && implement?.id
          ? [{
              id: 1,
              issue_type: issueTypeId,
              from_state: ideas.id,
              to_state: implement.id,
              agent_allowed: true,
              workflow_revision: 1,
            }]
          : [],
      );
    }
    if (
      method === "GET" &&
      /\/work-tracker\/projects\/[^/]+\/launch-bindings$/.test(path)
    ) {
      const bindings = new Map<string, unknown>();
      for (const item of this.items.values()) {
        if (!item.issue_type || !item.state) continue;
        const key = `${item.issue_type}:${item.state}`;
        bindings.set(key, {
          id: bindings.size + 1,
          issue_type: item.issue_type,
          state: item.state,
          subtree_run_enabled: this.subtreeRunEnabled,
          workflow_revision: 1,
          created_at: "2026-08-08T10:00:00Z",
          updated_at: "2026-08-08T10:00:00Z",
        });
      }
      return json([...bindings.values()]);
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
    const graphRunMatch = path.match(
      /\/work-tracker\/work-items\/([^/]+)\/graph-run$/,
    );
    if (method === "POST" && graphRunMatch) {
      const id = decodeURIComponent(graphRunMatch[1]);
      const body = await requestBody(request, init) as { mode?: string };
      this.graphRuns.push({ id, mode: body.mode ?? null });
      const failure = this.graphRunFailures.shift();
      if (this.graphRunGate) await this.graphRunGate;
      if (failure) return json(failure.body, failure.status);
      return json({ root_id: id, launched: [] }, 201);
    }
    const runNowMatch = path.match(
      /\/work-tracker\/work-items\/([^/]+)\/run-now$/,
    );
    if (method === "POST" && runNowMatch) {
      const id = decodeURIComponent(runNowMatch[1]);
      this.runNowCalls.push({ id });
      const failure = this.runNowFailures.shift();
      if (this.runNowGate) await this.runNowGate;
      if (failure) return json(failure.body, failure.status);
      const current = this.items.get(id);
      const implement = [...this.states.values()].find((state) => state.name === "Implement");
      if (!current || !implement?.id) return json({ detail: "Not found" }, 404);
      this.items.set(id, { ...current, state: implement.id });
      return json({
        target_id: id,
        committed_state: { id: implement.id, name: implement.name },
        run: {
          target_id: id,
          agent: "codex",
          agent_run_id: `run-now-${id}`,
        },
      }, 201);
    }
    const attachmentMatch = path.match(
      /\/work-tracker\/work-items\/([^/]+)\/attachments$/,
    );
    if (method === "GET" && attachmentMatch) {
      const id = decodeURIComponent(attachmentMatch[1]);
      return json(this.attachmentRows.get(id) ?? []);
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
      const state = body.state_id ?? current.state;
      const issueType = body.issue_type_id ?? current.issue_type;
      const updated = {
        ...current,
        ...body,
        state,
        issue_type: issueType,
        rank: body.state_id === undefined
          ? current.rank
          : this.transitionRanks.get(id) ?? current.rank,
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

type FixtureWorkItem = WorkItem & {
  __state?: State;
  __issueType?: IssueType;
};

type WorkItemOverrides = Partial<Omit<WorkItem, "state" | "issue_type">> & {
  state?: string | null | State;
  issue_type?: string | IssueType;
};

export function workItem(overrides: WorkItemOverrides = {}): FixtureWorkItem {
  const defaultState: State = {
    id: "state-1",
    name: "Ideas",
    group: "backlog",
    color: null,
  };
  const defaultIssueType: IssueType = {
    id: "story",
    name: "Story",
    level: "task",
    color: null,
    sort_order: 1,
  };
  const state = overrides.state === undefined ? defaultState : overrides.state;
  const issueType = overrides.issue_type === undefined
    ? defaultIssueType
    : overrides.issue_type;
  return {
    id: "story-1",
    name: "Story",
    project_id: "project-1",
    sequence_id: 1,
    state: typeof state === "string" || state === null ? state : state.id,
    state_revision: 1,
    description: "",
    parent_id: "module-1",
    sub_issues_count: 0,
    key: "MEML-1",
    is_archived: false,
    created_at: "2026-08-06T12:00:00Z",
    updated_at: "2026-08-06T12:00:00Z",
    rank: "a",
    issue_type: typeof issueType === "string" ? issueType : issueType.id,
    blocked_by_ids: [],
    blocks_ids: [],
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => key !== "state" && key !== "issue_type"),
    ),
    __state: typeof state === "object" && state !== null ? state : undefined,
    __issueType: typeof issueType === "object" ? issueType : undefined,
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

export function mountStudio({
  http,
  selectedTaskId = null,
  children,
}: {
  http: HttpFixture;
  route?: string;
  selectedTaskId?: string | null;
  children?: ReactNode;
}): RenderResult {
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
    selectedTaskId,
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

  return render(<StudioBehaviourSurface>{children}</StudioBehaviourSurface>);
}

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
});
