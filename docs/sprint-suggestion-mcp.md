# Sprint suggestion MCP contract

A suggestion run can read its project's backlog and open sprint goals, record
suggestions, and terminate itself. It cannot create or edit work items through
the general MCP tools. Human acceptance uses the existing restricted
`update_sprint_suggestion` mutation to assign or create a Story transactionally.

Binding `suggestion_run_id` through `update_sprint` records the run's allowed
operations in the existing `app_settings` model, under scope `agent_run_mcp` and
key equal to the opaque run id. This protected host policy is written in the
same transaction as the sprint update and waiting-suggestion pruning. It has no
public settings mutation. Replacing or clearing the binding also preserves the
previous run's restricted policy. MCP intersects the persisted policy with the
credential's granted operations on every call and filters `tools/list` by the
same policy. New credentials and server restarts therefore cannot restore
work-item write access. The usual active-run and project checks still apply.

Recording recognizes previously accepted or dismissed decisions within the
sprint. Existing suggestions match by work-item identity; proposals match by
normalized title and epic identity. The goal still must belong to the current
sprint and the caller still must be the current suggestion run. A matching
reviewed row is returned unchanged. No new waiting row is created, and agent
recording never assigns a story.

Existing items must be live task-level work items in the sprint's project,
with that project's task-level Story issue type. Recording rejects items already
assigned to the target sprint, except when returning an unchanged reviewed
decision. Acceptance rechecks eligibility for waiting existing-item suggestions
because the item may have changed since recording. An invalid recording or
acceptance leaves suggestions, sprint membership, and counters unchanged.
Repeating an accepted proposal write with the same trimmed title is
idempotent; an attempt to rename an accepted proposal is rejected. Undo keeps
the created Story in the backlog and returns the suggestion as an existing-item
suggestion, following D-14.

The production model writes remain on the existing restricted Seaography seams.
This change introduces no GraphQL mutation, operation-registry exception,
launch kind, or database table. The scoped tool registry, MCP socket contract,
and generated issue relation are unchanged.

Regression coverage is in `sprint_suggestion_recording`, `sprint_suggestion_eligibility`,
`sprint_suggestion_transitions`, `sprint_run_identity`, the run-authority policy
unit tests, and `mcp_acceptance::sprint_suggestions`.
