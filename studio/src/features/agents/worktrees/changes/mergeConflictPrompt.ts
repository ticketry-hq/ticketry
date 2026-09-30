/**
 * The instructions a conflict-resolution agent is launched with.
 *
 * The merge is already in progress in the destination checkout, so the prompt
 * names that checkout, both branches, and the conflicted paths Git reported.
 * Settling the merge stays with the user: the agent resolves and stages, and
 * Ticketry's Finish/Abort buttons commit or unwind it.
 */
export interface MergeConflictFacts {
  readonly taskId: string;
  readonly sourceBranch: string;
  readonly destinationBranch: string;
  readonly destinationCheckout: string;
  readonly unmergedPaths: readonly string[];
}

export function buildMergeConflictPrompt(facts: MergeConflictFacts): string {
  const files = facts.unmergedPaths.length > 0
    ? facts.unmergedPaths.map((path) => `- ${path}`).join("\n")
    : "- (none reported; run `git status` to list them)";
  return [
    `Resolve the Git merge conflicts for Ticketry work item ${facts.taskId}.`,
    "",
    `Checkout: ${facts.destinationCheckout}`,
    `Merge in progress: ${facts.sourceBranch} into ${facts.destinationBranch}`,
    "",
    "Conflicted files:",
    files,
    "",
    `Work in ${facts.destinationCheckout}. Read both sides of each conflict, keep the intent of both branches, and resolve every conflicted file.`,
    "Stage each resolved path with `git add`, then stop and report what you changed.",
    "Do not commit, do not run `git merge --abort`, and do not reset the checkout — the user finishes or aborts the merge from Ticketry.",
  ].join("\n");
}
