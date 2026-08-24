import { createWorkTrackerClient } from "@worktracker/typescript-sdk/client";
import type { ShipRecord } from "@worktracker/typescript-sdk/models";
import { apiBase, apiKey } from "../../shared/api/client";

const sourceControlApi = () =>
  createWorkTrackerClient({
    baseUrl: apiBase(),
    apiKey: apiKey(),
  }).sourceControl;

export const listTaskShipRecords = (
  projectId: string,
  taskId: string,
  signal?: AbortSignal,
) =>
  sourceControlApi().listTaskShipRecords(
    { projectId, taskId },
    { signal },
  ) as Promise<ShipRecord[]>;

export const listModuleShipRecords = (
  projectId: string,
  moduleId: string,
  signal?: AbortSignal,
) =>
  sourceControlApi().listModuleShipRecords(
    { projectId, moduleId },
    { signal },
  ) as Promise<ShipRecord[]>;
