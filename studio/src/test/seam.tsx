import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach } from "vitest";
import { TasksPane } from "../app/shell/ticket-workspace/tasks/TasksPane";
import { SelectedTicketDetails } from "../app/shell/ticket-workspace/selected-ticket/details/SelectedTicketDetails";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import type { RunRecord } from "../features/agents/status/types";
import type { DesignDoc } from "../features/agents/types";
import { useStudioStore } from "../features/projects/store";
import { loadModules } from "../features/projects/queries";
import { loadModuleTree } from "../features/work-items/queries";
import type {
  Attachment,
  IssueType,
  ModuleTree,
  State,
  WorkItem,
} from "../shared/api/types";
import { StudioApolloProvider } from "../shared/apollo/StudioApolloProvider";
import { useClientStore } from "../state/clientStore";
import { rankBetween } from "../features/work-items/utilities/rank";
import {
  documentOperationName,
  type TypedDocumentNode,
} from "../graphql-foundation/typedDocument";
import { FoundationGraphQlError } from "../shared/apollo/errorLink";
import { createBrowserRuntime, initializeStudioRuntime } from "../runtime";
import { compactWorktrackerId } from "../shared/api/generatedWorktracker";
import { studioApolloClient } from "../shared/apollo/client";
import {
  WorkTrackerModuleOpenDocument,
  WorkTrackerWorkItemDocument,
} from "../features/work-items/generated/workItems.documents";
import { WorkTrackerProjectOpenDocument } from "../features/projects/generated/projects.documents";

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
  /** Refuses the next Run Now mutation only, leaving other requests untouched. */
  failNextRunNow(status: number, body?: unknown): void;
  /** Holds Run Now responses until the returned release is called. */
  holdRunNow(): () => void;
  setRunNowTransitionEnabled(enabled: boolean): void;
  refreshRunNowCapabilities(issueTypeId: string): Promise<void>;
  /** Fails the next graph-run POST only, leaving other requests untouched. */
  failNextGraphRun(status: number, body?: unknown): void;
  /**
   * Accepts the next graph-run POST but launches nothing, modelling a press on
   * a subtree with no startable work. Other graph runs keep launching the
   * root's children.
   */
  nextGraphRunLaunchesNothing(): void;
  /** Holds graph-run responses until the returned release is called. */
  holdGraphRuns(): () => void;
  setSubtreeRunEnabled(enabled: boolean): void;
  executeGraphQl<TResult, TVariables>(
    document: TypedDocumentNode<TResult, TVariables>,
    variables: TVariables,
  ): Promise<TResult>;
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
  private graphRunInertPresses = 0;
  private graphRunGate: Promise<void> | null = null;
  private readonly armedGraphRuns = new Set<string>();
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
    const client = studioApolloClient();
    void client.query({
      query: WorkTrackerWorkItemDocument,
      variables: { id: compactWorktrackerId(id) },
      fetchPolicy: "network-only",
    });
    if (membershipChanged) {
      void client.refetchQueries({ include: [WorkTrackerModuleOpenDocument] });
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
    void issueTypeId;
    await studioApolloClient().query({
      query: WorkTrackerProjectOpenDocument,
      variables: { projectId: compactWorktrackerId(this.projectId()) },
      fetchPolicy: "network-only",
    });
  }

  failNextGraphRun(status: number, body: unknown = null): void {
    this.graphRunFailures.push({ status, body });
  }

  nextGraphRunLaunchesNothing(): void {
    this.graphRunInertPresses += 1;
  }

  /** The work items an ordinary press on `id` reports as launched. */
  private launchableChildren(id: string): string[] {
    for (const tree of this.trees.values()) {
      const children = tree.children[id];
      if (children?.length) return [...children];
    }
    return [];
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

  async executeGraphQl<TResult, TVariables>(
    document: TypedDocumentNode<TResult, TVariables>,
    variables: TVariables,
  ): Promise<TResult> {
    const input = variables as {
      rootId?: string;
      executionMode?: string | null;
      idOrKey?: string;
      id?: string;
      ids?: string[];
      moduleId?: string;
      projectId?: string;
      issueTypeId?: string;
      issueId?: string;
      targetStateId?: string;
      parentId?: string | null;
      blockedByIds?: string[];
      beforeId?: string | null;
      afterId?: string | null;
      projectSlug?: string;
      sequenceId?: number;
    };
    const fixtureKey = <T,>(rows: Map<string, T>, id: string | null | undefined) =>
      id == null
        ? undefined
        : [...rows.keys()].find((key) =>
          key === id || compactWorktrackerId(key) === compactWorktrackerId(id),
        );
    const fixtureItem = (id: string | null | undefined) => {
      const key = fixtureKey(this.items, id);
      return key ? this.items.get(key) : undefined;
    };
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      const body = failure.body && typeof failure.body === "object"
        ? failure.body as Record<string, unknown>
        : {};
      throw new FoundationGraphQlError(
        failure.status === 409 ? "conflict" : "unknown",
        typeof body.detail === "string" ? body.detail : "GraphQL request failed.",
      );
    }
    const issueRow = (item: WorkItem) => {
      const moduleId = [...this.trees].find(([, tree]) => tree.order.includes(item.id))?.[0] ?? null;
      return {
        __typename: "WorktrackerIssue",
        ...item,
        workspace_tab_order: [],
        state_id: item.state,
        issue_type_id: item.issue_type,
        module_id: moduleId,
        project: {
          __typename: "WorktrackerProject",
          id: this.projectId(),
          slug: item.key.split("-")[0] ?? "PROJECT",
        },
        state_record: item.state ? {
          __typename: "WorktrackerState",
          ...this.states.get(item.state),
          id: item.state,
          sort_order: this.states.get(item.state)?.sort_order ?? 0,
          is_protected: this.states.get(item.state)?.is_protected ?? false,
        } : null,
        issue_type_record: {
          __typename: "WorktrackerIssuetype",
          ...this.issueTypes.get(item.issue_type),
          id: item.issue_type,
          sort_order: this.issueTypes.get(item.issue_type)?.sort_order ?? 0,
        },
        children: { __typename: "WorktrackerIssueConnection", nodes: [...this.items.values()].filter((child) => child.parent_id === item.id).map((child) => ({ __typename: "WorktrackerIssue", id: child.id, is_archived: child.is_archived })) },
        blocked_by_edges: {
          __typename: "WorktrackerIssueBlockedByConnection",
          nodes: item.blocked_by_ids.map((id) => ({
            __typename: "WorktrackerIssueBlockedByEdge",
            to_issue_id: id,
          })),
        },
        blocks_edges: {
          __typename: "WorktrackerIssueBlockedByConnection",
          nodes: item.blocks_ids.map((id) => ({
            __typename: "WorktrackerIssueBlockedByEdge",
            from_issue_id: id,
          })),
        },
      };
    };
    const createdAt = "2026-08-06T12:00:00Z";
    const stateRows = () => [...this.states.values()].map((state) => ({
      __typename: "WorktrackerState",
      ...state,
      project: this.projectId(),
      sort_order: state.sort_order ?? 0,
      is_protected: state.is_protected ?? false,
      created_at: createdAt,
      updated_at: createdAt,
    }));
    const issueTypeRows = () => [...this.issueTypes.values()].map((type) => {
      const ideas = [...this.states.values()].find((state) => state.name === "Ideas");
      const implement = [...this.states.values()].find((state) => state.name === "Implement");
      const transitions = this.runNowTransitionEnabled && ideas?.id && implement?.id
        ? [{
            __typename: "WorktrackerIssuetypetransition",
            id: 1,
            issue_type: type.id,
            from_state: ideas.id,
            to_state: implement.id,
            agent_allowed: true,
            fromState: { __typename: "WorktrackerState", id: ideas.id, sort_order: ideas.sort_order ?? 0 },
            toState: { __typename: "WorktrackerState", id: implement.id, sort_order: implement.sort_order ?? 0 },
          }]
        : [];
      const bindings = [...this.items.values()].flatMap((item, index) =>
        item.issue_type === type.id && item.state ? [{
          __typename: "WorktrackerLaunchbinding",
          id: index + 1,
          issue_type: type.id,
          state: item.state,
          prompt: null,
          required_skills: [],
          model: null,
          reasoning: null,
          auto_start: false,
          subtree_run_enabled: this.subtreeRunEnabled,
          created_at: createdAt,
          updated_at: createdAt,
          state_record: { __typename: "WorktrackerState", id: item.state, sort_order: this.states.get(item.state)?.sort_order ?? 0 },
        }] : [],
      );
      return {
        __typename: "WorktrackerIssuetype",
        ...type,
        project: type.project ?? this.projectId(),
        start_state: type.start_state ?? null,
        workflow_revision: type.workflow_revision ?? 1,
        is_pathfind: false,
        created_at: createdAt,
        updated_at: createdAt,
        transitions: { __typename: "WorktrackerIssuetypetransitionConnection", nodes: transitions },
        launch_bindings: { __typename: "WorktrackerLaunchbindingConnection", nodes: bindings },
      };
    });
    const moduleRows = () => [...this.trees.keys()].map((id, index) => ({
      __typename: "WorktrackerIssue",
      id,
      name: `Module ${index + 1}`,
      project_id: this.projectId(),
      sequence_id: index + 1,
      is_archived: false,
      issue_type: "module",
      rank: String(index),
      project: { __typename: "WorktrackerProject", id: this.projectId(), slug: "T" },
    }));
    const providerCatalog = {
      __typename: "WorktrackerProviderCatalog",
      configurable_providers: [],
      providers: [],
      agent_models: [],
      reasoning_levels: [],
      global_default: null,
    };
    if (documentOperationName(document) === "WorkTrackerModuleOpen") {
      const moduleKey = fixtureKey(this.trees, input.moduleId);
      const ids = moduleKey ? [...(this.trees.get(moduleKey)?.order ?? [])].sort((leftId, rightId) => {
        const left = this.items.get(leftId);
        const right = this.items.get(rightId);
        return (left?.rank ?? "").localeCompare(right?.rank ?? "")
          || (left?.sequence_id ?? 0) - (right?.sequence_id ?? 0)
          || leftId.localeCompare(rightId);
      }) : [];
      return {
        module: { __typename: "WorktrackerIssueConnection", nodes: moduleRows().filter((row) => fixtureKey(this.trees, row.id) === moduleKey) },
        work_items: { __typename: "WorktrackerIssueConnection", nodes: ids.flatMap((id) => this.items.has(id) ? [issueRow(this.items.get(id)!)] : []) },
      } as TResult;
    }
    if (documentOperationName(document) === "WorkTrackerProjectOpen") {
      return {
        project: { __typename: "WorktrackerProjectConnection", nodes: [{
          __typename: "WorktrackerProject",
          id: this.projectId(), name: "Project", slug: "project", description: "",
          created_at: createdAt,
        }] },
        modules: { __typename: "WorktrackerIssueConnection", nodes: moduleRows() },
        module_presentations: {
          __typename: "WorktrackerModulepresentationConnection",
          nodes: [],
        },
        states: { __typename: "WorktrackerStateConnection", nodes: stateRows() },
        issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: issueTypeRows() },
        provider_catalog: providerCatalog,
      } as TResult;
    }
    if (documentOperationName(document) === "WorkTrackerProjectStates") {
      return { states: { __typename: "WorktrackerStateConnection", nodes: stateRows() } } as TResult;
    }
    if (documentOperationName(document) === "WorkTrackerProjectIssueTypes") {
      return { issue_types: { __typename: "WorktrackerIssuetypeConnection", nodes: issueTypeRows() } } as TResult;
    }
    if (documentOperationName(document) === "WorkTrackerProjects") {
      return {
        projects: { __typename: "WorktrackerProjectConnection", nodes: [{
          __typename: "WorktrackerProject", id: this.projectId(), name: "Project",
          slug: "project", description: "", created_at: createdAt,
        }] },
        module_presentations: {
          __typename: "WorktrackerModulepresentationConnection",
          nodes: [],
        },
      } as TResult;
    }
    if (documentOperationName(document) === "LoadProviderCatalog") {
      return { provider_catalog: providerCatalog } as TResult;
    }
    if (documentOperationName(document) === "WorkTrackerWorkItems") {
      return { work_items: { nodes: [...this.items.values()].map(issueRow) } } as TResult;
    }
    if (documentOperationName(document) === "WorkTrackerWorkItem") {
      const item = fixtureItem(input.id);
      return { work_item: { nodes: item ? [issueRow(item)] : [] } } as TResult;
    }
    if (documentOperationName(document) === "WorkTrackerWorkItemByKey") {
      const item = [...this.items.values()].find((candidate) =>
        candidate.sequence_id === input.sequenceId
        && candidate.key.split("-")[0]?.toUpperCase() === input.projectSlug,
      );
      return { work_item: { nodes: item ? [issueRow(item)] : [] } } as TResult;
    }
    if (documentOperationName(document) === "WorkTrackerAttachments") {
      const issueKey = fixtureKey(this.attachmentRows, input.issueId);
      return { attachments: { __typename: "WorktrackerAttachmentConnection", nodes: (issueKey ? this.attachmentRows.get(issueKey) ?? [] : []).map((attachment) => ({
        __typename: "WorktrackerAttachment",
        id: attachment.id, issue_id: attachment.issue, file: attachment.url,
        filename: attachment.filename, mime_type: attachment.mime_type,
        size: attachment.size, created_at: attachment.created_at,
      })) } } as TResult;
    }
    if (["UpdateWorkTrackerWorkItem", "TransitionWorkTrackerWorkItem", "ReparentWorkTrackerWorkItem", "SetWorkTrackerBlockers"].includes(documentOperationName(document))) {
      const id = fixtureKey(this.items, input.id) ?? input.id!;
      const current = fixtureItem(id);
      if (!current) throw new FoundationGraphQlError("not_found", "Not found");
      const submitted = variables as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      if (submitted.name !== undefined) body.name = submitted.name;
      if (submitted.description !== undefined) body.description = submitted.description;
      if (submitted.issueTypeId !== undefined) body.issue_type_id = submitted.issueTypeId;
      if (submitted.targetStateId !== undefined) {
        body.state_id = fixtureKey(this.states, submitted.targetStateId as string)
          ?? submitted.targetStateId;
        body.origin = "human";
      }
      if (submitted.parentId !== undefined) {
        body.parent_id = fixtureKey(this.items, submitted.parentId as string | null)
          ?? submitted.parentId;
      }
      if (submitted.blockedByIds !== undefined) {
        body.blocked_by_ids = (submitted.blockedByIds as string[]).map((candidate) =>
          fixtureKey(this.items, candidate) ?? candidate,
        );
      }
      const updated: WorkItem = {
        ...current,
        ...body,
        state: (body.state_id as string | undefined) ?? current.state,
        issue_type: (body.issue_type_id as string | undefined) ?? current.issue_type,
        parent_id: body.parent_id === undefined ? current.parent_id : body.parent_id as string | null,
        blocked_by_ids: (body.blocked_by_ids as string[] | undefined) ?? current.blocked_by_ids,
        rank: body.state_id === undefined ? current.rank : this.transitionRanks.get(id) ?? current.rank,
      };
      this.items.set(id, updated);
      this.patches.push({ id, body });
      for (const waiter of this.patchWaiters.splice(0)) {
        if (waiter.id === id && deepEqual(waiter.body, body)) waiter.resolve(); else this.patchWaiters.push(waiter);
      }
      return { update_work_item: issueRow(updated) } as TResult;
    }
    if (documentOperationName(document) === "ReorderWorkTrackerWorkItem") {
      const id = fixtureKey(this.items, input.id) ?? input.id!;
      const current = this.items.get(id);
      if (!current) throw new FoundationGraphQlError("not_found", "Not found");
      const body = {
        before_id: fixtureKey(this.items, input.beforeId) ?? null,
        after_id: fixtureKey(this.items, input.afterId) ?? null,
      };
      const updated = { ...current, rank: rankBetween(body.before_id ? this.items.get(body.before_id)?.rank ?? null : null, body.after_id ? this.items.get(body.after_id)?.rank ?? null : null) };
      this.items.set(updated.id, updated);
      this.reorders.push({ id: updated.id, body });
      for (const waiter of this.reorderWaiters.splice(0)) {
        if (waiter.id === updated.id && deepEqual(waiter.body, body)) waiter.resolve(); else this.reorderWaiters.push(waiter);
      }
      return { reorder_work_item: issueRow(updated) } as TResult;
    }
    if (documentOperationName(document) === "RunWorkTrackerWorkItemNow") {
      const id = input.idOrKey;
      if (!id) throw new Error("RunWorkTrackerWorkItemNow requires idOrKey.");
      this.runNowCalls.push({ id });
      const failure = this.runNowFailures.shift();
      if (this.runNowGate) await this.runNowGate;
      if (failure) {
        const body = failure.body && typeof failure.body === "object"
          ? failure.body as Record<string, unknown>
          : {};
        return {
          run_now: {
            target_id: body.target_id ?? id,
            committed_state: body.committed_state ?? null,
            run: null,
            detail: body.detail ?? "Run Now could not be started.",
            code: body.code ?? "run_now_unavailable",
            remedy: body.remedy ?? null,
          },
        } as TResult;
      }
      const current = this.items.get(id);
      const implement = [...this.states.values()].find(
        (state) => state.name === "Implement",
      );
      if (!current || !implement?.id) {
        return {
          run_now: {
            target_id: id,
            committed_state: null,
            run: null,
            detail: "The work item was not found.",
            code: "task_not_found",
            remedy: null,
          },
        } as TResult;
      }
      this.items.set(current.id, { ...current, state: implement.id });
      return {
        run_now: {
          target_id: id,
          committed_state: { id: implement.id, name: implement.name },
          run: {
            target_id: id,
            agent: "codex",
            agent_run_id: `run-now-${id}`,
          },
          detail: "Run Now started.",
          code: "run_now_started",
          remedy: null,
        },
      } as TResult;
    }
    const id = fixtureKey(this.items, input.rootId) ?? input.rootId;
    if (!id) throw new Error(`${documentOperationName(document)} requires rootId.`);
    if (documentOperationName(document) === "ExecutionGraphRunHolding") {
      return {
        graph_run_holding: {
          nodes: this.armedGraphRuns.has(id)
            ? [{ root_id: id, execution_mode: "parallel" }]
            : [],
        },
      } as TResult;
    }
    if (
      documentOperationName(document) !== "CreateExecutionGraphRun" &&
      documentOperationName(document) !== "UpdateExecutionGraphRun"
    ) {
      throw new Error(`Unexpected GraphQL operation ${documentOperationName(document)}.`);
    }
    this.graphRuns.push({ id, mode: input.executionMode ?? null });
    const failure = this.graphRunFailures.shift();
    const inert = this.graphRunInertPresses > 0;
    if (inert) this.graphRunInertPresses -= 1;
    if (this.graphRunGate) await this.graphRunGate;
    if (failure) {
      const body = failure.body && typeof failure.body === "object"
        ? failure.body as Record<string, unknown>
        : {};
      const code = typeof body.error === "string"
        ? body.error
        : failure.status === 409
          ? "conflict"
          : "unknown";
      const message = typeof body.detail === "string"
        ? body.detail
        : "The Graph Run operation could not be completed.";
      throw new FoundationGraphQlError(code as "conflict", message);
    }
    this.armedGraphRuns.add(id);
    return {
      graph_run_result: {
        graph_run: {
          root_id: id,
          execution_mode: input.executionMode ?? "parallel",
        },
        launched: inert ? [] : this.launchableChildren(id),
      },
    } as TResult;
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
      const inert = this.graphRunInertPresses > 0;
      if (inert) this.graphRunInertPresses -= 1;
      if (this.graphRunGate) await this.graphRunGate;
      if (failure) return json(failure.body, failure.status);
      // An ordinary press launches the root's startable children; an inert
      // press is accepted and launches nothing.
      const launched = inert ? [] : this.launchableChildren(id);
      return json({ root_id: id, launched }, 201);
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
    <StudioApolloProvider>
        <div>
          <section role="region" aria-label="Stories">
            <TasksPane />
          </section>
          <section role="region" aria-label="Details">
            <SelectedTicketDetails />
          </section>
          {children}
        </div>
    </StudioApolloProvider>
  );
}

