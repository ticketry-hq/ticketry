import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * The public GraphQL mutation surface, asserted exactly.
 *
 * Ticketry's contract is that every write is either restricted model CRUD or a
 * recorded domain operation, and that the operation registry stays exactly
 * equal to the live surface. An exact set is the only assertion that catches
 * the failure this repository cares about most: a generated Seaography mutator
 * reaching the public schema by accident. Adding a mutation should therefore
 * require editing this list, with a reason.
 */
const SANCTIONED_MUTATIONS = [
  // Work management — restricted model CRUD.
  "create_work_item",
  "update_work_item",
  "delete_work_item",
  "create_project",
  "update_project",
  "delete_project",
  "create_state",
  "update_state",
  "delete_state",
  "update_issue_type",
  "delete_issue_type",
  "update_module_presentation",
  "create_issue_type_transition",
  "update_issue_type_transition",
  "delete_issue_type_transition",
  "upsert_issue_type_launch_binding",
  // Work management — registry-declared domain operations.
  "reorder_work_item",
  "reorder_states",
  "reorder_issue_types",
  "reorder_module_presentation",
  "remove_state_from_issue_type_workflow",
  "acknowledge_onboarding",
  // One raw generated Seaography mutator is still reachable from the public
  // schema: the issue-type create the frontend calls. It is recorded here so a
  // reader sees it rather than assuming the surface is entirely authored.
  // `migration_probes` is registered `mutation: false`, so it contributes no
  // mutation — note that the committed SDL still declares
  // `migrationProbesCreateOne` and is stale on this point.
  "worktrackerIssuetypeCreateOne",
  // Repository and worktree operations.
  "set_module_link",
  "clear_module_link",
  "worktree_create",
  "worktree_commit",
  "worktree_push",
  "worktree_cleanup",
  "worktree_discard",
  "worktree_pull_request_create",
  "worktree_pull_request_replace",
  "worktree_pull_request_follow_up",
  "worktree_pull_request_merge_prepare",
  "module_checkout_commit",
  "module_checkout_push",
  "module_checkout_pull_request_create",
  // Execution, terminals, and agent runs.
  "run_now",
  "graph_run_create",
  "graph_run_update",
  "graph_run_delete",
  "terminal_session_create",
  "terminal_session_update",
  "terminal_output_observe",
  "create_viewer_lease",
  "update_viewer_lease",
  "delete_viewer_lease",
  "ingest_agent_lifecycle",
  "retry_automation_attempt",
  "dismiss_automation_attempt",
  // Settings and documents.
  "update_provider_catalog",
  "update_instant_launch_setting",
  "update_keybinding_setting",
  "refresh_task_document_registry",
  "refresh_scratch_document_registry",
  "save_design_document",
];

/** The six operations the work-management registry declares as non-CRUD. */
const REGISTRY_DOMAIN_OPERATIONS = [
  "reorder_module_presentation",
  "reorder_work_item",
  "reorder_states",
  "reorder_issue_types",
  "remove_state_from_issue_type_workflow",
  "acknowledge_onboarding",
];

/**
 * Fields a WorkItem update must never expose: ownership, derived ancestry,
 * ordering, revisions, timestamps, and counters belong to Rust alone.
 */
const PROTECTED_WORK_ITEM_FIELDS = [
  "project_id",
  "project",
  "module_id",
  "rank",
  "revision",
  "state_revision",
  "workflow_revision",
  "sequence_id",
  "created_at",
  "updated_at",
];

interface MutationField {
  name: string;
  args: Array<{ name: string }>;
}

async function mutationFields(
  request: APIRequestContext,
): Promise<MutationField[]> {
  const response = await request.post("/graphql", {
    data: {
      operationName: "MutationSurface",
      query: `query MutationSurface {
        __schema { mutationType { fields { name args { name } } } }
      }`,
      variables: {},
    },
  });
  const text = await response.text();
  expect(response.ok(), text).toBeTruthy();
  const envelope = JSON.parse(text) as {
    data?: { __schema?: { mutationType?: { fields?: MutationField[] } } };
    errors?: unknown;
  };
  expect(envelope.errors, text).toBeUndefined();
  const fields = envelope.data?.__schema?.mutationType?.fields;
  expect(fields, `introspection returned no mutation fields: ${text}`)
    .toBeTruthy();
  return fields!;
}

test.describe("public GraphQL mutation surface", () => {
  test("exposes exactly the sanctioned mutations", async ({ request }) => {
    const live = (await mutationFields(request)).map((field) => field.name);
    expect([...live].sort()).toEqual([...SANCTIONED_MUTATIONS].sort());
  });

  test("keeps every registry-declared domain operation live", async ({
    request,
  }) => {
    const live = new Set((await mutationFields(request)).map((f) => f.name));
    for (const operation of REGISTRY_DOMAIN_OPERATIONS) {
      expect(live.has(operation), `${operation} is declared but not served`)
        .toBe(true);
    }
  });

  /**
   * Every other identity-scoped update, asserted the same way. Each binds a
   * non-null identity and allowlists only caller-writable fields.
   */
  const IDENTITY_SCOPED_UPDATES: Record<string, string[]> = {
    update_project: ["description", "id", "name"],
    update_state: ["color", "group", "id", "name", "sort_order"],
    update_issue_type: [
      "color",
      "id",
      "name",
      "sort_order",
      "start_state_id",
      "workflow_revision",
    ],
    update_module_presentation: ["module_id", "tab_hidden"],
  };

  test("allowlists every other identity-scoped update input", async ({
    request,
  }) => {
    const live = await mutationFields(request);
    for (const [name, allowlist] of Object.entries(IDENTITY_SCOPED_UPDATES)) {
      const field = live.find((candidate) => candidate.name === name);
      expect(field, `the ${name} mutation`).toBeTruthy();
      expect(
        field!.args.map((argument) => argument.name).sort(),
        `${name} input`,
      ).toEqual(allowlist);
      // The identity argument is bound and non-null, never a filter object.
      expect(field!.args.map((argument) => argument.name))
        .not.toContain("filters");
    }
  });

  test("allowlists the WorkItem update input and hides protected fields", async ({
    request,
  }) => {
    const update = (await mutationFields(request))
      .find((field) => field.name === "update_work_item");
    expect(update, "the one WorkItem update mutation").toBeTruthy();
    const args = update!.args.map((argument) => argument.name);

    // The one write seam for a WorkItem: parent, blockers, classification,
    // archive, and state are fields on this contract, not separate mutations.
    expect([...args].sort()).toEqual([
      "blocked_by_ids",
      "description",
      "id",
      "is_archived",
      "issue_type_id",
      "name",
      "parent_id",
      "state_id",
      "workspace_tab_order",
    ]);
    for (const field of PROTECTED_WORK_ITEM_FIELDS) {
      expect(args, `update_work_item must not expose ${field}`)
        .not.toContain(field);
    }
  });
});
