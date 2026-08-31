//! Why preflight reads through SQL statements instead of SeaORM entities.
//!
//! Ticketry's rule is that database-backed behavior goes through generated
//! Seaography contracts over SeaORM entities. Preflight is the one place that
//! cannot: it runs *before* adoption, against a database that is not yet the
//! schema those entities describe.
//!
//! A SeaORM entity is a compile-time statement about one schema. Preflight's
//! input is any of eighty-five recorded generations plus a Rust-owned one, and
//! they disagree about which tables exist and which columns those tables have —
//! that disagreement is the whole reason preflight exists. An entity cannot
//! express "read `worktracker_issue.module_id` if this generation has it", and
//! an entity built for the current schema would fail to compile a query against
//! a generation that predates the column.
//!
//! So the seam is a read statement whose requirements are declared as data, and
//! the record below is what keeps it from becoming anything more. Every seam is
//! listed with what it reads; a seam added without an entry fails
//! [`tests::every_raw_statement_is_recorded`].

/// One recorded raw-SQL seam in this module.
pub struct ReadSeam {
    /// The file holding it.
    pub file: &'static str,
    /// What it reads.
    pub reads: &'static str,
    /// Why a SeaORM entity cannot express it.
    pub reason: &'static str,
}

/// Every raw-SQL seam preflight is allowed to have.
///
/// All six are reads. None writes, none is reachable from GraphQL, none returns
/// model data — an invariant query returns one `identity` column and nothing
/// else — and none outlives the rollback-only read transaction they run in.
pub const READ_SEAMS: &[ReadSeam] = &[
    ReadSeam {
        file: "read_view.rs",
        reads: "PRAGMA query_only, to make the view refuse writes at the connection",
        reason: "a connection-level SQLite setting has no entity",
    },
    ReadSeam {
        file: "schema.rs",
        reads: "PRAGMA table_xinfo, to learn which columns this generation has",
        reason: "schema introspection is what decides which entity would even apply",
    },
    ReadSeam {
        file: "structural.rs",
        reads: "PRAGMA integrity_check and PRAGMA foreign_key_check",
        reason: "SQLite's own storage-level checks have no SeaORM equivalent",
    },
    ReadSeam {
        file: "invariant.rs",
        reads: "one reviewed invariant query per rule, selecting an identity column",
        reason: "the rule list spans generations whose columns an entity cannot vary over",
    },
    ReadSeam {
        file: "filesystem.rs",
        reads: "one recorded path column at a time, with its row identity",
        reason: "which path columns exist differs by generation",
    },
    ReadSeam {
        file: "runtime.rs",
        reads: "recorded tmux session names and runtime namespaces",
        reason: "the namespace column is absent from earlier generations",
    },
];

#[cfg(test)]
mod tests {
    use super::READ_SEAMS;

    /// Every source file in the module, including its rule subdirectories.
    ///
    /// The record itself is excluded: it quotes the statements and the
    /// registrations it forbids in order to check for them.
    fn sources() -> Vec<(String, String)> {
        let mut files = Vec::new();
        collect(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/preflight"),
            &mut files,
        );
        files.retain(|(name, _)| name != "seaography_override.rs");
        files.sort();
        files
    }

    fn collect(directory: &std::path::Path, into: &mut Vec<(String, String)>) {
        for entry in std::fs::read_dir(directory).expect("read the preflight module") {
            let path = entry.expect("read a module entry").path();
            if path.is_dir() {
                collect(&path, into);
                continue;
            }
            let name = path
                .file_name()
                .expect("a module file name")
                .to_string_lossy()
                .into_owned();
            if !name.ends_with(".rs") {
                continue;
            }
            let source = std::fs::read_to_string(&path).expect("read a module file");
            into.push((
                // A rule file's name is not unique on its own, so the group it
                // belongs to stays part of the identity a failure reports.
                match path.parent().and_then(std::path::Path::file_name) {
                    Some(group) if group != "preflight" => {
                        format!("{}/{name}", group.to_string_lossy())
                    }
                    _ => name,
                },
                source,
            ));
        }
    }

    #[test]
    fn every_raw_statement_is_recorded() {
        for (name, source) in sources() {
            let raw = source.contains("Statement::from_string")
                || source.contains("Statement::from_sql_and_values");
            let recorded = READ_SEAMS.iter().any(|seam| seam.file == name);
            assert_eq!(
                raw, recorded,
                "{name} disagrees with the recorded read seams: reading raw SQL is {raw}, \
                 recorded is {recorded}"
            );
        }
    }

    #[test]
    fn no_seam_writes_and_none_becomes_a_graphql_surface() {
        // The two ways this override could spread: a statement that mutates the
        // source preflight is supposed to leave alone, or a resolver that turns
        // these reads into a public contract of their own.
        for (name, source) in sources() {
            for forbidden in [
                "INSERT ",
                "UPDATE ",
                "DELETE ",
                "DROP ",
                "ALTER ",
                "CREATE ",
                "execute_unprepared",
                "register_entity!",
                "register_custom_query",
                "register_custom_mutation",
                "CustomOutputType",
                "CustomInputType",
            ] {
                assert!(
                    !source.contains(forbidden),
                    "{name} contains {forbidden}, which preflight must never do"
                );
            }
        }
    }

    #[test]
    fn every_seam_records_why_an_entity_cannot_serve_it() {
        for seam in READ_SEAMS {
            assert!(!seam.reads.is_empty(), "{} records no read", seam.file);
            assert!(!seam.reason.is_empty(), "{} records no reason", seam.file);
        }
    }
}
