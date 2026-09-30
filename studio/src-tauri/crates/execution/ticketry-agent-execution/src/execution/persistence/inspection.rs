use std::collections::BTreeSet;

use sea_orm::{ConnectionTrait, DbBackend, Statement};

use super::adoption::SourceClassification;
use super::schema::{self, DJANGO_MIGRATIONS, EMPTY_DJANGO_LEAF};
use super::{ExecutionPersistenceError, ExecutionPersistenceErrorCode};

pub(super) async fn classify(
    database: &impl ConnectionTrait,
) -> Result<SourceClassification, ExecutionPersistenceError> {
    if table_exists(database, "ticketry_execution_adoption").await? {
        let row = database
            .query_one_raw(Statement::from_string(
                DbBackend::Sqlite,
                "SELECT version FROM ticketry_execution_adoption WHERE singleton=1".to_owned(),
            ))
            .await
            .map_err(storage)?
            .ok_or_else(|| incompatible("Execution ownership ledger is incomplete"))?;
        let version = row.try_get::<i32>("", "version").map_err(storage)?;
        if version != schema::VERSION {
            return Err(incompatible(format!(
                "unknown Rust Execution schema version {version}"
            )));
        }
        return Ok(SourceClassification::RustOwned);
    }
    if !table_exists(database, "django_migrations").await? {
        return Err(incompatible(
            "Execution adoption requires Django migration history",
        ));
    }
    let migrations = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "SELECT name FROM django_migrations WHERE app='execution' ORDER BY name".to_owned(),
        ))
        .await
        .map_err(storage)?
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").map_err(storage))
        .collect::<Result<Vec<_>, _>>()?;
    let leaf = if migrations.is_empty() {
        EMPTY_DJANGO_LEAF
    } else {
        migrations
            .last()
            .and_then(|observed| DJANGO_MIGRATIONS.iter().find(|known| observed == *known))
            .copied()
            .ok_or_else(|| {
                incompatible("unknown Execution migration history; no named bridge matches")
            })?
    };
    let expected_len = if leaf == EMPTY_DJANGO_LEAF {
        0
    } else {
        DJANGO_MIGRATIONS
            .iter()
            .position(|migration| *migration == leaf)
            .expect("known leaf")
            + 1
    };
    if migrations != DJANGO_MIGRATIONS[..expected_len] {
        return Err(incompatible(
            "Execution migration history contains a gap or unknown migration",
        ));
    }
    Ok(SourceClassification::Django(leaf))
}

pub(super) async fn validate_manifest(
    database: &impl ConnectionTrait,
    source: SourceClassification,
) -> Result<(), ExecutionPersistenceError> {
    let generation = match source {
        SourceClassification::Django(leaf) => {
            if leaf == EMPTY_DJANGO_LEAF {
                0
            } else {
                DJANGO_MIGRATIONS
                    .iter()
                    .position(|migration| *migration == leaf)
                    .expect("known leaf")
                    + 1
            }
        }
        SourceClassification::RustOwned => DJANGO_MIGRATIONS.len(),
    };
    if generation >= 2 {
        let mut graph = set(&[
            "root_id",
            "agent",
            "created_at",
            "updated_at",
            "module_id",
            "project_id",
        ]);
        if generation >= 6 {
            graph.insert("execution_mode".to_owned());
        }
        if generation >= 7 {
            graph.insert("launch_configuration".to_owned());
        }
        exact_columns(database, "graph_runs", graph).await?;
        require_primary_key(database, "graph_runs", "root_id").await?;
        reject_unknown_constraints(database, "graph_runs", usize::from(generation >= 7)).await?;
    }
    if generation >= 5 {
        let rust_owned = source == SourceClassification::RustOwned;
        exact_columns(
            database,
            "launched_tasks",
            if rust_owned {
                set(schema::LAUNCH_LEDGER_COLUMNS)
            } else {
                set(&["task_id", "root_id", "agent_run_id", "launched_at"])
            },
        )
        .await?;
        require_primary_key(database, "launched_tasks", "task_id").await?;
        reject_unknown_constraints(database, "launched_tasks", usize::from(rust_owned)).await?;
    }
    if generation >= 7 {
        exact_columns(
            database,
            "launch_policy_effects",
            set(schema::POLICY_EFFECT_COLUMNS),
        )
        .await?;
        require_primary_key(database, "launch_policy_effects", "decision_id").await?;
        reject_unknown_constraints(database, "launch_policy_effects", 1).await?;
    }
    if source == SourceClassification::RustOwned {
        exact_columns(database, "graph_runs", set(schema::GRAPH_RUN_COLUMNS)).await?;
    }
    Ok(())
}

