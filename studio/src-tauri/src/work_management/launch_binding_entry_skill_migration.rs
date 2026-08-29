//! Give a launch binding the one skill its launch enters through.
//!
//! Source commit `3a5f434a90696f40a4911e401a84db009cdfa4e7`, migration `0047`.
//! `entry_skill` is nullable, holds a bare skill slug, and is only ever seeded
//! where the reviewed catalog names an entry skill *and* the binding already
//! requires it. A binding that requires nothing keeps a null entry.
//!
//! Every read and write runs through the connection the caller supplies inside
//! one transaction it owns, so a database is either fully migrated or
//! untouched, and the ledger written here makes a second startup a no-op.

use sea_orm::{
    sea_query::{Alias, ColumnDef, Expr, IntoIden, Query, Table},
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait, ExprTrait,
    QueryFilter, Statement, TransactionTrait,
};

use super::commands::reviewed_defaults;
use super::entities::{issue_type, launch_binding, state};

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "20260828-0930-launch-binding-entry-skill-v1";
pub const LEDGER_TABLE: &str = "ticketry_launch_binding_entry_skill_migration";
pub const SOURCE_COMMIT: &str = "3a5f434a90696f40a4911e401a84db009cdfa4e7";

const LAUNCH_BINDING_TABLE: &str = "worktracker_launchbinding";
pub const ENTRY_SKILL_COLUMN: &str = "entry_skill";

/// Apply the migration once, or confirm it has already been applied.
pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        verify_ledger(&transaction).await?;
        if table_exists(&transaction, LAUNCH_BINDING_TABLE).await?
            && !column_exists(&transaction, LAUNCH_BINDING_TABLE, ENTRY_SKILL_COLUMN).await?
        {
            return Err(DbErr::Custom(
                "entry-skill migration ledger exists but the column is absent".to_owned(),
            ));
        }
        transaction.commit().await?;
        return Ok(());
    }

    if table_exists(&transaction, LAUNCH_BINDING_TABLE).await? {
        add_entry_skill_column(&transaction).await?;
        seed_reviewed_entry_skills(&transaction).await?;
    }

    write_ledger(&transaction).await?;
    transaction.commit().await?;
    Ok(())
}

/// Whether this migration has already run against `database`.
///
/// Adoption asks this to know which of the two launch-binding shapes it is
/// looking at, because it runs before the migration on a first launch and
/// after it on every launch that follows.
pub async fn applied(database: &impl ConnectionTrait) -> Result<bool, DbErr> {
    table_exists(database, LEDGER_TABLE).await
}

/// Whether the launch-binding table already carries the migrated column.
pub async fn has_entry_skill_column(
    database: &impl ConnectionTrait,
) -> Result<bool, DbErr> {
    if !table_exists(database, LAUNCH_BINDING_TABLE).await? {
        return Ok(false);
    }
    column_exists(database, LAUNCH_BINDING_TABLE, ENTRY_SKILL_COLUMN).await
}

/// Give the launch binding its nullable entry skill.
async fn add_entry_skill_column(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if column_exists(database, LAUNCH_BINDING_TABLE, ENTRY_SKILL_COLUMN).await? {
        return Ok(());
    }
    let statement = Table::alter()
        .table(launch_binding::Entity)
        .add_column(
            // `varchar(128)` rather than sea-query's `string`, so a migrated
            // column is declared exactly as a freshly provisioned one.
            ColumnDef::new(launch_binding::Column::EntrySkill)
                .custom(Alias::new("varchar(128)"))
                .null(),
        )
        .to_owned();
    database.execute(&statement).await?;
    Ok(())
}

/// Adopt the reviewed entry skill for the states that already require it.
///
/// A row is only written when its state carries the reviewed entry skill in
/// `required_skills`, so a hand-edited binding that dropped the skill keeps a
/// null entry. Rows that already name an entry skill are left as they are,
/// which is what makes a repeat run change nothing.
async fn seed_reviewed_entry_skills(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let (reviewed_issue_types, entry_skills) = reviewed_defaults::entry_skill_seeds()
        .map_err(|error| DbErr::Custom(format!("could not read reviewed defaults: {error}")))?;
    let reviewed_type_ids = issue_type::Entity::find()
        .filter(issue_type::Column::Name.is_in(reviewed_issue_types))
        .all(database)
        .await?
        .into_iter()
        .map(|row| row.id)
        .collect::<Vec<_>>();
    if reviewed_type_ids.is_empty() {
        return Ok(());
    }
    for (state_name, skill) in entry_skills {
        let state_ids = state::Entity::find()
            .filter(state::Column::Name.eq(state_name))
            .all(database)
            .await?
            .into_iter()
            .map(|row| row.id)
            .collect::<Vec<_>>();
        if state_ids.is_empty() {
            continue;
        }
        for row in launch_binding::Entity::find()
            .filter(launch_binding::Column::StateId.is_in(state_ids))
            .filter(launch_binding::Column::IssueTypeId.is_in(reviewed_type_ids.clone()))
            .all(database)
            .await?
        {
            if row.entry_skill.is_some() || !requires(&row, &skill) {
                continue;
            }
            launch_binding::Entity::update_many()
                .col_expr(
                    launch_binding::Column::EntrySkill,
                    Expr::value(skill.clone()),
                )
                .filter(launch_binding::Column::Id.eq(row.id))
                .exec(database)
                .await?;
        }
    }
    Ok(())
}

