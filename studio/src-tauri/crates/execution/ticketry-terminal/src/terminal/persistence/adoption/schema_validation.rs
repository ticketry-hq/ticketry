use super::*;

pub(super) async fn validate_schema(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), TerminalPersistenceError> {
    let expected = expected_columns(source);
    for (table, columns) in &expected {
        if !table_exists(database, table).await? {
            return Err(incompatible(format!("Terminal schema is missing {table}")));
        }
        let observed = schema::columns(database, table).await?;
        let wanted = columns
            .iter()
            .map(|v| (*v).to_owned())
            .collect::<BTreeSet<_>>();
        if observed != wanted {
            return Err(incompatible(format!(
                "unknown columns for {table}: observed {observed:?}"
            )));
        }
    }
    let allowed = expected
        .keys()
        .copied()
        .chain(["django_migrations", "agent_runs", "runs_launch_effects"])
        .collect::<BTreeSet<_>>();
    let terminal_tables = database.query_all_raw(Statement::from_string(DbBackend::Sqlite, "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'agent_terminal%' OR name LIKE 'agent_run_viewer%' OR name LIKE 'terminal_%' OR name LIKE 'ticketry_terminal%')".to_owned())).await.map_err(storage)?;
    for row in terminal_tables {
        let table = row.try_get::<String>("", "name").map_err(storage)?;
        if !allowed.contains(table.as_str()) {
            return Err(incompatible(format!("unknown Terminal table {table}")));
        }
    }
    validate_indexes(database, source).await?;
    validate_keys(database, source).await?;
    validate_foreign_keys(database, source).await?;
    validate_check_counts(database, source).await?;
    validate_adopted_column_shapes(database, source).await?;
    Ok(())
}

async fn validate_adopted_column_shapes(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), TerminalPersistenceError> {
    for table in ["agent_terminal_sessions", "terminal_launch_requests"] {
        if !expected_columns(source).contains_key(table) {
            continue;
        }
        let rows = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA table_info('{table}')"),
            ))
            .await
            .map_err(storage)?;
        let facts = rows
            .into_iter()
            .map(|row| {
                Ok((
                    row.try_get::<String>("", "name").map_err(storage)?,
                    (
                        row.try_get::<String>("", "type")
                            .map_err(storage)?
                            .to_ascii_lowercase(),
                        row.try_get::<i32>("", "notnull").map_err(storage)?,
                        row.try_get::<Option<String>>("", "dflt_value")
                            .map_err(storage)?,
                    ),
                ))
            })
            .collect::<Result<BTreeMap<_, _>, TerminalPersistenceError>>()?;
        let fields: &[(&str, &str, i32, Option<&str>)] = match (source, table) {
            (SourceClassification::RustOwned, "agent_terminal_sessions") => &[
                ("scope", "varchar", 1, Some("'task'")),
                ("output_identity", "varchar(64)", 0, None),
                ("output_sequence", "bigint", 1, Some("0")),
                ("last_output_at", "varchar", 0, None),
                ("agent", "varchar", 0, None),
            ],
            (SourceClassification::RustOwned, "terminal_launch_requests") => &[
                ("scope", "varchar(32)", 1, None),
                ("agent", "varchar(64)", 0, None),
            ],
            (SourceClassification::Django(leaf), "agent_terminal_sessions") => {
                let number = leaf[..4].parse::<u8>().unwrap_or_default();
                if leaf == "0005_terminal_output_activity" || number >= 6 {
                    &[
                        ("scope", "varchar", 1, Some("'task'")),
                        ("output_identity", "varchar(64)", 0, None),
                        ("output_sequence", "bigint", 1, None),
                        ("last_output_at", "varchar", 0, None),
                        ("agent", "varchar", if number >= 6 { 0 } else { 1 }, None),
                    ]
                } else {
                    &[
                        ("scope", "varchar", 1, Some("'task'")),
                        ("agent", "varchar", 1, None),
                    ]
                }
            }
            (SourceClassification::Django(leaf), "terminal_launch_requests") => &[
                ("scope", "varchar(32)", 1, None),
                (
                    "agent",
                    "varchar(64)",
                    if leaf == CURRENT_DJANGO_LEAF { 0 } else { 1 },
                    None,
                ),
            ],
            _ => &[],
        };
        for (column, data_type, not_null, default) in fields {
            let Some((observed_type, observed_not_null, observed_default)) = facts.get(*column)
            else {
                return Err(incompatible(format!("{table} is missing {column}")));
            };
            if observed_type != data_type
                || observed_not_null != not_null
                || observed_default.as_deref() != *default
            {
                return Err(incompatible(format!(
                    "unknown definition for {table}.{column}"
                )));
            }
        }
    }
    Ok(())
}

