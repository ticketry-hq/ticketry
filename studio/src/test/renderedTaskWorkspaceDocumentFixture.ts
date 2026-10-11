import { act, waitFor } from "@testing-library/react";
import { useAgentStatusStore } from "../features/agents/status/testStore";
import { useTerminalForegroundStore, useTerminalStore } from "../features/agents/terminal";
import { useStudioStore } from "../features/projects/store";
import { documentOperationName } from "../graphql-foundation/typedDocument";
import { useClientStore } from "../state/clientStore";
import { installDesktopGraphQlRuntime, terminalSessionReadExecutor } from "./desktopGraphQlRuntime";

export interface DocumentRow {
  __typename: "DesignDocuments";
  id: string;
  relPath: string;
  contentDigest: string;
}

export function workspaceDocument(id = "design-a", relPath = "DESIGN.html"): DocumentRow {
  return { __typename: "DesignDocuments", id, relPath, contentDigest: `digest-${id}` };
}

/** Hold the actual runtime refresh response, leaving Apollo and workspace code real. */
export function installDeferredWorkspaceDocuments() {
  const requests: Array<{
    taskId: string;
    resolve: (documents: DocumentRow[]) => void;
    reject: (error: Error) => void;
  }> = [];
  const terminalReads = terminalSessionReadExecutor({
    readTaskTerminalSessions: async () => [],
    readScratchTerminalSessions: async () => [],
    readTaskResumableTerminalSessions: async () => [],
    readScratchResumableTerminalSessions: async () => [],
  });
  installDesktopGraphQlRuntime(async (document, variables) => {
    const operation = documentOperationName(document);
    if (operation === "RefreshTaskDocumentRegistry") {
      const taskId = (variables as { taskId: string }).taskId;
      const documents = await new Promise<DocumentRow[]>((resolve, reject) => {
        requests.push({ taskId, resolve, reject });
      });
      return { refresh_task_document_registry: documents } as never;
    }
    if (operation === "WorktreeStatus") {
      return { worktree_status: {
        __typename: "WorktreeStatusView", kind: "none", task_id: "story-a",
        top_level_task_id: "story-a", is_shared: false, branch: null, base_branch: null,
        path: null, state: null, clean: null, dirty: null, ahead: null, behind: null,
        conflict: null, checkout_present: false, ephemeral: false, reason: null,
      } } as never;
    }
    return terminalReads(document, variables);
  });
  localStorage.clear();
  useStudioStore.setState({ selectedProjectId: "project-1" });
  useClientStore.setState({
    selectedModuleId: "module-1", selectedTaskId: "story-a",
    focusedPane: "tasks", sidebarVisible: true,
    editViewBodyEngaged: false, editViewZone: "stories", navigationModality: "pointer",
    workspaces: {}, activeByTask: {},
  });
  useTerminalForegroundStore.setState({ claims: {}, hostTargets: {} });
  useTerminalStore.setState({ sessions: {}, sessionByRun: {} });
  useAgentStatusStore.setState({
    projectId: "project-1", runs: {}, automationAttempts: {}, automationByTask: {},
  });

  async function request(taskId: string, occurrence = 0) {
    await waitFor(() => {
      if (!requests.filter((entry) => entry.taskId === taskId)[occurrence]) {
        throw new Error(`Waiting for ${taskId} document refresh ${occurrence}`);
      }
    });
    return requests.filter((entry) => entry.taskId === taskId)[occurrence]!;
  }
  return {
    request,
    async deliver(taskId: string, documents: DocumentRow[], occurrence = 0) {
      const pending = await request(taskId, occurrence);
      await act(async () => { pending.resolve(documents); });
    },
    async fail(taskId: string) {
      const pending = await request(taskId);
      await act(async () => { pending.reject(new Error("Document registry unavailable")); });
    },
  };
}
