import { readFile } from "node:fs/promises";
import { buildSchema, parse, validate } from "graphql";

import { typedDocumentTargets } from "./typed-document-generation.mjs";

const FOUNDATION_MUTATIONS = ["migrationProbesCreateOne"];

// These are named operations because Git writes are external effects, not
// Worktree model CRUD. Keep the reason beside the exact public fields so the
// product-contract drift check also guards this exception registry.
const WORKTREE_GIT_OPERATION_EXCEPTIONS = {
  module_checkout_commit: "Commit uncommitted files in the module's linked checkout.",
  module_checkout_pull_request_create:
    "Push committed module-checkout work when needed and create a ready GitHub pull request.",
  module_checkout_push: "Push committed module-checkout work to its Git remote.",
  worktree_commit: "Commit uncommitted files in an indexed task worktree.",
  worktree_cleanup:
    "After explicit confirmation, remove an eligible merged task checkout, its local branch, and its Worktree row while preserving remote state.",
  worktree_pull_request_create:
    "Push committed task-worktree work when needed, create a ready GitHub pull request, and map its confirmed URL.",
  worktree_pull_request_follow_up:
    "Create a user-confirmed follow-up for new branch work after a correct-base merge and replace the mapped URL.",
  worktree_pull_request_merge_prepare:
    "Recheck one mapped pull request and launch a policy-resolved agent in its existing task worktree when conflicts or failed required checks can be repaired on the branch.",
  worktree_pull_request_replace:
    "Create a user-confirmed replacement for a closed unmerged pull request and replace the mapped URL.",
  worktree_push: "Push committed task-worktree work to its Git remote.",
};

const PRODUCT_MUTATIONS = [
  "acknowledge_onboarding",
  "clear_module_link",
  "create_issue_type_transition",
  "create_project",
  "create_state",
  "create_viewer_lease",
  "create_work_item",
  "delete_issue_type",
  "delete_issue_type_transition",
  "delete_project",
  "delete_state",
  "delete_viewer_lease",
  "delete_work_item",
  "dismiss_automation_attempt",
  "graph_run_create",
  "graph_run_delete",
  "graph_run_update",
  "ingest_agent_lifecycle",
  ...Object.keys(WORKTREE_GIT_OPERATION_EXCEPTIONS),
  "refresh_scratch_document_registry",
  "refresh_task_document_registry",
  "remove_state_from_issue_type_workflow",
  "reorder_issue_types",
  "reorder_module_presentation",
  "reorder_states",
  "reorder_work_item",
  "retry_automation_attempt",
  "run_now",
  "save_design_document",
  "set_module_link",
  "terminal_output_observe",
  "terminal_session_create",
  "terminal_session_update",
  "update_issue_type",
  "update_issue_type_transition",
  "update_instant_launch_setting",
  "update_keybinding_setting",
  "update_module_presentation",
  "update_project",
  "update_provider_catalog",
  "update_state",
  "update_viewer_lease",
  "update_work_item",
  "upsert_issue_type_launch_binding",
  "worktrackerIssuetypeCreateOne",
  "worktree_create",
  "worktree_discard",
];

const FOUNDATION_QUERIES = ["migrationProbes"];

const GENERATED_PRODUCT_QUERIES = [
  "agentRunViewerLeases",
  "agentRuns",
  "agentTerminalSessions",
  "designDocuments",
  "graphRuns",
  "moduleLinks",
  "worktrackerAgentmodel",
  "worktrackerAgentmodelreasoninglevel",
  "worktrackerAttachment",
  "worktrackerIssue",
  "worktrackerIssueBlockedBy",
  "worktrackerIssuetype",
  "worktrackerIssuetypetransition",
  "worktrackerLaunchbinding",
  "worktrackerModulepresentation",
  "worktrackerProject",
  "worktrackerProvider",
  "worktrackerReasoninglevel",
  "worktrackerState",
  "worktrees",
];

const AUTHORED_QUERIES = [
  "agent_run_holdings",
  "automation_attempts",
  "directory_completions",
  "instant_run_tickets",
  "instant_launch_setting",
  "keybinding_setting",
  "module_version_control",
  "provider_catalog",
  "resumable_terminal_sessions",
  "worktree_changes",
  "worktree_status",
];

const SUBSCRIPTIONS = ["run_status_stream"];

function fields(root) {
  return root ? Object.keys(root.getFields()).sort() : [];
}

function assertFields(label, actual, expected) {
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) === JSON.stringify(wanted)) return;

  const actualSet = new Set(actual);
  const wantedSet = new Set(wanted);
  const missing = wanted.filter((field) => !actualSet.has(field));
  const unexpected = actual.filter((field) => !wantedSet.has(field));
  throw new Error(
    `${label} differs` +
      `\n  missing: ${missing.join(", ") || "none"}` +
      `\n  unexpected: ${unexpected.join(", ") || "none"}`,
  );
}

export async function assertGraphqlProductContract({ schemaPath, sourceRoot }) {
  const schema = buildSchema(await readFile(schemaPath, "utf8"));

  assertFields(
    "GraphQL mutations",
    fields(schema.getMutationType()),
    [...FOUNDATION_MUTATIONS, ...PRODUCT_MUTATIONS],
  );
  assertFields(
    "GraphQL queries",
    fields(schema.getQueryType()),
    [...FOUNDATION_QUERIES, ...GENERATED_PRODUCT_QUERIES, ...AUTHORED_QUERIES],
  );
  assertFields(
    "GraphQL subscriptions",
    fields(schema.getSubscriptionType()),
    SUBSCRIPTIONS,
  );

  const failures = [];
  for (const target of await typedDocumentTargets(sourceRoot)) {
    const document = parse(await readFile(target.sourcePath, "utf8"));
    for (const error of validate(schema, document)) {
      failures.push(`${target.sourcePath}: ${error.message}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Frontend GraphQL document validation failed:\n${failures.join("\n")}`);
  }
}
