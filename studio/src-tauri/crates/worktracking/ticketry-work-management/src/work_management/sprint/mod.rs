//! Sprint writes expose create-one and one restricted lifecycle update.
//! Create accepts only project_id and name; there is no batch or delete write.
//!
//! Generated update/delete accept optional many-row filters, so they cannot
//! bind lifecycle validation and carryover to one Sprint. Generated create-one
//! remains enabled through its view; the restricted update requires an ID and
//! allowlists name, status, carryover and suggestion-run changes. Entity writes
//! stay disabled at registration to keep the other generated mutators private.
//! The schema crate's sprint_planning_graphql suite guards this contract.

mod column_policy;
mod views;

pub(crate) fn apply_generated_input_policy(context: &mut seaography::BuilderContext) {
    column_policy::apply(context);
}

pub(crate) fn register_mutations(mut builder: seaography::Builder) -> seaography::Builder {
    views::register(&mut builder);
    builder
}
