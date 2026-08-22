//! Written Seaography override record for the adopted Execution models.
//!
//! Generated capability attempted: rc.9 create-one, create-batch, update, and
//! delete for Graph Run and launch claim entities.
//!
//! Exact missing behavior: Graph Run writes must bind one authorized root and
//! Project, derive Module ancestry and policy, serialize against scheduling,
//! and coordinate claim or reset changes. Launch claims are internal facts
//! prepared with predetermined Agent Run and Launch Effect identities.
//!
//! Caller selection, aliases, and `ColumnOptions` only shape values. Skips,
//! guards, and `entity_filter` cannot derive policy or make create-one and
//! related writes one transaction. Database constraints cannot resolve launch
//! policy or coordinate Runs and Terminal preparation. rc.9 update skips
//! pre-save hooks and delete has no delete lifecycle hook.
//!
//! The smallest public seam is the identity-bound, Project-scoped, model-shaped
//! Graph Run create, update, and delete contract in `graph_run_service::graphql`.
//! `graph_run_service::operation_registry` records those three CRUD overrides.
//!
//! Protected fields: Project, derived Module, policy snapshot, runtime
//! identities, timestamps, and every launch-claim column stay out of mutation
//! inputs. Contract tests prove both generated bundles and sensitive read
//! columns remain absent.

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[cfg(test)]
pub struct Finding {
    pub entity: &'static str,
    pub operation: &'static str,
    pub reason: &'static str,
}

#[cfg(test)]
pub const FINDINGS: &[Finding] = &[
    Finding { entity: "Graph Run", operation: "create-one", reason: "caller input cannot derive and authorize Project, Module ancestry, or immutable launch policy" },
    Finding { entity: "Graph Run", operation: "create-batch", reason: "batch input cannot safely fan out policy resolution or external-effect preparation" },
    Finding { entity: "Graph Run", operation: "update", reason: "rc.9 bulk update has optional identity scope and no pre-save hook for serialized campaign changes" },
    Finding { entity: "Graph Run", operation: "delete", reason: "rc.9 delete has optional identity scope and no lifecycle hook for serialized claim reset" },
    Finding { entity: "Launch claim", operation: "create-one", reason: "only the scheduler may bind predetermined Graph Run, Agent Run, and effect identities" },
    Finding { entity: "Launch claim", operation: "create-batch", reason: "claim preparation must recheck each child and commit with its Runs effect" },
    Finding { entity: "Launch claim", operation: "update", reason: "retry generation changes require a concrete child identity and serialized liveness proof" },
    Finding { entity: "Launch claim", operation: "delete", reason: "only serialized Graph Run reset may remove campaign claims" },
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_entities_audit_all_four_generated_writes() {
        for entity in ["Graph Run", "Launch claim"] {
            let operations = FINDINGS
                .iter()
                .filter(|finding| finding.entity == entity)
                .map(|finding| finding.operation)
                .collect::<Vec<_>>();
            assert_eq!(
                operations,
                ["create-one", "create-batch", "update", "delete"]
            );
            assert!(FINDINGS
                .iter()
                .filter(|finding| finding.entity == entity)
                .all(|finding| !finding.reason.is_empty()));
        }
    }
}
