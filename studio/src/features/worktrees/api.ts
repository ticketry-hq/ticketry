import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import type {
  ActiveWorktree,
  ShipRecord,
} from "@worktracker/typescript-sdk/models";
import { apiBase, apiKey } from "../../shared/api/client";

const worktreesApi = () =>
  createWorkTrackerClient({ baseUrl: apiBase(), apiKey: apiKey() }).worktrees;

const sourceControlApi = () =>
  createWorkTrackerClient({ baseUrl: apiBase(), apiKey: apiKey() })
    .sourceControl;

export const listModuleWorktrees = (
  projectId: string,
  moduleId: string,
  signal?: AbortSignal,
) =>
  worktreesApi().listModuleWorktrees(
    { projectId, moduleId },
    { signal },
  ) as Promise<ActiveWorktree[]>;

export const refreshShipRecordPullRequestState = (
  projectId: string,
  moduleId: string,
  recordId: string,
) =>
  sourceControlApi().refreshShipRecordPullRequestState({
    projectId,
    moduleId,
    recordId,
  }) as Promise<ShipRecord>;