function fixtureGraphQlTransport(execute: HttpFixture["executeGraphQl"]) {
  return () => ({
    graphql_execute: async (requestJson: string) => {
      const request = JSON.parse(requestJson) as {
        query: string;
        operationName: string;
        variables: Record<string, unknown>;
      };
      try {
        const data = await execute(
          {
            kind: "Document",
            operationName: request.operationName,
            source: request.query,
          },
          request.variables,
        );
        return JSON.stringify({ data });
      } catch (error) {
        if (!(error instanceof FoundationGraphQlError)) throw error;
        return JSON.stringify({
          data: null,
          errors: [{
            message: error.message,
            extensions: { ...error.extensions, code: error.code },
          }],
        });
      }
    },
    graphql_subscribe: async () => {
      throw new Error("not used by the acceptance fixture");
    },
    graphql_unsubscribe: async () => false,
  });
}

export function mountStudio({
  http,
  selectedTaskId = null,
  children,
  graphQlExecution = true,
  graphQlExecute,
}: {
  http: HttpFixture;
  route?: string;
  selectedTaskId?: string | null;
  children?: ReactNode;
  graphQlExecution?: boolean;
  graphQlExecute?: typeof http.executeGraphQl;
}): RenderResult {
  if (!(http instanceof BoundaryFixture)) {
    throw new Error("mountStudio requires the HTTP fixture returned by fixture().");
  }
  const previousFetch = globalThis.fetch;
  globalThis.fetch = http.fetch.bind(http);
  restoreFetch = () => {
    globalThis.fetch = previousFetch;
  };
  if (graphQlExecution) {
    const browser = createBrowserRuntime({ environment: {} });
    const execute = graphQlExecute ?? http.executeGraphQl.bind(http);
    initializeStudioRuntime({
      ...browser,
      graphQlTransport: fixtureGraphQlTransport(execute),
      readWorkTracker: (routes) => routes.graphQl(execute),
      writeWorkTracker: (routes) => routes.graphQl(execute),
      readSettings: (routes) => routes.graphQl(execute),
      writeSettings: (routes) => routes.graphQl(execute),
    });
  }

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
  void Promise.all([
    loadModules(http.projectId()),
    loadModuleTree(http.projectId(), http.firstModuleId()),
  ]);

  return render(<StudioBehaviourSurface>{children}</StudioBehaviourSurface>);
}

afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  initializeStudioRuntime(createBrowserRuntime({ environment: {} }));
});
