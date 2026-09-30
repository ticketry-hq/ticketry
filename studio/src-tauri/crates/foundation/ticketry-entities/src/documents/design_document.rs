//! One adopted Design Document registry row.
//!
//! The local filesystem stays authoritative for a document's bytes; this table
//! is only the durable index. Two columns are authority rather than data and
//! are therefore removed from the generated GraphQL contract altogether with
//! `#[seaography(ignore)]`, which drops them from the entity object, filters,
//! ordering, and every generated input at once:
//!
//! * `root_dir` is the absolute authorized design-directory root. Publishing it
//!   would hand a caller a local path to aim later asset reads at.
//! * `discovered_by_run_id` is provenance for the Agent Run that registered the
//!   row. Studio renders documents, never their discovery history.
//!
//! `content_digest` is the one column this slice adds. It is nullable and
//! populated lazily from an authorized existing primary file, so adoption never
//! copies a file body into the model table.

use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "design_documents")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub module_id: String,
    pub task_id: String,
    pub scope: String,
    #[seaography(ignore)]
    pub root_dir: String,
    pub rel_path: String,
    #[seaography(ignore)]
    pub discovered_by_run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub content_digest: Option<String>,
}

impl ActiveModelBehavior for ActiveModel {}
