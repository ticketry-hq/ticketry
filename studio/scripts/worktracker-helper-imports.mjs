// Frozen CODING-2774 migration baseline: remove entries as features adopt the
// document conversion seam; never add transport importers or helper kinds.
// Explicit permanent exceptions below cover raw optimistic builders and identity keys.
// Each exception permits only the importer/helper pair, including aliased imports.
// Optimistic-row builders may retain compact helpers to emit raw server rows.
// Apollo keyFields and shared persisted-state/route normalization remain allowed
// by scope: this guard governs app/ and features/, not shared/ plumbing.
const existingWorktrackerHelperImports = new Set([
  "app/onboarding/onboardingStore.ts -> compactWorktrackerId",
  "features/agents/status/stream/workItemInvalidation.ts -> compactWorktrackerId",
  "features/agents/status/stream/workflowStateConvergence.ts -> publicWorktrackerId",
  "features/agents/worktrees/changes/WorktreeSwitcher.tsx -> compactWorktrackerId",
  "features/agents/worktrees/changes/useWorktreeCheckouts.ts -> compactWorktrackerId",
  "features/module-links/moduleLinkStore.ts -> compactWorktrackerId",
  "features/module-links/moduleLinkTransport.ts -> compactWorktrackerId",
  "features/planning-graph/convergence.ts -> compactWorktrackerId",
  "features/planning-graph/convergence.ts -> publicWorktrackerId",
  "features/projects/modulePresentationTransport.ts -> compactWorktrackerId",
  "features/projects/mutations.ts -> compactWorktrackerId",
  "features/projects/queries/index.ts -> compactWorktrackerId",
  "features/projects/stateCatalog.ts -> compactWorktrackerId",
  "features/settings/queries.ts -> compactWorktrackerId",
  "features/settings/queries.ts -> publicWorktrackerId",
  // Permanent optimistic builders emit compact server-form fragments for Apollo.
  "features/work-items/internal/optimisticCreation.ts -> compactWorktrackerId",
  "features/work-items/internal/optimisticTransition.ts -> compactWorktrackerId",
  "features/work-items/internal/optimisticUpdates.ts -> compactWorktrackerId",
  // Normalize route/persisted identities for the optimistic layer key only;
  // operation variables must use the document conversion seam.
  "features/work-items/planMutation.ts -> compactWorktrackerId",
  // Pending-write cache keys converge route and persisted work-item identities.
  "features/work-items/planWriteGuard.ts -> compactWorktrackerId",
  "features/work-items/queries/useWorkItemAttachments.ts -> compactWorktrackerId",
  "features/work-items/queries/useWorkItemAttachments.ts -> publicWorktrackerId",
  "features/work-items/runNow.ts -> compactWorktrackerId",
  "features/work-items/runNow.ts -> publicWorktrackerId",
  "features/work-items/utilities/arrivalRank.ts -> compactWorktrackerId",
  "features/work-items/workItemConvergence.ts -> compactWorktrackerId",
  // Permanent raw optimistic metadata builder: Apollo cache rows remain compact.
  "features/workflows/queries/issueTypeMetadata.ts -> compactWorktrackerId",
  "features/workspace-tabs/mutations.ts -> compactWorktrackerId",
  "features/workspace-tabs/queries.ts -> compactWorktrackerId",
]);

export function hasExistingWorktrackerHelperImport(file, helper) {
  return existingWorktrackerHelperImports.has(`${file} -> ${helper}`);
}