async fn reject_unknown_constraints(
    database: &impl ConnectionTrait,
    table: &str,
    expected_checks: usize,
) -> Result<(), ExecutionPersistenceError> {
    let row = database
        .query_one_raw(Statement::from_sql_and_values(
            DbBackend::Sqlite,
            "SELECT COALESCE(sql,'') AS sql FROM sqlite_master WHERE type='table' AND name=?",
            [table.into()],
        ))
        .await
        .map_err(storage)?
        .ok_or_else(|| incompatible(format!("Execution schema is missing {table}")))?;
    let sql = row.try_get::<String>("", "sql").map_err(storage)?;
    let check_count = sql.to_ascii_uppercase().matches("CHECK").count();
    if check_count != expected_checks {
        return Err(incompatible(format!("unknown constraint on {table}")));
    }
    Ok(())
}

async fn exact_columns(
    database: &impl ConnectionTrait,
    table: &str,
    expected: BTreeSet<String>,
) -> Result<(), ExecutionPersistenceError> {
    let observed = schema::columns(database, table).await?;
    if observed != expected {
        return Err(incompatible(format!(
            "unknown schema for {table}: observed {observed:?}"
        )));
    }
    Ok(())
}

async fn require_primary_key(
    database: &impl ConnectionTrait,
    table: &str,
    expected: &str,
) -> Result<(), ExecutionPersistenceError> {
    let keys = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await
        .map_err(storage)?
        .into_iter()
        .filter_map(|row| {
            let order = row.try_get::<i32>("", "pk").ok()?;
            (order > 0)
                .then(|| row.try_get::<String>("", "name").ok())
                .flatten()
        })
        .collect::<Vec<_>>();
    if keys != [expected] {
        return Err(incompatible(format!(
            "unknown primary-key constraint on {table}: observed {keys:?}"
        )));
    }
    Ok(())
}

