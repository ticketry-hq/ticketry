//! States, issue types, transitions, and launch bindings.
//!
//! A workflow is what decides which state a work item may reach and what
//! Ticketry launches when it gets there. A state belonging to another project, a
//! transition whose endpoints do not, or a binding on a state the workflow never
//! contained all describe a board a user cannot move work across.

use super::super::invariant::Invariant;
use super::super::report::Area;

/// The rules in this group, in declaration order.
#[must_use]
pub(crate) fn invariants() -> Vec<Invariant> {
    vec![
        Invariant {
            code: "state-group-unknown",
            area: Area::WorkManagement,
            rule: "every workflow state belongs to a known board group",
            requires: &["worktracker_state.group"],
            query: "SELECT id AS identity FROM worktracker_state
                    WHERE \"group\" NOT IN
                      ('backlog', 'unstarted', 'started', 'completed', 'cancelled')"
                .to_owned(),
        },
        Invariant {
            code: "state-project-missing",
            area: Area::WorkManagement,
            rule: "every workflow state belongs to a project that exists",
            requires: &["worktracker_state.project_id", "worktracker_project"],
            query: "SELECT state.id AS identity FROM worktracker_state state
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_project project
                      WHERE project.id = state.project_id)"
                .to_owned(),
        },
        Invariant {
            code: "state-duplicate-name",
            area: Area::WorkManagement,
            rule: "each state name identifies one state inside its project",
            requires: &["worktracker_state.project_id", "worktracker_state.name"],
            query: "SELECT one.id AS identity FROM worktracker_state one
                    JOIN worktracker_state other
                      ON other.project_id = one.project_id
                     AND other.name = one.name
                     AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "issue-type-level-unknown",
            area: Area::WorkManagement,
            rule: "every issue type pins a known hierarchy level",
            requires: &["worktracker_issuetype.level"],
            query: "SELECT id AS identity FROM worktracker_issuetype
                    WHERE level NOT IN ('module', 'task')"
                .to_owned(),
        },
        Invariant {
            code: "issue-type-project-missing",
            area: Area::WorkManagement,
            rule: "every issue type belongs to a project that exists",
            requires: &["worktracker_issuetype.project_id", "worktracker_project"],
            query: "SELECT kind.id AS identity FROM worktracker_issuetype kind
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_project project
                      WHERE project.id = kind.project_id)"
                .to_owned(),
        },
        Invariant {
            code: "issue-type-duplicate-name",
            area: Area::WorkManagement,
            rule: "each issue type name identifies one type inside its project",
            requires: &[
                "worktracker_issuetype.project_id",
                "worktracker_issuetype.name",
            ],
            query: "SELECT one.id AS identity FROM worktracker_issuetype one
                    JOIN worktracker_issuetype other
                      ON other.project_id = one.project_id
                     AND other.name = one.name
                     AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "issue-type-start-state-foreign",
            area: Area::WorkManagement,
            rule: "an issue type's start state exists and belongs to its own project",
            requires: &[
                "worktracker_issuetype.start_state_id",
                "worktracker_issuetype.project_id",
                "worktracker_state.project_id",
            ],
            query: "SELECT kind.id AS identity FROM worktracker_issuetype kind
                    LEFT JOIN worktracker_state state ON state.id = kind.start_state_id
                    WHERE kind.start_state_id IS NOT NULL
                      AND (state.id IS NULL OR state.project_id <> kind.project_id)"
                .to_owned(),
        },
        Invariant {
            code: "issue-type-workflow-revision-negative",
            area: Area::WorkManagement,
            rule: "a workflow revision never runs backwards past zero",
            requires: &["worktracker_issuetype.workflow_revision"],
            query: "SELECT id AS identity FROM worktracker_issuetype WHERE workflow_revision < 0"
                .to_owned(),
        },
        Invariant {
            code: "transition-endpoint-foreign",
            area: Area::WorkManagement,
            rule: "a transition's endpoints exist and belong to its issue type's project",
            requires: &[
                "worktracker_issuetypetransition.issue_type_id",
                "worktracker_issuetypetransition.from_state_id",
                "worktracker_issuetypetransition.to_state_id",
                "worktracker_issuetype.project_id",
                "worktracker_state.project_id",
            ],
            query: "SELECT CAST(move.id AS TEXT) AS identity
                    FROM worktracker_issuetypetransition move
                    JOIN worktracker_issuetype kind ON kind.id = move.issue_type_id
                    LEFT JOIN worktracker_state source ON source.id = move.from_state_id
                    LEFT JOIN worktracker_state target ON target.id = move.to_state_id
                    WHERE source.id IS NULL OR target.id IS NULL
                       OR source.project_id <> kind.project_id
                       OR target.project_id <> kind.project_id"
                .to_owned(),
        },
        Invariant {
            code: "transition-issue-type-missing",
            area: Area::WorkManagement,
            rule: "a transition belongs to an issue type that exists",
            requires: &[
                "worktracker_issuetypetransition.issue_type_id",
                "worktracker_issuetype",
            ],
            query: "SELECT CAST(move.id AS TEXT) AS identity
                    FROM worktracker_issuetypetransition move
                    WHERE NOT EXISTS (
                      SELECT 1 FROM worktracker_issuetype kind
                      WHERE kind.id = move.issue_type_id)"
                .to_owned(),
        },
        Invariant {
            code: "transition-duplicate",
            area: Area::WorkManagement,
            rule: "one issue type declares each state pair as a transition once",
            requires: &[
                "worktracker_issuetypetransition.issue_type_id",
                "worktracker_issuetypetransition.from_state_id",
                "worktracker_issuetypetransition.to_state_id",
            ],
            query: "SELECT CAST(one.id AS TEXT) AS identity
                    FROM worktracker_issuetypetransition one
                    JOIN worktracker_issuetypetransition other
                      ON other.issue_type_id = one.issue_type_id
                     AND other.from_state_id = one.from_state_id
                     AND other.to_state_id = one.to_state_id
                     AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "launch-binding-endpoint-foreign",
            area: Area::WorkManagement,
            rule: "a launch binding's issue type and state exist and share one project",
            requires: &[
                "worktracker_launchbinding.issue_type_id",
                "worktracker_launchbinding.state_id",
                "worktracker_issuetype.project_id",
                "worktracker_state.project_id",
            ],
            query: "SELECT CAST(binding.id AS TEXT) AS identity
                    FROM worktracker_launchbinding binding
                    LEFT JOIN worktracker_issuetype kind ON kind.id = binding.issue_type_id
                    LEFT JOIN worktracker_state state ON state.id = binding.state_id
                    WHERE kind.id IS NULL OR state.id IS NULL
                       OR state.project_id <> kind.project_id"
                .to_owned(),
        },
        Invariant {
            code: "launch-binding-duplicate",
            area: Area::WorkManagement,
            rule: "one issue type and state pair carries at most one launch binding",
            requires: &[
                "worktracker_launchbinding.issue_type_id",
                "worktracker_launchbinding.state_id",
            ],
            query: "SELECT CAST(one.id AS TEXT) AS identity
                    FROM worktracker_launchbinding one
                    JOIN worktracker_launchbinding other
                      ON other.issue_type_id = one.issue_type_id
                     AND other.state_id = one.state_id
                     AND other.id <> one.id"
                .to_owned(),
        },
        Invariant {
            code: "launch-binding-state-outside-workflow",
            area: Area::WorkManagement,
            rule: "a launch binding names a state its issue type's workflow contains",
            requires: &[
                "worktracker_launchbinding.issue_type_id",
                "worktracker_launchbinding.state_id",
                "worktracker_issuetype.start_state_id",
                "worktracker_issuetypetransition.issue_type_id",
                "worktracker_issuetypetransition.from_state_id",
                "worktracker_issuetypetransition.to_state_id",
            ],
            query: "SELECT CAST(binding.id AS TEXT) AS identity
                    FROM worktracker_launchbinding binding
                    JOIN worktracker_issuetype kind ON kind.id = binding.issue_type_id
                    WHERE kind.start_state_id IS NOT binding.state_id
                      AND NOT EXISTS (
                        SELECT 1 FROM worktracker_issuetypetransition move
                        WHERE move.issue_type_id = kind.id
                          AND (move.from_state_id = binding.state_id
                            OR move.to_state_id = binding.state_id))"
                .to_owned(),
        },
        Invariant {
            code: "launch-binding-required-skills-malformed",
            area: Area::WorkManagement,
            rule: "a launch binding's required skills are a JSON array",
            requires: &["worktracker_launchbinding.required_skills"],
            query: "SELECT CAST(id AS TEXT) AS identity FROM worktracker_launchbinding
                    WHERE NOT (json_valid(required_skills)
                           AND json_type(required_skills) = 'array')"
                .to_owned(),
        },
        Invariant {
            code: "launch-binding-model-missing",
            area: Area::WorkManagement,
            rule: "a launch binding's pinned model and reasoning level exist",
            requires: &[
                "worktracker_launchbinding.model_id",
                "worktracker_launchbinding.reasoning_id",
                "worktracker_agentmodel",
                "worktracker_reasoninglevel",
            ],
            query: "SELECT CAST(binding.id AS TEXT) AS identity
                    FROM worktracker_launchbinding binding
                    WHERE (binding.model_id IS NOT NULL
                           AND NOT EXISTS (
                             SELECT 1 FROM worktracker_agentmodel model
                             WHERE model.id = binding.model_id))
                       OR (binding.reasoning_id IS NOT NULL
                           AND NOT EXISTS (
                             SELECT 1 FROM worktracker_reasoninglevel level
                             WHERE level.id = binding.reasoning_id))"
                .to_owned(),
        },
    ]
}
