//! The generated Module Presentation read graph and restricted visibility view.
//!
//! Generated writes remain private because update and delete accept optional
//! many-row filters, while create can expose rank and caller-owned identity.
//! The update view requires one Module identity, exposes only `tab_hidden`, and
//! lets Seaolim own persistence of the prepared insert or update.

mod views;

pub(crate) fn register_mutations(mut builder: seaography::Builder) -> seaography::Builder {
    views::register_model_mutations(&mut builder);
    builder
}

pub(crate) fn register_authored_mutations(builder: &mut seaography::Builder) {
    views::register_authored_mutations(builder);
}