pub(super) async fn validate_semantics(
    database: &impl ConnectionTrait,
) -> Result<(), ExecutionPersistenceError> {
    if table_exists(database, "engine_runs").await?
        && count(database, "SELECT COUNT(*) AS count FROM engine_runs").await? != 0
    {
        return Err(invalid(
            "legacy pre-claim launch rows have ambiguous active work",
        ));
    }
    if !table_exists(database, "graph_runs").await? {
        return Ok(());
    }
    let checks = [
        ("Graph Run root and scope", "SELECT COUNT(*) AS count FROM graph_runs g LEFT JOIN worktracker_issue root ON root.id=g.root_id LEFT JOIN worktracker_project project ON project.id=g.project_id LEFT JOIN worktracker_issue module ON module.id=g.module_id WHERE root.id IS NULL OR project.id IS NULL OR module.id IS NULL OR root.type<>'task' OR module.type<>'module' OR root.project_id<>g.project_id OR module.project_id<>g.project_id"),
        ("duplicate Graph Run root assignment", "SELECT COUNT(*) AS count FROM (SELECT root_id FROM graph_runs GROUP BY root_id HAVING COUNT(*)<>1)"),
        ("Graph Run module ancestry", "WITH RECURSIVE ancestry(root_id,id,parent_id) AS (SELECT g.root_id,i.id,i.parent_id FROM graph_runs g JOIN worktracker_issue i ON i.id=g.root_id UNION ALL SELECT ancestry.root_id,parent.id,parent.parent_id FROM ancestry JOIN worktracker_issue parent ON parent.id=ancestry.parent_id) SELECT COUNT(*) AS count FROM graph_runs g WHERE NOT EXISTS (SELECT 1 FROM ancestry WHERE ancestry.root_id=g.root_id AND ancestry.id=g.module_id)"),
        ("Graph Run timestamps", "SELECT COUNT(*) AS count FROM graph_runs WHERE datetime(created_at) IS NULL OR datetime(updated_at) IS NULL OR datetime(updated_at)<datetime(created_at)"),
    ];
    for (label, query) in checks {
        require_zero(database, label, query).await?;
    }
    let graph_columns = schema::columns(database, "graph_runs").await?;
    if graph_columns.contains("execution_mode") {
        require_zero(database, "Graph Run execution mode", "SELECT COUNT(*) AS count FROM graph_runs WHERE execution_mode NOT IN ('parallel','serial') OR execution_mode IS NULL").await?;
    }
    if graph_columns.contains("launch_configuration") {
        require_zero(database, "Graph Run policy snapshot", "SELECT COUNT(*) AS count FROM graph_runs WHERE launch_configuration IS NOT NULL AND (NOT json_valid(launch_configuration) OR json_type(launch_configuration)<>'object' OR COALESCE(json_extract(launch_configuration,'$.policy_version'),1)<>1 OR json_type(launch_configuration,'$.required_skills') NOT IN ('array','null') OR json_type(launch_configuration,'$.prompt') NOT IN ('text','null') OR json_type(launch_configuration,'$.agent') NOT IN ('text','null'))").await?;
    }
    if table_exists(database, "launched_tasks").await? {
        let checks = [
            ("launch ledger root", "SELECT COUNT(*) AS count FROM launched_tasks claim LEFT JOIN graph_runs graph ON graph.root_id=claim.root_id WHERE graph.root_id IS NULL"),
            ("duplicate launch ledger child assignment", "SELECT COUNT(*) AS count FROM (SELECT task_id FROM launched_tasks GROUP BY task_id HAVING COUNT(*)<>1)"),
            ("launch ledger direct child", "SELECT COUNT(*) AS count FROM launched_tasks claim LEFT JOIN worktracker_issue child ON child.id=claim.task_id WHERE child.id IS NULL OR child.parent_id<>claim.root_id OR child.type<>'task'"),
            ("launch ledger timestamp", "SELECT COUNT(*) AS count FROM launched_tasks WHERE datetime(launched_at) IS NULL"),
        ];
        for (label, query) in checks {
            require_zero(database, label, query).await?;
        }
        let claim_columns = schema::columns(database, "launched_tasks").await?;
        if claim_columns.contains("claim_id") {
            for (label, query) in [
                ("campaign claim identity", "SELECT COUNT(*) AS count FROM launched_tasks WHERE length(claim_id)<>32 OR claim_id='' OR launch_generation<1"),
                ("duplicate campaign claim identity", "SELECT COUNT(*) AS count FROM (SELECT claim_id FROM launched_tasks GROUP BY claim_id HAVING COUNT(*)<>1)"),
                ("duplicate campaign effect identity", "SELECT COUNT(*) AS count FROM (SELECT launch_effect_id FROM launched_tasks GROUP BY launch_effect_id HAVING COUNT(*)<>1)"),
            ] {
                require_zero(database, label, query).await?;
            }
            if count(database, "SELECT COUNT(*) AS count FROM launched_tasks").await? != 0 {
                require_zero(database, "campaign claim Launch Effect", "SELECT COUNT(*) AS count FROM launched_tasks claim LEFT JOIN runs_launch_effects effect ON effect.effect_id=claim.launch_effect_id WHERE effect.effect_id IS NULL OR effect.agent_run_id<>claim.agent_run_id OR effect.issue_id<>claim.task_id").await?;
            }
        }
        if count(database, "SELECT COUNT(*) AS count FROM launched_tasks").await? != 0 {
            if !table_exists(database, "agent_runs").await? {
                return Err(invalid("launch ledger rows lack Agent Run identities"));
            }
            require_zero(database, "launch ledger Agent Run", "SELECT COUNT(*) AS count FROM launched_tasks claim LEFT JOIN agent_runs run ON run.id=claim.agent_run_id WHERE run.id IS NULL OR run.issue_id<>claim.task_id").await?;
            validate_runtime_evidence(database).await?;
        }
    }
    if table_exists(database, "launch_policy_effects").await? {
        require_zero(database, "launch policy receipt JSON", "SELECT COUNT(*) AS count FROM launch_policy_effects WHERE result IS NOT NULL AND (NOT json_valid(result) OR json_type(result)<>'object')").await?;
        require_zero(database, "launch policy receipt timestamps", "SELECT COUNT(*) AS count FROM launch_policy_effects WHERE datetime(created_at) IS NULL OR datetime(updated_at) IS NULL OR datetime(updated_at)<datetime(created_at)").await?;
    }
    Ok(())
}