async fn validate_keys(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), TerminalPersistenceError> {
    for table in expected_columns(source).keys() {
        let info = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA table_info('{table}')"),
            ))
            .await
            .map_err(storage)?;
        let primary = info
            .into_iter()
            .filter_map(|row| {
                (row.try_get::<i32>("", "pk").ok()? > 0)
                    .then(|| row.try_get::<String>("", "name").ok())
                    .flatten()
            })
            .collect::<BTreeSet<_>>();
        let expected_primary = match *table {
            "agent_terminal_sessions" | "agent_run_viewer_leases" => {
                BTreeSet::from(["agent_run_id".to_owned()])
            }
            "terminal_launch_requests"
            | "terminal_launch_material"
            | "terminal_cleanup_effects" => BTreeSet::from(["effect_id".to_owned()]),
            LEDGER_TABLE => BTreeSet::from(["singleton".to_owned()]),
            _ => BTreeSet::new(),
        };
        if primary != expected_primary {
            return Err(incompatible(format!(
                "unknown primary-key constraint for {table}: observed {primary:?}"
            )));
        }

        let indexes = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA index_list('{table}')"),
            ))
            .await
            .map_err(storage)?;
        let mut unique_columns = BTreeSet::new();
        for index in indexes {
            if index.try_get::<i32>("", "unique").map_err(storage)? == 0
                || index.try_get::<String>("", "origin").map_err(storage)? != "u"
            {
                continue;
            }
            let name = index.try_get::<String>("", "name").map_err(storage)?;
            let columns = database
                .query_all_raw(Statement::from_string(
                    DbBackend::Sqlite,
                    format!("PRAGMA index_info('{name}')"),
                ))
                .await
                .map_err(storage)?
                .into_iter()
                .map(|row| row.try_get::<String>("", "name").map_err(storage))
                .collect::<Result<Vec<_>, _>>()?;
            unique_columns.insert(columns);
        }
        let expected_unique = match *table {
            "terminal_launch_requests" | "terminal_cleanup_effects" => {
                BTreeSet::from([vec!["agent_run_id".to_owned()]])
            }
            "terminal_launch_material" => BTreeSet::from([
                vec!["agent_run_id".to_owned()],
                vec!["request_id".to_owned()],
            ]),
            _ => BTreeSet::new(),
        };
        if unique_columns != expected_unique {
            return Err(incompatible(format!(
                "unknown unique constraints for {table}: observed {unique_columns:?}"
            )));
        }
    }
    Ok(())
}

