// Per-task worktree host API (ticket #589), extracted from the former Studio request layer
// into a shared module (CODIN-922) so both the Studio SelectedTicketDetails and the
// Backlog issue workspace surface the same controls.
//
// gated: CODIN-668 — the host /api/worktrees surface is not in the SDK's
// OpenAPI. Routes are mounted at /api (not under /api/work-tracker) and use
// the same launch-scoped authentication as the rest of the host API. There is
// no integrate call by design — landing fires on Done server-side.

// Mirror of server WorktreeStatusOut. Discriminated on `kind`:
//   "worktree" — an active/conflict worktree (git fields populated, live),
//   "no_repo"  — no git repo encloses the task path (`reason` set),
//   "none"     — in a repo but no worktree yet (the Create button shows).
import { authenticatedHostFetch } from "../../../../shared/api/authenticatedHostFetch";

export interface WorktreeStatus {
  kind: "worktree" | "no_repo" | "none";
  task_id: string;
  top_level_task_id: string;
  is_shared: boolean;
  branch?: string | null;
  base_branch?: string | null;
  path?: string | null;
  state?: string | null;
  clean?: boolean | null;
  dirty?: boolean | null;
  ahead?: number | null;
  behind?: number | null;
  conflict?: boolean | null;
  ephemeral?: boolean;
  reason?: string | null;
}

export interface DiscardResult {
  removed: boolean;
  reason: string;
}

export interface WorktreeContext {
  parentId?: string | null;
  moduleId?: string | null;
  projectId?: string | null;
  ticketSeq?: number | null;
  taskName?: string | null;
}

async function hostRequest<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const resp = await authenticatedHostFetch(path, init);
  let body: unknown = null;
  const text = await resp.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!resp.ok) {
    const msg =
      body && typeof body === "object" && "message" in (body as object)
        ? String((body as { message?: string }).message)
        : `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return body as T;
}

function worktreeQuery(ctx: WorktreeContext): string {
  const params = new URLSearchParams();
  if (ctx.parentId) params.set("parent_id", ctx.parentId);
  if (ctx.moduleId) params.set("module_id", ctx.moduleId);
  const q = params.toString();
  return q ? `?${q}` : "";
}

export const getWorktree = (
  taskId: string,
  ctx: WorktreeContext,
  signal?: AbortSignal,
) => {
  const url = `/api/worktrees?task_id=${encodeURIComponent(taskId)}${worktreeQuery(ctx).replace(/^\?/, "&")}`;
  return hostRequest<WorktreeStatus>(url, { signal });
};

export const createWorktree = (taskId: string, ctx: WorktreeContext) =>
  hostRequest<WorktreeStatus>(
    `/api/worktrees/${encodeURIComponent(taskId)}/create`,
    {
      method: "POST",
      body: JSON.stringify({
        parent_id: ctx.parentId ?? null,
        module_id: ctx.moduleId ?? null,
        project_id: ctx.projectId ?? null,
        ticket_seq: ctx.ticketSeq ?? null,
        task_name: ctx.taskName ?? null,
      }),
    },
  );

export const discardWorktree = (taskId: string, ctx: WorktreeContext) =>
  hostRequest<DiscardResult>(
    `/api/worktrees/${encodeURIComponent(taskId)}/discard${worktreeQuery(ctx)}`,
    { method: "POST" },
  );