async fn validate_runtime_evidence(
    database: &impl ConnectionTrait,
) -> Result<(), ExecutionPersistenceError> {
    let active = count(database, "SELECT COUNT(*) AS count FROM launched_tasks claim JOIN agent_runs run ON run.id=claim.agent_run_id WHERE run.ended_at IS NULL").await?;
    if active == 0 {
        return Ok(());
    }
    if !table_exists(database, "agent_terminal_sessions").await? {
        return Err(invalid(
            "active launch ledger rows lack Terminal runtime evidence",
        ));
    }
    // Terminal Sessions store the hyphenated Work Item identity Django wrote,
    // while the campaign ledger stores the compact one. The two forms name the
    // same Work Item, so this comparison normalises before deciding a runtime
    // belongs to different work.
    //
    // A crash-safe claim commits before its external effect runs, so a claim
    // whose Launch Effect has not been applied legitimately has no Terminal
    // Session yet. That is interrupted work for launch reconciliation to
    // settle, not an ambiguous runtime, and refusing it would make a crash
    // between claim and runtime unrecoverable. Pre-claim Django rows have no
    // effect identity and were only ever written after the launch returned, so
    // they keep the stricter rule.
    let crash_safe = schema::columns(database, "launched_tasks")
        .await?
        .contains("launch_effect_id");
    let effect_join = if crash_safe {
        " LEFT JOIN runs_launch_effects effect ON effect.effect_id=claim.launch_effect_id"
    } else {
        ""
    };
    let settled = if crash_safe {
        " AND effect.state='applied'"
    } else {
        ""
    };
    require_zero(
        database,
        "ambiguous active launch",
        &format!(
            "SELECT COUNT(*) AS count FROM launched_tasks claim \
             JOIN agent_runs run ON run.id=claim.agent_run_id \
             LEFT JOIN agent_terminal_sessions terminal ON terminal.agent_run_id=run.id{effect_join} \
             WHERE (run.ended_at IS NULL{settled} AND (terminal.agent_run_id IS NULL \
             OR terminal.terminated_at IS NOT NULL \
             OR replace(terminal.task_id,'-','')<>replace(claim.task_id,'-',''))) \
             OR (run.ended_at IS NOT NULL AND terminal.agent_run_id IS NOT NULL \
             AND terminal.terminated_at IS NULL)"
        ),
    )
    .await
}

async fn require_zero(
    database: &impl ConnectionTrait,
    label: &str,
    query: &str,
) -> Result<(), ExecutionPersistenceError> {
    let invalid_rows = count(database, query).await?;
    if invalid_rows != 0 {
        return Err(invalid(format!(
            "semantically invalid {label}: {invalid_rows} row(s)"
        )));
    }
    Ok(())
}

async fn count(
    database: &impl ConnectionTrait,
    query: &str,
) -> Result<i64, ExecutionPersistenceError> {
    database
        .query_one_raw(Statement::from_string(DbBackend::Sqlite, query.to_owned()))
        .await
        .map_err(storage)?
        .ok_or_else(|| invalid("Execution validation query returned no row"))?
        .try_get::<i64>("", "count")
        .map_err(storage)
}

pub(super) async fn integrity(
    database: &impl ConnectionTrait,
) -> Result<(), ExecutionPersistenceError> {
    let result = database
        .query_one_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA integrity_check".to_owned(),
        ))
        .await
        .map_err(storage)?
        .ok_or_else(|| invalid("SQLite integrity check returned no result"))?
        .try_get::<String>("", "integrity_check")
        .map_err(storage)?;
    if result != "ok" {
        return Err(invalid("SQLite integrity check failed"));
    }
    if !database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            "PRAGMA foreign_key_check".to_owned(),
        ))
        .await
        .map_err(storage)?
        .is_empty()
    {
        return Err(invalid("Execution database has foreign-key violations"));
    }
    Ok(())
}

pub(super) async fn table_exists(
    database: &impl ConnectionTrait,
    table: &str,
) -> Result<bool, ExecutionPersistenceError> {
    Ok(count(
        database,
        &format!(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='{table}'"
        ),
    )
    .await?
        == 1)
}

fn set(values: &[&str]) -> BTreeSet<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn storage(source: sea_orm::DbErr) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(
        ExecutionPersistenceErrorCode::AdoptionUnavailable,
        format!("Execution adoption storage operation failed: {source}"),
    )
}
fn incompatible(message: impl Into<String>) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(ExecutionPersistenceErrorCode::IncompatibleSchema, message)
}
fn invalid(message: impl Into<String>) -> ExecutionPersistenceError {
    ExecutionPersistenceError::new(ExecutionPersistenceErrorCode::InvalidHistory, message)
}