pub(super) fn expected_columns(
    source: SourceClassification,
) -> BTreeMap<&'static str, &'static [&'static str]> {
    let mut tables = BTreeMap::new();
    match source {
        SourceClassification::RustOwned => {
            tables.insert("agent_terminal_sessions", SESSION_COLUMNS);
            tables.insert("agent_run_viewer_leases", LEASE_COLUMNS);
            tables.insert("terminal_launch_requests", LAUNCH_REQUEST_COLUMNS);
            tables.insert("terminal_launch_material", LAUNCH_MATERIAL_COLUMNS);
            tables.insert("terminal_cleanup_effects", CLEANUP_EFFECT_COLUMNS);
            tables.insert(
                LEDGER_TABLE,
                &[
                    "singleton",
                    "version",
                    "source_leaf",
                    "schema_fingerprint",
                    "session_digest",
                    "launch_request_digest",
                    "adopted_at",
                ],
            );
        }
        SourceClassification::Django(leaf) => {
            if leaf == EMPTY_DJANGO_LEAF {
                return tables;
            }
            let number = leaf[..4].parse::<u8>().unwrap();
            let mut session_len = 10;
            if number >= 3 {
                session_len += 1;
            }
            if number >= 4 {
                session_len += 1;
            }
            if leaf == "0005_terminal_output_activity" || number >= 6 {
                session_len += 3;
            }
            // Django's rebuilt canonical order moves nullable agent last at 0006.
            const EARLY: &[&str] = &[
                "agent_run_id",
                "tmux_session_name",
                "task_id",
                "module_id",
                "project_id",
                "agent",
                "created_at",
                "terminated_at",
                "scope",
                "doc_rel_path",
                "runtime_cleanup_pending",
                "runtime_namespace",
                "output_identity",
                "output_sequence",
                "last_output_at",
            ];
            const LATE: &[&str] = &[
                "agent_run_id",
                "tmux_session_name",
                "task_id",
                "module_id",
                "project_id",
                "created_at",
                "terminated_at",
                "scope",
                "doc_rel_path",
                "runtime_cleanup_pending",
                "runtime_namespace",
                "output_identity",
                "output_sequence",
                "last_output_at",
                "agent",
            ];
            tables.insert(
                "agent_terminal_sessions",
                if number >= 6 {
                    &LATE[..session_len]
                } else {
                    &EARLY[..session_len]
                },
            );
            if number >= 2 {
                tables.insert(
                    "agent_run_viewer_leases",
                    &[
                        "agent_run_id",
                        "viewer_id",
                        "transport",
                        "acquired_at",
                        "expires_at",
                    ],
                );
            }
            if matches!(
                leaf,
                "0005_terminallaunchrequest" | "0008_merge_20260819_1521" | CURRENT_DJANGO_LEAF
            ) {
                tables.insert("terminal_launch_requests", LAUNCH_REQUEST_COLUMNS);
            }
        }
    }
    tables
}

async fn validate_indexes(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), TerminalPersistenceError> {
    let rows = database.query_all_raw(Statement::from_string(DbBackend::Sqlite, "SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND tbl_name IN ('agent_terminal_sessions','agent_run_viewer_leases','terminal_launch_requests','terminal_launch_material','terminal_cleanup_effects') ORDER BY name".to_owned())).await.map_err(storage)?;
    let observed = rows
        .into_iter()
        .map(|r| r.try_get::<String>("", "name").map_err(storage))
        .collect::<Result<BTreeSet<_>, _>>()?;
    let task_index = match source {
        SourceClassification::Django(EMPTY_DJANGO_LEAF) => None,
        SourceClassification::Django("0008_rename_terminal_task_index") => {
            Some("idx_terminal_task_created")
        }
        _ => Some("idx_agent_terminal_sessions_task_created"),
    };
    let mut expected = task_index
        .into_iter()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    match source {
        SourceClassification::RustOwned => {
            expected.insert("agent_terminal_sessions_runtime_namespace_a928a9d9".to_owned());
            expected.insert("idx_terminal_launch_material_scope".to_owned());
            expected.insert("idx_terminal_cleanup_effects_reconcile".to_owned());
        }
        SourceClassification::Django(leaf)
            if leaf >= "0004_agentterminalsession_runtime_namespace" =>
        {
            expected.insert("agent_terminal_sessions_runtime_namespace_a928a9d9".to_owned());
        }
        _ => {}
    }
    if observed != expected {
        return Err(incompatible(format!(
            "unknown Terminal indexes: observed {observed:?}"
        )));
    }
    Ok(())
}

