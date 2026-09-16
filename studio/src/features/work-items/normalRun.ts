import { TEMP_TASK_ID } from "../agents/types";
import { launchDefaultAgent } from "../agents/terminal";
import { executeTaskSubtree } from "../execution";
import type { WorkItem } from "../../shared/api/types";
import { useClientStore } from "../../state/clientStore";

export type NormalRunResult =
  | { readonly kind: "subtree"; readonly launched: string[] }
  | { readonly kind: "item" };

const commands = new Map<string, () => void>();

export function registerNormalRunCommand(
  issueId: string,
  command: () => void,
): () => void {
  commands.set(issueId, command);
  return () => {
    if (commands.get(issueId) === command) commands.delete(issueId);
  };
}

export function startNormalRun(issueId: string): boolean {
  const command = commands.get(issueId);
  if (!command) return false;
  command();
  return true;
}

export function startNormalRunForSelectedItem(): boolean {
  const issueId = useClientStore.getState().selectedTaskId;
  return issueId !== null && issueId !== TEMP_TASK_ID
    ? startNormalRun(issueId)
    : false;
}

export async function runWorkItem(
  item: WorkItem,
  context?: Parameters<typeof launchDefaultAgent>[1],
): Promise<NormalRunResult> {
  if (item.id === TEMP_TASK_ID) {
    throw new Error("Temporary work items cannot run.");
  }
  if (item.sub_issues_count > 0) {
    const { launched } = await executeTaskSubtree(item.id);
    return { kind: "subtree", launched: [...launched] };
  }
  await launchDefaultAgent(item.id, context);
  return { kind: "item" };
}
