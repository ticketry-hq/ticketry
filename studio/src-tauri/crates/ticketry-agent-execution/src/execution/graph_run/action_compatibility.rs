//! Why Graph Run CRUD remains on authored model views.
//!
//! Seaolim Actions return one generated entity object or null. The existing
//! create and update payload also reports the child Work Item identities this
//! request prepared, while delete reports the identities whose claims it
//! cleared. Replacing either payload would break the caller contract.
//!
//! Action serializer saves are independently committed model stages. Graph Run
//! service calls instead serialize policy resolution, claim preparation or
//! reset, durable effects, and recovery state through their existing SeaORM
//! transactions. Calling that service from an Action would preserve the raw
//! resolver while bypassing every Action serializer, so it would not be an
//! Action migration.

pub const VERDICT: &str = "incompatible: keep authored Graph Run create, update, and delete views";
pub const MUTATION_RESULT: &str = "GraphRunMutationPayload keeps graph_run and prepared_child_ids";
pub const DELETE_RESULT: &str = "GraphRunDeletePayload keeps graph_run and cleared_child_ids";
pub const TRANSACTION_CONTRACT: &str =
    "GraphRunService keeps policy, claims, effects, child preparation or reset, and crash recovery serialized";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_verdict_pins_payload_and_transaction_contracts() {
        assert!(VERDICT.contains("authored Graph Run"));
        assert!(MUTATION_RESULT.contains("prepared_child_ids"));
        assert!(DELETE_RESULT.contains("cleared_child_ids"));
        for concern in [
            "policy",
            "claims",
            "effects",
            "child preparation",
            "reset",
            "crash recovery",
        ] {
            assert!(TRANSACTION_CONTRACT.contains(concern), "missing {concern}");
        }
    }
}
