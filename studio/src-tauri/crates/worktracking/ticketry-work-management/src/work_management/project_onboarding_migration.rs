//! Move onboarding onto Project and remove the Workspace table.
//!
//! Source commit `3a5f434a90696f40a4911e401a84db009cdfa4e7`, migrations
//! `0045_project_onboarding_required` and `0046_remove_workspace`. Onboarding
//! stops being a one-row Workspace flag and becomes a Project responsibility,
//! project slugs become globally unique, and the Workspace table leaves the
//! schema entirely.
//!
//! Every read and write here runs through the connection the caller supplies,
//! inside one transaction it owns. A failure anywhere rolls the whole migration
//! back, so a database is either fully migrated or untouched — and the ledger
//! this writes makes a second startup a no-op.
//!
//! Project statements go through its SeaORM entity, and the tables this
//! migration only ever removes — Workspace, and the ledger it writes — go
//! through SeaORM's schema and query builders under their own identifiers,
//! because an entity for a table being dropped would outlive the schema it
//! describes. The single raw statement left is `PRAGMA table_info`, which
//! reports what the database currently has rather than what an entity claims.

use sea_orm::{
    sea_query::{Alias, CaseStatement, ColumnDef, Expr, Index, IntoIden, Query, Table},
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, DbErr, EntityTrait, ExprTrait,
    Order, QueryFilter, QueryOrder, QuerySelect, Statement, TransactionTrait,
};

use ticketry_entities::project;

pub const VERSION: i32 = 1;
pub const MIGRATION_ID: &str = "20260827-1520-project-onboarding-and-workspace-removal-v1";
pub const LEDGER_TABLE: &str = "ticketry_project_onboarding_migration";
pub const SOURCE_COMMIT: &str = "3a5f434a90696f40a4911e401a84db009cdfa4e7";

/// Slugs the installation project is recognized by, most preferred first.
///
/// `CDN` is what onboarding creates today and `CODING` is what earlier
/// installations were given. The frontend's default-project resolution reads
/// them in the same order, so startup, MCP discovery, and this migration all
/// name the same installation project.
pub const PREFERRED_PROJECT_SLUGS: &[&str] = &["CDN", "CODING"];

/// The Workspace-shaped index and column names this migration removes.
const WORKSPACE_SCOPED_INDEXES: &[&str] = &[
    "worktracker_project_workspace_id_7196ac72",
    "worktracker_project_workspace_id_slug_80399ba5_uniq",
];
const GLOBAL_SLUG_INDEX: &str = "worktracker_project_slug_key";
const WORKSPACE_ID_COLUMN: &str = "workspace_id";

const PROJECT_TABLE: &str = "worktracker_project";
const WORKSPACE_TABLE: &str = "worktracker_workspace";

/// Apply the migration once, or confirm it has already been applied.
pub async fn install(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    if table_exists(&transaction, LEDGER_TABLE).await? {
        verify_ledger(&transaction).await?;
        transaction.commit().await?;
        return Ok(());
    }

    if table_exists(&transaction, PROJECT_TABLE).await? {
        add_onboarding_column(&transaction).await?;
        transfer_onboarding_state(&transaction).await?;
        resolve_duplicate_slugs(&transaction).await?;
        remove_workspace_reference(&transaction).await?;
    }
    drop_workspace_table(&transaction).await?;

    write_ledger(&transaction).await?;
    transaction.commit().await?;
    Ok(())
}

/// Give Project its own onboarding flag, defaulting to "already onboarded".
///
/// The default is deliberately false. A true value only ever arrives by being
/// transferred from a Workspace that actually asked for onboarding, so this
/// step cannot turn a false value true.
async fn add_onboarding_column(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if column_exists(database, PROJECT_TABLE, "onboarding_required").await? {
        return Ok(());
    }
    let statement = Table::alter()
        .table(project::Entity)
        .add_column(
            // `bool` rather than sea-query's `boolean`, so a migrated column is
            // declared exactly as a freshly provisioned one.
            ColumnDef::new(project::Column::OnboardingRequired)
                .custom(Alias::new("bool"))
                .not_null()
                .default(false),
        )
        .to_owned();
    database.execute(&statement).await?;
    Ok(())
}

/// Carry a pending Workspace onboarding state onto the installation project.
///
/// A false Workspace value writes nothing: the column default already says no
/// onboarding is pending, and a write here could only ever raise the flag.
async fn transfer_onboarding_state(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    if !workspace_requires_onboarding(database).await? {
        return Ok(());
    }
    let Some(project_id) = installation_project_id(database).await? else {
        return Ok(());
    };
    project::Entity::update_many()
        .col_expr(project::Column::OnboardingRequired, Expr::value(true))
        .filter(project::Column::Id.eq(project_id))
        .exec(database)
        .await?;
    Ok(())
}

