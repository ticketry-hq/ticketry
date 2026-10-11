//! Sprint writes expose create-one and one restricted lifecycle update.
//! Create accepts only project_id and name; there is no batch or delete write.
//!
//! Generated writes cannot lock and maintain the project-owned sequence or
//! bind lifecycle validation and carryover to one Sprint. Restricted create
//! retains the generated input and appends under the Project lock; restricted
//! update requires an ID and allowlists name, status, carryover and suggestion-run changes. Entity writes
//! stay disabled at registration to keep the other generated mutators private.
//! The schema crate's sprint_sequence_graphql suite guards this contract.
//! The four-write audit is in docs/seaography-overrides/sprint.md.

mod column_policy;
mod views;

pub(crate) fn apply_generated_input_policy(context: &mut seaography::BuilderContext) {
    column_policy::apply(context);
}

pub(crate) fn register_mutations(mut builder: seaography::Builder) -> seaography::Builder {
    views::register(&mut builder);
    builder
}
