//! The public Module Link model graph and its restricted mutation views.
//!
//! Seaography owns the generated read graph. Its generated writes stay private
//! because they expose server-owned columns and optional many-row filters.
//! [`views`] publishes the two identity-bound model writes through Seaolim.
//!
//! Override record:
//! - Generated create-one and create-batch remain private because they accept
//!   caller-owned identity, Module ownership, and timestamps.
//! - Generated update and delete remain private because their optional filters
//!   can affect more than the one required Module.
//! - Skips, guards, filters, database constraints, and lifecycle hooks cannot
//!   select insert versus update, validate a host folder, bind a non-null
//!   identity, or preserve clear's idempotent Boolean result together.
//! - The smallest replacement is restricted `set_module_link` and
//!   `clear_module_link` CRUD. Both require `module_id`; the set input exposes
//!   only `path`. Seaolim owns their transaction and persistence, while the
//!   Module Link domain prepares one ActiveModel write.
//! - `tests/module_links.rs` pins the SDL, protected-field absence, derived
//!   values, validation, returned row, and idempotent clear. The registration
//!   contract test pins nested view ownership and explicit serializer tables.

mod mutation_error;
mod views;

use seaography::Builder;

use super::entities::module_link;

/// Register generated reads and the two restricted Module Link writes.
pub fn register(mut builder: Builder) -> Builder {
    seaography::register_entity!(builder, module_link, mutation: false);
    views::register(&mut builder);
    builder
}
