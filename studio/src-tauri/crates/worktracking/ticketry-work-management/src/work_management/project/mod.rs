//! Project mutation views.
//!
//! Generated Project writes remain private as one audited contract:
//!
//! | Operation | Public fields | Identity and invariants | Decision |
//! | --- | --- | --- | --- |
//! | Create one | `name`, `slug`, `description` | seeds the Project catalogue in one aggregate transaction | authored aggregate remains at `create_project` |
//! | Create batch | none | no caller contract exists | private |
//! | Update | `name`, `description`; acknowledgement writes only `onboarding_required` | both fields require one concrete Project identity and authored command ownership | restricted Seaolim views |
//! | Delete | none | tears down WorkItems before protected catalogue rows | authored aggregate remains at `delete_project` |
//!
//! Generated update cannot express the two distinct allowlists while binding
//! one required identity. These views prepare one Project ActiveModel each;
//! Seaolim owns their transaction and persistence.

mod views;

use seaography::Builder;

pub(super) fn register_mutations(mut builder: Builder) -> Builder {
    views::register_model_mutations(&mut builder);
    builder
}

pub fn register_authored_mutations(builder: &mut Builder) {
    views::register_authored_mutations(builder);
}
