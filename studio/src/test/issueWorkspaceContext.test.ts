import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveIssueWorkspaceContext } from "../features/work-items/issue-detail/internal/issueWorkspaceContext";
import * as api from "../shared/api/client";
import type { Module, WorkItem, WorkItemDetail } from "../shared/api/types";

// Resolves the module for the Backlog issue workspace (CODIN-922) by walking
// parent_id ancestry rather than reading it directly from the task.

function workItem(over: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    project_id: "proj-1",
    parent_id: null,
    name: `item ${over.id}`,
    ...over,
  } as WorkItem;
}

function detailFor(task: WorkItem): WorkItemDetail {
  return { task } as WorkItemDetail;
}

const modules: Module[] = [{ id: "mod-1", name: "Module One" } as Module];

describe("resolveIssueWorkspaceContext (CODIN-922 ancestry)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the module by walking multi-hop parent ancestry", async () => {
    // leaf → story(parent) → module(mod-1). The module is not the direct parent.
    const leaf = workItem({ id: "leaf", parent_id: "story" });
    const story = workItem({ id: "story", parent_id: "mod-1" });

    vi.spyOn(api, "getWorkItem").mockResolvedValue(detailFor(leaf));
    vi.spyOn(api, "listModules").mockResolvedValue(modules);
    vi.spyOn(api, "listProjectWorkItems").mockResolvedValue([leaf, story]);

    const ctx = await resolveIssueWorkspaceContext("leaf");

    expect(ctx.task.id).toBe("leaf");
    expect(ctx.projectId).toBe("proj-1");
    expect(ctx.module.status).toBe("ready");
    expect(ctx.module.moduleId).toBe("mod-1");
  });

  it("degrades when no module ancestor exists", async () => {
    const orphan = workItem({ id: "orphan", parent_id: null });

    vi.spyOn(api, "getWorkItem").mockResolvedValue(detailFor(orphan));
    vi.spyOn(api, "listModules").mockResolvedValue(modules);
    vi.spyOn(api, "listProjectWorkItems").mockResolvedValue([orphan]);

    const ctx = await resolveIssueWorkspaceContext("orphan");

    expect(ctx.module.status).toBe("degraded");
    expect(ctx.module.moduleId).toBeNull();
    expect(ctx.module.reason).toBeTruthy();
  });

  it("degrades (does not throw) when the modules/items fetch fails", async () => {
    const leaf = workItem({ id: "leaf", parent_id: "mod-1" });

    vi.spyOn(api, "getWorkItem").mockResolvedValue(detailFor(leaf));
    vi.spyOn(api, "listModules").mockRejectedValue(new Error("boom"));
    vi.spyOn(api, "listProjectWorkItems").mockRejectedValue(new Error("boom"));

    const ctx = await resolveIssueWorkspaceContext("leaf");

    expect(ctx.task.id).toBe("leaf");
    expect(ctx.module.status).toBe("degraded");
    expect(ctx.module.moduleId).toBeNull();
  });
});