/// Whether the installation's Workspace still asks for onboarding.
///
/// Workspace is a one-row model, so the oldest row is the installation's. The
/// tie-break on id keeps the answer identical across repeated runs and across
/// databases that happen to share a timestamp.
async fn workspace_requires_onboarding(database: &impl ConnectionTrait) -> Result<bool, DbErr> {
    if !table_exists(database, WORKSPACE_TABLE).await? {
        return Ok(false);
    }
    let statement = Query::select()
        .column(Alias::new("onboarding_required"))
        .from(Alias::new(WORKSPACE_TABLE))
        .order_by(Alias::new("created_at"), Order::Asc)
        .order_by(Alias::new("id"), Order::Asc)
        .limit(1)
        .to_owned();
    match database.query_one(&statement).await? {
        Some(row) => Ok(row.try_get::<i32>("", "onboarding_required")? != 0),
        None => Ok(false),
    }
}

/// The project onboarding belongs to, chosen the way the app resolves it.
///
/// `CDN` and then `CODING` win when present, because those are the slugs the
/// installation project is created with. Anything else falls back to the oldest
/// project, with an id tie-break so the choice is reproducible.
pub async fn installation_project_id(
    database: &impl ConnectionTrait,
) -> Result<Option<String>, DbErr> {
    let mut ranking = CaseStatement::new();
    for (rank, slug) in PREFERRED_PROJECT_SLUGS.iter().enumerate() {
        ranking = ranking.case(Expr::col(project::Column::Slug).eq(*slug), rank as i32);
    }
    let ranking: Expr = ranking.finally(PREFERRED_PROJECT_SLUGS.len() as i32).into();

    project::Entity::find()
        // Only the identity is selected, so this reads the same on the schema
        // before the migration as on the one after it.
        .select_only()
        .column(project::Column::Id)
        .order_by(ranking, Order::Asc)
        .order_by_asc(project::Column::CreatedAt)
        .order_by_asc(project::Column::Id)
        .limit(1)
        .into_tuple::<String>()
        .one(database)
        .await
}

/// Make every project slug unique without losing a project.
///
/// Slugs were unique per Workspace, so removing Workspace can leave collisions.
/// The earliest project keeps the slug it has; every later one is suffixed with
/// the first free ordinal. Ordering by created_at then id makes the winner and
/// each replacement deterministic.
async fn resolve_duplicate_slugs(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let projects = project::Entity::find()
        .select_only()
        .column(project::Column::Id)
        .column(project::Column::Slug)
        .order_by_asc(project::Column::Slug)
        .order_by_asc(project::Column::CreatedAt)
        .order_by_asc(project::Column::Id)
        .into_tuple::<(String, String)>()
        .all(database)
        .await?;

    let mut taken = projects
        .iter()
        .map(|(_, slug)| slug.clone())
        .collect::<std::collections::HashSet<_>>();
    let mut seen = std::collections::HashSet::new();
    for (id, slug) in &projects {
        if seen.insert(slug.clone()) {
            continue;
        }
        let mut ordinal = 2;
        let replacement = loop {
            let candidate = format!("{slug}-{ordinal}");
            if !taken.contains(&candidate) {
                break candidate;
            }
            ordinal += 1;
        };
        taken.insert(replacement.clone());
        project::Entity::update_many()
            .col_expr(project::Column::Slug, Expr::value(replacement))
            .filter(project::Column::Id.eq(id))
            .exec(database)
            .await?;
    }
    Ok(())
}

/// Drop the Workspace foreign key and make the remaining slug globally unique.
async fn remove_workspace_reference(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    for index in WORKSPACE_SCOPED_INDEXES {
        let statement = Index::drop().name(*index).if_exists().to_owned();
        database.execute(&statement).await?;
    }
    if column_exists(database, PROJECT_TABLE, WORKSPACE_ID_COLUMN).await? {
        let statement = Table::alter()
            .table(project::Entity)
            .drop_column(Alias::new(WORKSPACE_ID_COLUMN))
            .to_owned();
        database.execute(&statement).await?;
    }
    let statement = Index::create()
        .name(GLOBAL_SLUG_INDEX)
        .table(project::Entity)
        .col(project::Column::Slug)
        .unique()
        .if_not_exists()
        .to_owned();
    database.execute(&statement).await?;
    Ok(())
}

async fn drop_workspace_table(database: &impl ConnectionTrait) -> Result<(), DbErr> {
    let statement = Table::drop()
        .table(Alias::new(WORKSPACE_TABLE))
        .if_exists()
        .to_owned();
    database.execute(&statement).await?;
    Ok(())
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
        .values_panic([
            1.into(),
            VERSION.into(),
            MIGRATION_ID.into(),
            SOURCE_COMMIT.into(),
        ])
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
        .ok_or_else(|| DbErr::Custom("project-onboarding migration ledger is empty".to_owned()))?;
    let version = row.try_get::<i32>("", "version")?;
    let migration_id = row.try_get::<String>("", "migration_id")?;
    let source_commit = row.try_get::<String>("", "source_commit")?;
    if version != VERSION || migration_id != MIGRATION_ID || source_commit != SOURCE_COMMIT {
        return Err(DbErr::Custom(format!(
            "unsupported project-onboarding migration {migration_id} at version {version}"
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
/// This is the one statement here that cannot be a query over a model: the
/// migration runs against both the shape it is leaving and the shape it is
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
