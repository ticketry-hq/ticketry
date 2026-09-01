use sea_orm::{DatabaseConnection, EntityTrait};

use ticketry_entities::issue;
use ticketry_work_management::{
    commands::CommandError, read_queries, read_types::WorkItem,
};

use super::{projection, RunPrincipal};

pub async fn project(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    value: &str,
) -> Result<String, CommandError> {
    let resolved = projection::resolve_project(database, value)
        .await
        .ok_or_else(|| CommandError::NotFound("Project not found.".to_owned()))?;
    if !principal.is_global() && resolved != principal.project_id {
        return Err(CommandError::ForeignScope(
            "The caller is not authorized for that project.".to_owned(),
        ));
    }
    Ok(resolved)
}

pub async fn task(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    value: &str,
) -> Result<WorkItem, CommandError> {
    let task = projection::resolve_task(database, value)
        .await
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))?;
    ensure_item_project(principal, &task.project_id)?;
    Ok(task)
}

pub async fn task_or_module_id(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    value: &str,
) -> Result<String, CommandError> {
    if let Some(task) = projection::resolve_task(database, value).await {
        ensure_item_project(principal, &task.project_id)?;
        return Ok(task.id);
    }
    if principal.is_global() {
        if let Some(item) = read_queries::work_item(database, value).await? {
            return Ok(item.id);
        }
        return issue::Entity::find_by_id(value.replace('-', ""))
            .one(database)
            .await?
            .filter(|item| item.r#type == "module")
            .map(|item| item.id)
            .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()));
    }
    let modules = read_queries::modules(database, &principal.project_id, true).await?;
    modules
        .into_iter()
        .find(|module| {
            same_id(&module.id, value)
                || module.key.eq_ignore_ascii_case(value)
                || module.name.eq_ignore_ascii_case(value)
        })
        .map(|module| module.id)
        .ok_or_else(|| CommandError::NotFound("Work item not found.".to_owned()))
}

pub async fn module_id(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    value: &str,
) -> Result<String, CommandError> {
    if principal.is_global() {
        return issue::Entity::find_by_id(value.replace('-', ""))
            .one(database)
            .await?
            .filter(|item| item.r#type == "module")
            .map(|item| item.id)
            .ok_or_else(|| CommandError::NotFound("Module not found.".to_owned()));
    }
    read_queries::modules(database, &principal.project_id, true)
        .await?
        .into_iter()
        .find(|module| same_id(&module.id, value))
        .map(|module| module.id)
        .ok_or_else(|| {
            CommandError::ForeignScope("The caller is not authorized for that module.".to_owned())
        })
}

pub async fn issue_type(
    database: &DatabaseConnection,
    principal: &RunPrincipal,
    type_id: &str,
) -> Result<(), CommandError> {
    let kind = read_queries::issue_type(database, type_id)
        .await?
        .ok_or_else(|| CommandError::NotFound("Work-item type not found.".to_owned()))?;
    if !principal.is_global() && kind.project != principal.project_id {
        return Err(CommandError::ForeignScope(
            "The caller is not authorized for that workflow.".to_owned(),
        ));
    }
    Ok(())
}

fn ensure_item_project(principal: &RunPrincipal, project_id: &str) -> Result<(), CommandError> {
    if !principal.is_global() && project_id != principal.project_id {
        return Err(CommandError::ForeignScope(
            "The caller is not authorized for that work item.".to_owned(),
        ));
    }
    Ok(())
}

fn same_id(left: &str, right: &str) -> bool {
    left.chars()
        .filter(|character| *character != '-')
        .eq(right.chars().filter(|character| *character != '-'))
}
