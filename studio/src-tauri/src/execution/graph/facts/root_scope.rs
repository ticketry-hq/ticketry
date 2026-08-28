use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder};

use crate::entities::work_management::issue;
use crate::execution::graph::{
    types::compact_id, GraphAccess, GraphFactsError, GraphFactsErrorCode,
};

pub(super) async fn scoped_root(
    database: &impl ConnectionTrait,
    root_id: &str,
    access: &GraphAccess,
) -> Result<(issue::Model, Vec<issue::Model>), GraphFactsError> {
    let root_id = compact_id(root_id.to_owned());
    let root = issue::Entity::find_by_id(&root_id)
        .one(database)
        .await?
        .filter(|root| root.r#type == "task")
        .ok_or_else(|| {
            GraphFactsError::new(
                GraphFactsErrorCode::TaskNotFound,
                "Dependency graph root was not found.",
            )
        })?;
    validate_root(database, &root, access).await?;
    let children = issue::Entity::find()
        .filter(issue::Column::ParentId.eq(&root.id))
        .filter(issue::Column::Type.eq("task"))
        .filter(issue::Column::IsArchived.eq(false))
        .order_by_asc(issue::Column::SequenceId)
        .order_by_asc(issue::Column::Id)
        .all(database)
        .await?;
    if children.is_empty() {
        return Err(GraphFactsError::new(
            GraphFactsErrorCode::GraphEmpty,
            "Dependency graph root has no schedulable direct children.",
        ));
    }
    Ok((root, children))
}

async fn validate_root(
    database: &impl ConnectionTrait,
    root: &issue::Model,
    access: &GraphAccess,
) -> Result<(), GraphFactsError> {
    if !access.allows(&root.project_id, &root.id) {
        return Err(GraphFactsError::new(
            GraphFactsErrorCode::Unauthorized,
            "The caller is not authorized for this dependency graph.",
        ));
    }
    if root.is_archived {
        return Err(GraphFactsError::new(
            GraphFactsErrorCode::RootArchived,
            "Archived work cannot be a dependency graph root.",
        ));
    }
    let module_id = root.module_id.as_ref().ok_or_else(|| {
        GraphFactsError::new(
            GraphFactsErrorCode::RootUnscoped,
            "Dependency graph root has no Module scope.",
        )
    })?;
    let module_is_valid = issue::Entity::find_by_id(module_id)
        .one(database)
        .await?
        .is_some_and(|module| {
            module.r#type == "module" && module.project_id == root.project_id && !module.is_archived
        });
    if !module_is_valid {
        return Err(GraphFactsError::new(
            GraphFactsErrorCode::RootUnscoped,
            "Dependency graph root has no valid Module scope.",
        ));
    }
    Ok(())
}
