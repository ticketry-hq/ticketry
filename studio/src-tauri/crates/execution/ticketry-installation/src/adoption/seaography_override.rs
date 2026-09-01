//! Why adoption is SQL, and the tests that stop that answer from spreading.
//!
//! Ticketry's database-backed GraphQL is Seaography-generated CRUD over SeaORM
//! entities, and a module that reads and writes tables without one needs a
//! reason. Adoption's reason is that it runs *before* there is an entity to
//! use. A SeaORM entity is a compile-time statement about one schema; adoption's
//! input is a database whose schema has not yet been accepted, whose ownership
//! has not yet transferred, and which may be any of the recorded generations.
//! Code that could not compile against the installation it is inspecting cannot
//! be the code that inspects it.
//!
//! Nothing here is reachable from GraphQL. It runs during desktop startup on a
//! connection outside the application pool, before the endpoint is installed
//! and before readiness opens, and it is finished by the time the first
//! resolver exists.

/// One raw-SQL seam in this module, and why an entity cannot serve it.
pub struct Seam {
    /// The file holding it.
    pub file: &'static str,
    /// What it reads or writes.
    pub reads: &'static str,
    /// Why a Seaography entity is not the right instrument.
    pub reason: &'static str,
}

/// Every raw-SQL seam adoption keeps.
#[must_use]
pub fn seams() -> Vec<Seam> {
    vec![
        Seam {
            file: "bridge.rs",
            reads: "recorded SQLite migration statements and schema postcondition queries",
            reason: "a historical schema correction must run before the canonical entities exist, \
                     and each statement is restricted to a generated fingerprint-bound catalog",
        },
        Seam {
            file: "exclusive.rs",
            reads: "PRAGMA locking_mode, BEGIN IMMEDIATE",
            reason: "taking the database's write lock is a connection-level act with no entity",
        },
        Seam {
            file: "checkpoint.rs",
            reads: "PRAGMA wal_checkpoint(TRUNCATE)",
            reason: "the write-ahead log is storage, not a model",
        },
        Seam {
            file: "integrity.rs",
            reads: "PRAGMA integrity_check, PRAGMA foreign_key_check",
            reason: "SQLite's own storage checks have no SeaORM equivalent",
        },
        Seam {
            file: "inventory.rs",
            reads: "COUNT and quote() over every product table, PRAGMA table_info",
            reason: "the comparison must cover tables and columns that differ by generation, \
                     which one compiled entity set cannot enumerate",
        },
        Seam {
            file: "ledger.rs",
            reads: "the adoption ledger table it creates",
            reason: "the ledger is written in the same transaction as the migration that \
                     creates it, before any entity for it could be registered",
        },
        Seam {
            file: "provisioning.rs",
            reads: "the recorded schema and migration provenance of a first launch",
            reason: "a migration statement is what brings a schema into existence; an entity \
                     presupposes it",
        },
        Seam {
            file: "representative_reads.rs",
            reads: "one counting join per product relationship",
            reason: "the reads must run against a database whose ownership has not yet \
                     transferred, and they read no model data at all",
        },
        Seam {
            file: "event_boundary.rs",
            reads: "one insert into the durable status-event ledger",
            reason: "the boundary is published before the GraphQL endpoint exists, through the \
                     same append-only table the Runs capability owns",
        },
        Seam {
            file: "semantic_bridge.rs",
            reads: "orphaned design-document metadata across historical Work Item schemas",
            reason: "the repair runs before adoption accepts a canonical schema, and its \
                     generation-independent anti-joins cannot use one compiled entity graph",
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::seams;

    const MODULE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/adoption");

    fn source_files() -> Vec<(String, String)> {
        std::fs::read_dir(MODULE)
            .expect("read the adoption module")
            .filter_map(|entry| {
                let path = entry.expect("read a module entry").path();
                if path.extension().is_none_or(|extension| extension != "rs") {
                    return None;
                }
                let name = path.file_name()?.to_string_lossy().into_owned();
                Some((
                    name,
                    std::fs::read_to_string(&path).expect("read a module file"),
                ))
            })
            .collect()
    }

    #[test]
    fn every_file_that_reads_raw_sql_is_recorded() {
        let recorded = seams()
            .into_iter()
            .map(|seam| seam.file)
            .collect::<Vec<_>>();
        for (name, body) in source_files() {
            if name == "seaography_override.rs" || name == "mod.rs" {
                continue;
            }
            let uses_sql = ["Statement::from_", "execute_unprepared", "PRAGMA "]
                .iter()
                .any(|marker| body.contains(marker));
            assert_eq!(
                uses_sql,
                recorded.contains(&name.as_str()),
                "{name} and the override record disagree about raw SQL"
            );
        }
    }

    #[test]
    fn no_seam_becomes_a_graphql_surface() {
        for (name, body) in source_files() {
            // This file names the forbidden markers in order to forbid them.
            if name == "seaography_override.rs" {
                continue;
            }
            for forbidden in [
                "register_entity!",
                "register_custom_query",
                "register_custom_mutation",
                "CustomOutputType",
                "CustomInputType",
                "entity_guard",
                "field_guard",
                "seaography::",
            ] {
                assert!(
                    !body.contains(forbidden),
                    "{name} would put adoption on the GraphQL surface via {forbidden}"
                );
            }
        }
    }

    #[test]
    fn every_seam_says_why_an_entity_cannot_serve_it() {
        for seam in seams() {
            assert!(
                seam.reason.len() > 30,
                "{} records no reason worth reviewing",
                seam.file
            );
        }
    }
}
