use seaography::Builder;

use super::migration_probe;
use crate::entities::foundation::migration_probes;

/// Register entities owned by the isolated GraphQL foundation database.
///
/// `migration_probes` mutation audit:
///
/// | Operation | Public fields | Identity/scope | Invariants | Decision |
/// | --- | --- | --- | --- | --- |
/// | Create one | `id`, `value` | caller ID in the isolated foundation store | primary-key uniqueness | generated |
/// | Create batch | `id`, `value` | isolated foundation store | no owned caller | private |
/// | Update | `id`, `value` | optional filter permits bulk writes | concrete identity required | private |
/// | Delete | none | optional filter permits bulk writes | concrete identity required | private |
///
/// `graphql_foundation.rs` proves the unused writes stay absent and executes
/// create-one through the shipping transport.
pub(crate) fn register_entity_modules(mut builder: Builder) -> Builder {
    seaography::register_entity!(builder, migration_probes, mutation: false);
    migration_probe::register_views(builder)
}
