import { useState } from "react";

import { changesPrimaryAction, type ChangesPrimaryAction } from "./changesPrimaryAction";
import type { PullRequestStatusValue } from "./PullRequestStatus";

export type ChangesActionName =
  | "commit"
  | "push"
  | "pull-request"
  | "merge-preparation"
  | "stack";

export interface ChangesCommands {
  dirty: boolean;
  unpushedCount: number;
  branch?: string | null;
  stackKind?: "task" | "module";
  commitDescription?: string | null;
  pullRequestUrl?: string | null;
  pullRequestCreationEligible?: boolean;
  pullRequest?: PullRequestStatusValue | null;
  onCommit: () => Promise<void>;
  onPush: () => Promise<void>;
  onStack?: () => Promise<unknown>;
  onCreatePullRequest?: () => Promise<{ url: string }>;
  onReplacePullRequest?: () => Promise<{ url: string }>;
  onFollowUpPullRequest?: () => Promise<{ url: string }>;
  onPrepareMerge?: () => Promise<void>;
}

export interface ChangesActionsController {
  commands: ChangesCommands;
  primary: ChangesPrimaryAction;
  busy: ChangesActionName | null;
  error: string | null;
  notice: string | null;
  confirmingStack: boolean;
  setConfirmingStack: (confirming: boolean) => void;
  /** Commits and pushes in one step, creating a pull request when eligible. */
  runStack: () => Promise<void>;
  runPrimary: () => void;
  commit: () => Promise<void>;
  push: () => Promise<void>;
  createPullRequest: (action?: () => Promise<{ url: string }>) => Promise<void>;
  prepareMerge: () => Promise<void>;
}

/**
 * One owner for every Changes command, its busy state, and its failure.
 *
 * The toolbar renders the derived primary action and the inspector renders the
 * rest, but both drive the same Git checkout: a single controller keeps them
 * from running two writes at once and keeps one error surface for both.
 */
export function useChangesActions(commands: ChangesCommands): ChangesActionsController {
  const [busy, setBusy] = useState<ChangesActionName | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingStack, setConfirmingStack] = useState(false);

  const run = async (
    name: ChangesActionName,
    action: () => Promise<unknown>,
    failure: string,
    success?: string,
  ) => {
    setBusy(name);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    } finally {
      setBusy(null);
    }
  };

  const primary = changesPrimaryAction({
    dirty: commands.dirty,
    stackKind: commands.stackKind,
    unpushedCount: commands.unpushedCount,
    pullRequestCreationEligible: commands.pullRequestCreationEligible === true,
    pullRequestUrl: commands.pullRequestUrl,
    pullRequest: commands.pullRequest,
  });

  const createPullRequest = async (action?: () => Promise<{ url: string }>) => {
    if (!action) return;
    await run("pull-request", action, "Pull-request creation failed.");
  };

  const runStack = async () => {
    setConfirmingStack(false);
    if (!commands.onStack) {
      setError("Stacked action is unavailable.");
      return;
    }
    const publishes = commands.stackKind === "task"
      && commands.pullRequestCreationEligible === true
      && Boolean(commands.onCreatePullRequest);
    await run("stack", async () => {
      await commands.onStack?.();
      if (publishes) await commands.onCreatePullRequest?.();
    }, "Commit and push failed.", publishes
      ? "Committed, pushed, and created a pull request."
      : "Committed and pushed.");
  };

  return {
    commands,
    primary,
    busy,
    error,
    notice,
    confirmingStack,
    setConfirmingStack,
    runStack,
    runPrimary: () => {
      if (primary.kind === "stack") setConfirmingStack(true);
      else if (primary.kind === "push") void run("push", commands.onPush, "Push failed.");
      else if (primary.kind === "create-pull-request") {
        void createPullRequest(commands.onCreatePullRequest);
      }
    },
    commit: () => run("commit", commands.onCommit, "Commit failed."),
    push: () => run("push", commands.onPush, "Push failed."),
    createPullRequest,
    prepareMerge: () => run(
      "merge-preparation",
      async () => { await commands.onPrepareMerge?.(); },
      "Merge preparation failed.",
      "Merge-preparation agent started.",
    ),
  };
}
