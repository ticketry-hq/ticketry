//! PostgreSQL access is confined to one read-only repeatable-read snapshot.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use sea_orm::{
    AccessMode, ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DatabaseTransaction,
    DbBackend, IsolationLevel, Statement, TransactionTrait,
};

use super::canonical::{Cell, Kind};
use super::failed;
use crate::installation_adoption::{AdoptionFailure, Phase, Refusal};
use crate::installation_classification::manifest::manifest;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Column {
    pub name: String,
    pub kind: Kind,
    data_type: String,
}

pub struct Snapshot {
    connection: DatabaseConnection,
    transaction: DatabaseTransaction,
}

pub fn read_dsn(marker: &Path) -> Result<String, AdoptionFailure> {
    let dsn = fs::read_to_string(marker).map_err(|error| {
        failed(
            Phase::Classification,
            Refusal::UnsupportedSource,
            format!("the PostgreSQL connection marker could not be read: {error}"),
        )
    })?;
    let dsn = dsn.trim();
    if !(dsn.starts_with("postgres://") || dsn.starts_with("postgresql://")) {
        return Err(failed(
            Phase::Classification,
            Refusal::UnsupportedSource,
            "the PostgreSQL connection marker has an unsupported scheme",
        ));
    }
    if let Some((scheme, database)) = dsn.split_once(":///") {
        let user = std::env::var("PGUSER")
            .or_else(|_| std::env::var("USER"))
            .map_err(|_| {
                failed(
                    Phase::Classification,
                    Refusal::UnsupportedSource,
                    "a local PostgreSQL marker without a user requires PGUSER or USER",
                )
            })?;
        if user.is_empty()
            || !user
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        {
            return Err(failed(
                Phase::Classification,
                Refusal::UnsupportedSource,
                "the local PostgreSQL role cannot be represented safely in a connection URL",
            ));
        }
        return Ok(format!("{scheme}://{user}@localhost/{database}"));
    }
    Ok(dsn.to_owned())
}

impl Snapshot {
    pub async fn open(dsn: &str) -> Result<Self, AdoptionFailure> {
        let mut options = ConnectOptions::new(dsn);
        options
            .max_connections(1)
            .min_connections(1)
            .sqlx_logging(false);
        let connection = Database::connect(options).await.map_err(|error| {
            failed(
                Phase::Preflight,
                Refusal::SemanticRefusal,
                format!("the PostgreSQL source could not be opened read-only: {error}"),
            )
        })?;
        let transaction = connection
            .begin_with_config(
                Some(IsolationLevel::RepeatableRead),
                Some(AccessMode::ReadOnly),
            )
            .await
            .map_err(|error| {
                failed(
                    Phase::Preflight,
                    Refusal::SemanticRefusal,
                    format!("a consistent read-only PostgreSQL snapshot could not start: {error}"),
                )
            })?;
        Ok(Self {
            connection,
            transaction,
        })
    }

    pub async fn classify(&self) -> Result<String, AdoptionFailure> {
        let rows = self
            .transaction
            .query_all_raw(Statement::from_string(
                DbBackend::Postgres,
                "SELECT app, name FROM django_migrations ORDER BY app, name".to_owned(),
            ))
            .await
            .map_err(|error| {
                source_error(format!("the migration ledger could not be read: {error}"))
            })?;
        let checked = manifest();
        let mut applied = BTreeSet::new();
        for row in rows {
            let app = row.try_get::<String>("", "app").map_err(|error| {
                source_error(format!("a migration app could not be read: {error}"))
            })?;
            let name = row.try_get::<String>("", "name").map_err(|error| {
                source_error(format!("a migration name could not be read: {error}"))
            })?;
            if checked.product_apps.contains(&app) {
                if !checked.knows_product_migration(&app, &name) {
                    return Err(source_error(format!(
                        "{app}.{name} is newer than this Ticketry release"
                    )));
                }
                applied.insert(format!("{app}.{name}"));
            } else if !checked.knows_framework_migration(&app, &name) {
                return Err(source_error(format!(
                    "{app}.{name} is not a recognized framework migration"
                )));
            }
        }
        let missing = checked.missing_dependencies(&applied);
        if !missing.is_empty() {
            return Err(source_error(format!(
                "the PostgreSQL migration ledger is partial, starting at {}",
                missing[0]
            )));
        }
        checked
            .generation_for(&applied)
            .map(|generation| generation.name.clone())
            .ok_or_else(|| {
                source_error(format!(
                    "{} applied product migrations describe no supported generation",
                    applied.len()
                ))
            })
    }

    pub async fn tables(&self) -> Result<Vec<String>, AdoptionFailure> {
        let rows = self
            .transaction
            .query_all_raw(Statement::from_string(
                DbBackend::Postgres,
                "SELECT table_name FROM information_schema.tables \
                 WHERE table_schema = 'public' AND table_type = 'BASE TABLE' \
                 ORDER BY table_name"
                    .to_owned(),
            ))
            .await
            .map_err(|error| {
                source_error(format!("PostgreSQL tables could not be listed: {error}"))
            })?;
        rows.into_iter()
            .map(|row| {
                row.try_get::<String>("", "table_name").map_err(|error| {
                    source_error(format!(
                        "a PostgreSQL table name could not be read: {error}"
                    ))
                })
            })
            .collect()
    }