/// Whether a stored binding already requires `skill`.
fn requires(row: &launch_binding::Model, skill: &str) -> bool {
    row.required_skills
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|value| value.as_str())
        .any(|value| value == skill)
}

async fn write_ledger(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let table = Table::create()
        .table(Alias::new(LEDGER_TABLE))
        .col(
            ColumnDef::new(Alias::new("singleton"))
                .integer()
                .primary_key()
                .check(Expr::col(Alias::new("singleton")).eq(1)),
        )
        .col(
            ColumnDef::new(Alias::new("version"))
                .integer()
                .not_null()
                .check(Expr::col(Alias::new("version")).eq(VERSION)),
        )
        .col(ColumnDef::new(Alias::new("migration_id")).text().not_null())
        .col(
            ColumnDef::new(Alias::new("source_commit"))
                .text()
                .not_null(),
        )
        .col(
            ColumnDef::new(Alias::new("applied_at"))
                .text()
                .not_null()
                .default(Expr::current_timestamp()),
        )
        .to_owned();
    database.execute(&table).await?;

    let insert = Query::insert()
        .into_table(Alias::new(LEDGER_TABLE))
        .columns([
            Alias::new("singleton").into_iden(),
            Alias::new("version").into_iden(),
            Alias::new("migration_id").into_iden(),
            Alias::new("source_commit").into_iden(),
        ])
        .values_panic([1.into(), VERSION.into(), MIGRATION_ID.into(), SOURCE_COMMIT.into()])
        .to_owned();
    database.execute(&insert).await?;
    Ok(())
}

async fn verify_ledger(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let statement = Query::select()
        .columns([
            Alias::new("version").into_iden(),
            Alias::new("migration_id").into_iden(),
            Alias::new("source_commit").into_iden(),
        ])
        .from(Alias::new(LEDGER_TABLE))
        .and_where(Expr::col(Alias::new("singleton")).eq(1))
        .to_owned();
    let row = database
        .query_one(&statement)
        .await?
        .ok_or_else(|| DbErr::Custom("entry-skill migration ledger is empty".to_owned()))?;
    let version = row.try_get::<i32>("", "version")?;
    let migration_id = row.try_get::<String>("", "migration_id")?;
    let source_commit = row.try_get::<String>("", "source_commit")?;
    if version != VERSION || migration_id != MIGRATION_ID || source_commit != SOURCE_COMMIT {
        return Err(DbErr::Custom(format!(
            "unsupported entry-skill migration {migration_id} at version {version}"
        )));
    }
    Ok(())
}

async fn table_exists(database: &impl ConnectionTrait, table: &str) -> Result<bool, DbErr> {
    let statement = Query::select()
        .column(Alias::new("name"))
        .from(Alias::new("sqlite_master"))
        .and_where(Expr::col(Alias::new("type")).eq("table"))
        .and_where(Expr::col(Alias::new("name")).eq(table))
        .to_owned();
    Ok(database.query_one(&statement).await?.is_some())
}

/// Whether a column is present right now, asked of SQLite rather than an entity.
///
/// The migration runs against both the shape it is leaving and the shape it is
/// creating, and an entity is a compile-time claim about exactly one of them.
/// `PRAGMA table_info` reports what the database actually has, and SQLite's
/// pragmas have no SeaORM equivalent.
async fn column_exists(
    database: &impl ConnectionTrait,
    table: &str,
    column: &str,
) -> Result<bool, DbErr> {
    let rows = database
        .query_all_raw(Statement::from_string(
            DbBackend::Sqlite,
            format!("PRAGMA table_info('{table}')"),
        ))
        .await?;
    for row in rows {
        if row.try_get::<String>("", "name")? == column {
            return Ok(true);
        }
    }
    Ok(false)
}
