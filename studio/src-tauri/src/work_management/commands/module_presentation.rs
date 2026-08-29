use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set,
    TransactionTrait,
};

use super::identifiers::database_uuid;
use super::CommandError;
use crate::work_management::entities::{issue, module_presentation};

#[derive(Debug, Clone)]
pub struct UpdateModulePresentation {
    pub module_id: String,
    pub tab_hidden: bool,
}

/// Update one module's tab visibility without changing its canonical rank.
pub async fn update(
    database: &DatabaseConnection,
    input: UpdateModulePresentation,
) -> Result<module_presentation::Model, CommandError> {
    let module_id = database_uuid(&input.module_id, "module_id")?;
    let transaction = database.begin().await?;
    let module = issue::Entity::find_by_id(&module_id)
        .filter(issue::Column::Type.eq("module"))
        .one(&transaction)
        .await?
        .ok_or_else(|| CommandError::NotFound("Module not found.".to_owned()))?;

    let presentation = module_presentation::Entity::find_by_id(&module.id)
        .one(&transaction)
        .await?;
    let saved = match presentation {
        Some(row) if row.tab_hidden == input.tab_hidden => row,
        Some(row) => {
            let mut active: module_presentation::ActiveModel = row.into();
            active.tab_hidden = Set(input.tab_hidden);
            active.update(&transaction).await?
        }
        None => {
            module_presentation::ActiveModel {
                module_id: Set(module.id),
                rank: Set(String::new()),
                tab_hidden: Set(input.tab_hidden),
            }
            .insert(&transaction)
            .await?
        }
    };
    transaction.commit().await?;
    Ok(saved)
}
