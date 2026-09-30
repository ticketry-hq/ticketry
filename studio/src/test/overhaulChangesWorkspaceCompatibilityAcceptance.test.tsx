import { beforeEach, describe, expect, it } from "vitest";

import {
  readStudioWorkspaceTarget,
  rememberStudioWorkspaceTarget,
} from "../features/workspace-state/studioWorkspaceTarget";
import {
  workspaceTabOrderForPersistence,
  workspaceTabOrderFromJson,
} from "../features/workspace-tabs/types";

const WORKSPACE_TARGETS_KEY = "studio.activeWorkspaceByBucket:v1";

describe("overhaul acceptance, legacy Changes workspace compatibility", () => {
  beforeEach(() => localStorage.clear());

  it("[overhaul-330] migrates a saved Changes target to Details when no Back origin exists", () => {
    localStorage.setItem(WORKSPACE_TARGETS_KEY, JSON.stringify({
      "task-1": { kind: "changes" },
      "task-2": { kind: "doc", relPath: "DESIGN.md" },
    }));

    expect(readStudioWorkspaceTarget("task-1")).toEqual({ kind: "details" });
    expect(JSON.parse(localStorage.getItem(WORKSPACE_TARGETS_KEY) ?? "{}"))
      .toEqual({
        "task-1": { kind: "details" },
        "task-2": { kind: "doc", relPath: "DESIGN.md" },
      });

    rememberStudioWorkspaceTarget("task-3", { kind: "changes" });
    expect(readStudioWorkspaceTarget("task-3")).toEqual({ kind: "details" });
  });

  it("[overhaul-331] removes the retired Changes tab from saved order reads and writes", () => {
    const oldOrder = [
      { kind: "changes" },
      { kind: "doc", id: "design" },
      { kind: "details" },
    ] as const;

    expect(workspaceTabOrderFromJson(oldOrder)).toEqual({
      order: [
        { kind: "doc", id: "design" },
        { kind: "details" },
      ],
    });
    expect(workspaceTabOrderForPersistence(oldOrder)).toEqual([
      { kind: "doc", id: "design" },
      { kind: "details" },
    ]);
  });
});
