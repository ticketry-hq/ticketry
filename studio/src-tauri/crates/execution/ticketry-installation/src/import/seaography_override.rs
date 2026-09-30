//! Seaography boundary record for the PostgreSQL importer.
//!
//! Missing framework capability: Seaography exposes application GraphQL over
//! one builder database. It does not classify a foreign PostgreSQL schema,
//! hold a cross-engine consistent snapshot, copy every historical table into a
//! staged SQLite file, compare engine-neutral digests, or atomically select an
//! installation before GraphQL readiness.
//!
//! Rejected alternatives: generated model CRUD would expose migration as a
//! public mutation and would write the PostgreSQL builder database. A mirrored
//! entity graph would duplicate every model and still could not provide the
//! file activation boundary. SeaORM migrations cannot read a foreign engine
//! and stage another database as one operation.
//!
//! Smallest seam: this internal startup-only module uses SeaORM connections and
//! transactions. PostgreSQL receives a repeatable-read, read-only transaction.
//! SQLite receives parameterized inserts into a private canonical schema. The
//! seam has no GraphQL field, input, output, or operation-registry entry.
//!
//! Drift prevention: the import tests pin canonical values, digest parity,
//! read-only SQL, target validation, marker activation, retry artifacts, and
//! the absence of any GraphQL registration in this module.

#[cfg(test)]
mod tests {
    #[test]
    fn importer_does_not_register_a_graphql_contract() {
        let source = include_str!("mod.rs");
        for forbidden in [
            "register_custom_query",
            "register_custom_mutation",
            "register_entity!",
            "mutation: false",
        ] {
            assert!(!source.contains(forbidden));
        }
    }
}
