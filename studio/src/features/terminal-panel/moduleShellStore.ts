/**
 * The durable login shells one module owns, and which of them is showing
 * (#667, #668).
 *
 * Everything here is lazy on purpose: the durable tmux session lives on whether
 * or not anyone is looking at it, so opening the panel on a module is the only
 * thing that may rediscover, mint or attach a shell. Entering a module must
 * not, or every module a person clicks through would leave a process behind.
 *
 * Membership and the active tab are held per module, so switching modules swaps
 * the whole strip and returns to the shell that module last had in front. The
 * set is rediscovered from the backend rather than remembered locally, because
 * the shells that actually survive a restart or an application rebuild are the ones
 * the server still holds a session for. Which of them was in front has no such
 * source — it is nobody's business but this person's — so that one fact is
 * remembered per module in {@link ./activeShellMemory} (#687).
 *
 * A refusal is a first-class outcome rather than an error toast: a module with
 * no usable folder gets the folder-selection affordance where its terminal
 * would be, because a bare shell that silently opened somewhere else would be a
 * destructive failure the user could not see.
 */

import { createApolloStore } from "../../shared/apollo/localState";

import { useTerminalStore } from "../agents/terminal";
import { apiErrorMessage } from "../../shared/api/errors";
import { toast } from "../../state/clientStore";
import { readActiveShell, rememberActiveShell } from "./activeShellMemory";
import {
  createModuleShell,
  listModuleShells,
  ModuleShellRefused,
} from "./api/moduleShellApi";
import {
  adoptDiscovered,
  atCapacity,
  EMPTY_SHELL_SET,
  withExitedShell,
  withNewShell,
  withoutShell,
  withRestartedShell,
  type ModuleShellProblem,
  type ModuleShellSet,
} from "./shellTabSet";

interface ModuleShellStoreState {
  byModule: Record<string, ModuleShellSet>;
  /**
   * Brings a module's strip up to date for a panel that is now showing it:
   * rediscovers surviving shells once, then creates the first one if the module
   * has none. Safe to call on every render pass.
   */
  openModule: (moduleId: string, projectId: string) => Promise<void>;
  /** Adds one shell, up to the cap. */
  createShell: (moduleId: string, projectId: string) => Promise<void>;
  /** Terminates one shell's durable session and drops its tab. */
  closeShell: (moduleId: string, runId: string) => Promise<void>;
  selectShell: (moduleId: string, runId: string) => void;
  /**
   * Records that one shell's durable session ended (#670).
   *
   * A clean exit disposes its tab; anything else keeps the tab with the code it
   * ended on. Idempotent, because the same ending is observable from both the
   * pushed completion frame and a later reconciliation pass.
   */
  noteShellExit: (
    moduleId: string,
    runId: string,
    exitCode: number | null,
  ) => void;
  /** Replaces a dead shell with a newly minted one in the same tab slot. */
  restartShell: (
    moduleId: string,
    projectId: string,
    runId: string,
  ) => Promise<void>;
  /** Drops a refusal so a freshly linked folder can be retried. */
  retryShell: (moduleId: string, projectId: string) => Promise<void>;
}

