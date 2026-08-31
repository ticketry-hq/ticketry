use sea_orm::{
    ColumnTrait, ConnectionTrait, DbErr, EntityTrait, FromQueryResult, QueryFilter, QuerySelect,
};

use ticketry_entities::work_management::issue;

#[derive(FromQueryResult)]
pub struct HoldingScope {
    pub id: String,
    pub project_id: String,
    pub issue_type: String,
    pub module_id: Option<String>,
}

#[derive(FromQueryResult)]
pub struct AutomationScope {
    pub project_id: String,
    pub issue_type: String,
}

pub async fn automation_scope(
    database: &impl ConnectionTrait,
    issue_id: &str,
) -> Result<Option<AutomationScope>, DbErr> {
    issue::Entity::find()
        .select_only()
        .column(issue::Column::ProjectId)
        .column_as(issue::Column::Type, "issue_type")
        .filter(issue::Column::Id.eq(issue_id))
        .into_model::<AutomationScope>()
        .one(database)
        .await
}

pub async fn project_id(
    database: &impl ConnectionTrait,
    issue_id: &str,
) -> Result<Option<String>, DbErr> {
    issue::Entity::find()
        .select_only()
        .column(issue::Column::ProjectId)
        .filter(issue::Column::Id.eq(issue_id))
        .into_tuple::<String>()
        .one(database)
        .await
}

pub async fn ids_for_project(
    database: &impl ConnectionTrait,
    project_id: &str,
    issue_id: Option<&str>,
) -> Result<Vec<String>, DbErr> {
    let mut query = issue::Entity::find()
        .select_only()
        .column(issue::Column::Id)
        .filter(issue::Column::ProjectId.eq(project_id));
    if let Some(issue_id) = issue_id {
        query = query.filter(issue::Column::Id.eq(issue_id));
    }
    query.into_tuple::<String>().all(database).await
}

pub async fn holding_scopes(
    database: &impl ConnectionTrait,
    issue_ids: Vec<String>,
) -> Result<Vec<HoldingScope>, DbErr> {
    if issue_ids.is_empty() {
        return Ok(Vec::new());
    }
    issue::Entity::find()
        .select_only()
        .column(issue::Column::Id)
        .column(issue::Column::ProjectId)
        .column_as(issue::Column::Type, "issue_type")
        .column(issue::Column::ModuleId)
        .filter(issue::Column::Id.is_in(issue_ids))
        .into_model::<HoldingScope>()
        .all(database)
        .await
}
