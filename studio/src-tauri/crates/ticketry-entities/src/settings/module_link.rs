//! `SeaORM` mapping for the typed Module Link.
//!
//! The row is the one host-local relationship a Module has: the absolute local
//! folder this installation checks that Module out into. Identity is stable and
//! the owning Module is unique, so a Module has exactly zero or one link and a
//! link never outlives the Module it names.

use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "module_links")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    #[sea_orm(unique)]
    pub module_id: String,
    pub path: String,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    #[sea_orm(belongs_to, from = "module_id", to = "id")]
    pub module: BelongsTo<crate::work_management::issue::Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