async fn validate_foreign_keys(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), TerminalPersistenceError> {
    let expected = expected_columns(source);
    for table in expected.keys() {
        let rows = database
            .query_all_raw(Statement::from_string(
                DbBackend::Sqlite,
                format!("PRAGMA foreign_key_list('{table}')"),
            ))
            .await
            .map_err(storage)?;
        let mut observed = Vec::new();
        for row in rows {
            observed.push((
                row.try_get::<String>("", "table").map_err(storage)?,
                row.try_get::<String>("", "from").map_err(storage)?,
                row.try_get::<String>("", "to").map_err(storage)?,
                row.try_get::<String>("", "on_delete").map_err(storage)?,
            ));
        }
        let cascade = match (source, *table) {
            (SourceClassification::RustOwned, _) => "CASCADE",
            (SourceClassification::Django("0001_initial"), "agent_terminal_sessions")
            | (
                SourceClassification::Django("0002_agent_run_viewer_lease"),
                "agent_terminal_sessions",
            ) => "CASCADE",
            (SourceClassification::Django(leaf), _)
                if leaf >= "0007_restore_agent_run_fk_cascade" =>
            {
                "CASCADE"
            }
            (SourceClassification::Django(_), _) => "NO ACTION",
        };
        let wanted: Vec<(&str, &str, &str, &str)> = match *table {
            "agent_terminal_sessions" => vec![("agent_runs", "agent_run_id", "id", cascade)],
            "agent_run_viewer_leases" => vec![("agent_runs", "agent_run_id", "id", cascade)],
            "terminal_launch_material" => [
                ("agent_runs", "resume_from_agent_run_id", "id", "NO ACTION"),
                ("agent_runs", "agent_run_id", "id", "CASCADE"),
                ("runs_launch_effects", "effect_id", "effect_id", "CASCADE"),
            ]
            .to_vec(),
            "terminal_cleanup_effects" => vec![(
                "agent_terminal_sessions",
                "agent_run_id",
                "agent_run_id",
                "CASCADE",
            )],
            _ => vec![],
        };
        let mut observed_set = observed.into_iter().collect::<BTreeSet<_>>();
        let wanted_set = wanted
            .iter()
            .map(|(a, b, c, d)| (a.to_string(), b.to_string(), c.to_string(), d.to_string()))
            .collect::<BTreeSet<_>>();
        if observed_set != wanted_set {
            return Err(incompatible(format!(
                "unknown constraints for {table}: foreign keys {observed_set:?}"
            )));
        }
        observed_set.clear();
    }
    Ok(())
}

async fn validate_check_counts(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), TerminalPersistenceError> {
    let expected = expected_columns(source);
    for table in expected.keys() {
        let row = database
            .query_one_raw(Statement::from_sql_and_values(
                DbBackend::Sqlite,
                "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                [(*table).into()],
            ))
            .await
            .map_err(storage)?
            .unwrap();
        let sql = row
            .try_get::<String>("", "sql")
            .map_err(storage)?
            .to_ascii_lowercase();
        let observed = sql.match_indices("check").count();
        let wanted = match (source, *table) {
            (SourceClassification::RustOwned, "agent_terminal_sessions") => 3,
            (SourceClassification::RustOwned, "agent_run_viewer_leases") => 1,
            (SourceClassification::RustOwned, "terminal_launch_requests") => 5,
            (SourceClassification::RustOwned, "terminal_launch_material") => 6,
            (SourceClassification::RustOwned, "terminal_cleanup_effects") => 6,
            (SourceClassification::RustOwned, LEDGER_TABLE) => 2,
            (SourceClassification::Django(_), "terminal_launch_requests") => 3,
            _ => 0,
        };
        for fragment in required_check_fragments(source, table) {
            if !sql.contains(fragment) {
                return Err(incompatible(format!(
                    "unknown constraint for {table}: missing {fragment}"
                )));
            }
        }
        if observed != wanted {
            return Err(incompatible(format!(
                "unknown constraints for {table}: expected {wanted} checks, observed {observed}"
            )));
        }
    }
    Ok(())
}