function problemFor(error: unknown): ModuleShellProblem {
  return error instanceof ModuleShellRefused
    ? { kind: "needs-folder", reason: error.reason }
    : {
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
}

export const useModuleShellStore = createApolloStore<ModuleShellStoreState>("module-shell", (set, get) => {
  function setFor(moduleId: string): ModuleShellSet {
    return get().byModule[moduleId] ?? EMPTY_SHELL_SET;
  }

  function update(
    moduleId: string,
    change: (current: ModuleShellSet) => ModuleShellSet,
  ): void {
    set((state) => {
      const current = state.byModule[moduleId] ?? EMPTY_SHELL_SET;
      const next = change(current);
      // Every route to a different active tab passes through here — selecting,
      // launching, closing, restarting, rediscovering — so remembering it once
      // in this spot is what keeps the record honest (#687).
      if (next.activeRunId !== current.activeRunId) {
        rememberActiveShell(moduleId, next.activeRunId);
      }
      return { byModule: { ...state.byModule, [moduleId]: next } };
    });
  }

  /** Opens the viewer session for a shell run this module already owns. */
  function present(
    moduleId: string,
    projectId: string,
    agentRunId: string,
  ): void {
    useTerminalStore.getState().openShellSession({ moduleId, projectId, agentRunId });
  }

  async function launch(moduleId: string, projectId: string): Promise<void> {
    update(moduleId, (current) => ({ ...current, busy: true }));
    try {
      const agentRunId = await createModuleShell(moduleId);
      present(moduleId, projectId, agentRunId);
      update(moduleId, (current) => ({
        ...withNewShell(current, agentRunId),
        busy: false,
      }));
    } catch (error) {
      update(moduleId, (current) => ({
        ...current,
        busy: false,
        problem: problemFor(error),
      }));
    }
  }

  return {
    byModule: {},

    async openModule(moduleId, projectId) {
      if (!moduleId || !projectId) return;
      const current = setFor(moduleId);
      if (current.busy || current.problem) return;

      if (!current.discovered) {
        update(moduleId, (existing) => ({ ...existing, busy: true }));
        let runIds: string[] = [];
        try {
          const shells = await listModuleShells(moduleId);
          runIds = shells.map((shell) => shell.agent_run_id);
        } catch {
          // A failed rediscovery must not mint a duplicate shell beside the
          // ones that are still running: leave the strip alone and let the next
          // open try again.
          update(moduleId, (existing) => ({ ...existing, busy: false }));
          return;
        }
        for (const runId of runIds) present(moduleId, projectId, runId);
        update(moduleId, (existing) => ({
          ...adoptDiscovered(existing, runIds, readActiveShell(moduleId)),
          busy: false,
        }));
      }

      // An empty strip on a discovered module is the common case of a first
      // open, and it costs nothing extra: one shell is what the panel is for.
      if (setFor(moduleId).runIds.length === 0) {
        await launch(moduleId, projectId);
      }
    },

    async createShell(moduleId, projectId) {
      if (!moduleId || !projectId) return;
      const current = setFor(moduleId);
      if (current.busy || atCapacity(current)) return;
      await launch(moduleId, projectId);
    },

    async closeShell(moduleId, runId) {
      const current = setFor(moduleId);
      if (!current.runIds.includes(runId)) return;
      if (current.dead[runId]) {
        // A shell that already ended has no durable session to end. Closing it
        // is dismissing the record of its failure, nothing more (#670).
        update(moduleId, (existing) => withoutShell(existing, runId));
        return;
      }
      // The tab goes first so the strip answers the click immediately; the
      // durable session is killed behind it. An explicit close is the one
      // gesture that ends a shell run, which is why it terminates rather than
      // merely detaching a viewer.
      update(moduleId, (existing) => withoutShell(existing, runId));
      try {
        // Not a dismissal: the run is terminated outright and shells are
        // excluded from the scratch listing that restores tabs, so there is no
        // re-fetch to guard against. Recording one would leave an unspendable
        // id in the module's capped dismissal ledger, evicting the agent-tab
        // dismissals that ledger exists for (#686).
        await useTerminalStore
          .getState()
          .terminatePersisted(runId, moduleId, { dismiss: false });
      } catch (error) {
        // A shell that would not die keeps its tab: dropping it would leave a
        // running session with nothing on screen to reach or close it. The
        // strip itself stays usable, so this reports rather than takes over
        // the panel the way a refused launch does.
        update(moduleId, () => current);
        toast.error(`Shell could not be closed: ${apiErrorMessage(error)}`);
      }
    },

    selectShell(moduleId, runId) {
      update(moduleId, (current) =>
        current.runIds.includes(runId)
          ? { ...current, activeRunId: runId }
          : current,
      );
    },

    noteShellExit(moduleId, runId, exitCode) {
      update(moduleId, (current) => withExitedShell(current, runId, exitCode));
    },

    async restartShell(moduleId, projectId, runId) {
      const current = setFor(moduleId);
      if (current.busy || !current.runIds.includes(runId)) return;
      update(moduleId, (existing) => ({ ...existing, busy: true }));
      try {
        // A brand new run every time. The historical one stays ended: its
        // durable session is gone, so there is nothing there to resume.
        const agentRunId = await createModuleShell(moduleId);
        present(moduleId, projectId, agentRunId);
        update(moduleId, (existing) => ({
          ...withRestartedShell(existing, runId, agentRunId),
          busy: false,
        }));
      } catch (error) {
        // The dead tab stays exactly where it was: it is still the only record
        // of the failure, and a refused restart must not take that away too.
        update(moduleId, (existing) => ({ ...existing, busy: false }));
        toast.error(`Shell could not be restarted: ${apiErrorMessage(error)}`);
      }
    },

    async retryShell(moduleId, projectId) {
      update(moduleId, (current) => ({
        ...current,
        problem: null,
        busy: false,
        discovered: false,
      }));
      await get().openModule(moduleId, projectId);
    },
  };
});
