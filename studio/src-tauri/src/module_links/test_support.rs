//! A linked installation, for the unit tests of capabilities that resolve
//! module folders.
//!
//! Every capability that used to read `profiles.json` now reads the typed row,
//! so each of their tests needs the same two facts: a Module exists, and it is
//! linked to a folder. Building that once here keeps those tests about the
//! capability rather than about SQL.
//!
//! Like every other entry point in this capability, these take a connection
//! their caller opened. Nothing here opens a database, so the fixture is held
//! to the same discipline the importer is.

use sea_orm::{ConnectionTrait, DatabaseConnection};

use super::{schema, ModuleLinkStore};

/// The Work Item type a Module is recorded under.
const MODULE_TYPE: &str = "module";

/// Install the tables a link resolution touches into a caller-opened store.
pub(crate) async fn install(database: &DatabaseConnection) {
    database
        .execute_unprepared(
            r"
            CREATE TABLE worktracker_issue (
                id char(32) NOT NULL PRIMARY KEY,
                project_id char(32) NOT NULL,
                type varchar(32) NOT NULL,
                issue_type_id char(32) NOT NULL DEFAULT '',
                parent_id char(32),
                module_id char(32),
                state_id char(32),
                state_revision bigint NOT NULL DEFAULT 0,
                name varchar(255) NOT NULL,
                sequence_id integer NOT NULL DEFAULT 0,
                is_archived bool NOT NULL DEFAULT 0,
                rank varchar(64) NOT NULL DEFAULT 'a',
                description text NOT NULL DEFAULT '',
                workspace_tab_order json NOT NULL DEFAULT '[]',
                created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            ",
        )
        .await
        .expect("install the Work Item fixture table");
    schema::install(database)
        .await
        .expect("install the Module Link schema");
}

/// Record a Module so a link may name it.
pub(crate) async fn module(database: &DatabaseConnection, id: &str, name: &str) {
    let id = super::identity::compact_module_id(id);
    database
        .execute_unprepared(&format!(
            "INSERT INTO worktracker_issue (id, project_id, type, name, is_archived)
             VALUES ('{id}', '{id}', '{MODULE_TYPE}', '{name}', 0)"
        ))
        .await
        .expect("record the Module fixture");
}

/// Link a recorded Module to a folder.
pub(crate) async fn link(database: &DatabaseConnection, module_id: &str, path: &str) {
    ModuleLinkStore::new(database.clone())
        .set(module_id, path)
        .await
        .expect("link the Module fixture");
}