fn required_check_fragments(source: SourceClassification, table: &str) -> &'static [&'static str] {
    match (source, table) {
        (SourceClassification::Django(_), "terminal_launch_requests") => {
            &["json_valid", "columns\" >= 0", "rows\" >= 0"]
        }
        (SourceClassification::RustOwned, "agent_terminal_sessions") => {
            &["scope in", "output_sequence >= 0", "scope = 'docchat'"]
        }
        (SourceClassification::RustOwned, "agent_run_viewer_leases") => &["transport in"],
        (SourceClassification::RustOwned, "terminal_launch_requests") => &[
            "scope in",
            "json_valid",
            "columns > 0",
            "rows > 0",
            "scope = 'docchat'",
        ],
        (SourceClassification::RustOwned, "terminal_launch_material") => &[
            "schema_version = 1",
            "scope in",
            "json_valid",
            "initial_columns > 0",
            "initial_rows > 0",
            "scope = 'docchat'",
        ],
        (SourceClassification::RustOwned, "terminal_cleanup_effects") => &[
            "cause in",
            "state in",
            "attempt_count >= 0",
            "json_valid",
            "state = 'leased'",
            "state = 'applied'",
        ],
        (SourceClassification::RustOwned, LEDGER_TABLE) => &["singleton = 1", "version = 1"],
        _ => &[],
    }
}

pub(super) async fn validate_semantics(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), TerminalPersistenceError> {
    let scopes = SCOPES
        .iter()
        .map(|s| format!("'{s}'"))
        .collect::<Vec<_>>()
        .join(",");
    let tables = expected_columns(source);
    let mut checks = Vec::new();
    if tables.contains_key("agent_terminal_sessions") {
        checks.extend([
            ("Terminal Session identity", format!("SELECT COUNT(*) AS count FROM agent_terminal_sessions WHERE agent_run_id='' OR tmux_session_name='' OR (tmux_session_name != agent_run_id AND tmux_session_name != ('{SESSION_PREFIX}' || agent_run_id))")),
            ("Terminal Session scope", format!("SELECT COUNT(*) AS count FROM agent_terminal_sessions WHERE scope NOT IN ({scopes}) OR ((scope='docchat') != (doc_rel_path IS NOT NULL))")),
            ("Terminal Session Agent Run", "SELECT COUNT(*) AS count FROM agent_terminal_sessions t LEFT JOIN agent_runs r ON r.id=t.agent_run_id WHERE r.id IS NULL".to_owned()),
        ]);
    }
    if tables.contains_key("agent_run_viewer_leases") {
        checks.push(("Viewer Lease Agent Run", "SELECT COUNT(*) AS count FROM agent_run_viewer_leases v LEFT JOIN agent_runs r ON r.id=v.agent_run_id WHERE r.id IS NULL".to_owned()));
    }
    if tables.contains_key("terminal_launch_requests") {
        checks.extend([
            ("Launch Request scope", format!("SELECT COUNT(*) AS count FROM terminal_launch_requests WHERE scope NOT IN ({scopes}) OR ((scope='docchat') != (doc_rel_path IS NOT NULL))")),
            ("Launch Request JSON", "SELECT COUNT(*) AS count FROM terminal_launch_requests WHERE NOT json_valid(environment) OR json_type(environment) != 'object'".to_owned()),
            ("Launch Request Agent Run", "SELECT COUNT(*) AS count FROM terminal_launch_requests l LEFT JOIN agent_runs r ON r.id=l.agent_run_id WHERE r.id IS NULL".to_owned()),
            ("Launch Request identity", "SELECT COUNT(*) AS count FROM (SELECT effect_id FROM terminal_launch_requests GROUP BY effect_id HAVING COUNT(*)>1) UNION ALL SELECT COUNT(*) FROM (SELECT agent_run_id FROM terminal_launch_requests GROUP BY agent_run_id HAVING COUNT(*)>1)".to_owned()),
        ]);
    }
    for (label, query) in checks {
        for row in database
            .query_all_raw(Statement::from_string(DbBackend::Sqlite, query))
            .await
            .map_err(storage)?
        {
            let count = row.try_get::<i64>("", "count").map_err(storage)?;
            if count != 0 {
                return Err(invalid(format!(
                    "semantically invalid {label}: {count} row(s)"
                )));
            }
        }
    }
    Ok(())
}