    pub async fn columns(&self, table: &str) -> Result<Vec<Column>, AdoptionFailure> {
        let rows = self
            .transaction
            .query_all_raw(Statement::from_sql_and_values(
                DbBackend::Postgres,
                "SELECT column_name, data_type, udt_name FROM information_schema.columns \
                 WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
                [table.to_owned().into()],
            ))
            .await
            .map_err(|error| {
                source_error(format!("columns for {table} could not be listed: {error}"))
            })?;
        rows.into_iter()
            .map(|row| {
                let name = row
                    .try_get::<String>("", "column_name")
                    .map_err(|error| source_error(error.to_string()))?;
                let data_type = row
                    .try_get::<String>("", "data_type")
                    .map_err(|error| source_error(error.to_string()))?;
                let udt_name = row
                    .try_get::<String>("", "udt_name")
                    .map_err(|error| source_error(error.to_string()))?;
                Ok(Column {
                    name,
                    kind: Kind::from_postgres(&data_type, &udt_name),
                    data_type,
                })
            })
            .collect()
    }

    pub async fn rows(
        &self,
        table: &str,
        columns: &[Column],
    ) -> Result<Vec<Vec<Cell>>, AdoptionFailure> {
        let select = columns
            .iter()
            .enumerate()
            .map(|(index, column)| format!("{} AS c{index}", expression(column)))
            .collect::<Vec<_>>()
            .join(", ");
        let query = format!("SELECT {select} FROM {}", quoted(table));
        let rows = self
            .transaction
            .query_all_raw(Statement::from_string(DbBackend::Postgres, query))
            .await
            .map_err(|error| {
                source_error(format!("rows from {table} could not be read: {error}"))
            })?;
        rows.into_iter()
            .map(|row| {
                columns
                    .iter()
                    .enumerate()
                    .map(|(index, column)| {
                        let value = row
                            .try_get::<Option<String>>("", &format!("c{index}"))
                            .map_err(|error| {
                                source_error(format!(
                                    "{table}.{} could not be read: {error}",
                                    column.name
                                ))
                            })?;
                        Cell::from_postgres(column.kind, value).map_err(|error| {
                            source_error(format!("{table}.{}: {error}", column.name))
                        })
                    })
                    .collect()
            })
            .collect()
    }

    pub async fn close(self) -> Result<(), sea_orm::DbErr> {
        self.transaction.rollback().await?;
        self.connection.close().await
    }
}

fn expression(column: &Column) -> String {
    let name = quoted(&column.name);
    match column.kind {
        Kind::Boolean => {
            format!("CASE WHEN {name} IS NULL THEN NULL WHEN {name} THEN '1' ELSE '0' END")
        }
        Kind::DateTime if column.data_type == "timestamp with time zone" => format!(
            "CASE WHEN {name} IS NULL THEN NULL ELSE to_char({name} AT TIME ZONE 'UTC', \
             'YYYY-MM-DD HH24:MI:SS.US') END"
        ),
        Kind::DateTime if column.data_type == "timestamp without time zone" => format!(
            "CASE WHEN {name} IS NULL THEN NULL ELSE to_char({name}, \
             'YYYY-MM-DD HH24:MI:SS.US') END"
        ),
        Kind::DateTime => format!("{name}::text"),
        Kind::Json => format!("CASE WHEN {name} IS NULL THEN NULL ELSE {name}::jsonb::text END"),
        Kind::Binary => {
            format!("CASE WHEN {name} IS NULL THEN NULL ELSE encode({name}, 'base64') END")
        }
        Kind::Uuid | Kind::Decimal | Kind::Integer | Kind::Real | Kind::Text => {
            format!("{name}::text")
        }
    }
}

fn quoted(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

fn source_error(detail: String) -> AdoptionFailure {
    failed(Phase::Preflight, Refusal::SemanticRefusal, detail)
}

#[cfg(test)]
mod tests {
    use super::{expression, read_dsn, Column};
    use crate::installation_import::canonical::Kind;

    #[test]
    fn source_expressions_are_reads_and_encode_binary_explicitly() {
        let expression = expression(&Column {
            name: "payload".into(),
            kind: Kind::Binary,
            data_type: "bytea".into(),
        });
        assert_eq!(
            expression,
            "CASE WHEN \"payload\" IS NULL THEN NULL ELSE encode(\"payload\", 'base64') END"
        );
        for forbidden in ["INSERT", "UPDATE", "DELETE", "ALTER", "DROP"] {
            assert!(!expression.contains(forbidden));
        }
    }

    #[test]
    fn local_django_style_dsn_binds_the_operating_system_role() {
        let directory = tempfile::tempdir().unwrap();
        let marker = directory.path().join("database-url");
        std::fs::write(&marker, "postgresql:///ticketry?sslmode=disable\n").unwrap();
        let dsn = read_dsn(&marker).unwrap();
        assert!(dsn.starts_with("postgresql://"));
        assert!(dsn.contains("@localhost/ticketry?sslmode=disable"));
    }
}
