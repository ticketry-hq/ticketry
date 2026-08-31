use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, ExprTrait, QueryFilter, Set,
    TransactionTrait,
};

use super::super::identifiers::database_uuid;
use super::super::CommandError;
use super::launch_policy_validation::{validate_launch_binding, LaunchBindingCandidate};
use super::revision_guard::{claim_workflow_revision, require_project_state, RevisionedState};
use ticketry_entities::work_management::{issue_type, launch_binding};

/// Tri-state presence for one field of a restricted patch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PatchValue<T> {
    Unset,
    Null,
    Value(T),
}

impl<T> PatchValue<T> {
    pub fn is_unset(&self) -> bool {
        matches!(self, Self::Unset)
    }

    pub fn map<U>(self, transform: impl FnOnce(T) -> U) -> PatchValue<U> {
        match self {
            Self::Unset => PatchValue::Unset,
            Self::Null => PatchValue::Null,
            Self::Value(value) => PatchValue::Value(transform(value)),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PatchLaunchBinding {
    pub issue_type_id: String,
    pub state_id: String,
    pub workflow_revision: i32,
    pub prompt: PatchValue<String>,
    pub required_skills: PatchValue<Vec<String>>,
    pub model_id: PatchValue<String>,
    pub reasoning_id: PatchValue<String>,
    pub auto_start: PatchValue<bool>,
    pub subtree_run_enabled: PatchValue<bool>,
}

/// Create or patch one state's launch binding, returning the stored row id.
///
/// Every caller-writable field rides this one patch: there is no per-field
/// mutation for auto-start or subtree runs. A patch that changes nothing
/// releases the revision it read instead of burning it.
pub async fn patch_launch_binding(
    database: &DatabaseConnection,
    input: PatchLaunchBinding,
) -> Result<i64, CommandError> {
    let type_id = database_uuid(&input.issue_type_id, "issue_type_id")?;
    let state_id = database_uuid(&input.state_id, "state_id")?;
    let model_patch = map_nullable_id(input.model_id, "model_id")?;
    let reasoning_patch = map_nullable_id(input.reasoning_id, "reasoning_id")?;
    // Automation flags alone describe no binding. When they were their own
    // mutations they failed loudly against a state that had none; keep that
    // rather than letting a toggle conjure an unconfigured row.
    let describes_a_binding = !matches!(input.prompt, PatchValue::Unset)
        || !matches!(input.required_skills, PatchValue::Unset)
        || !matches!(model_patch, PatchValue::Unset)
        || !matches!(reasoning_patch, PatchValue::Unset);
    let transaction = database.begin().await?;
    let claimed = issue_type::Entity::update_many()
        .col_expr(
            issue_type::Column::WorkflowRevision,
            sea_orm::sea_query::Expr::col(issue_type::Column::WorkflowRevision),
        )
        .filter(issue_type::Column::Id.eq(&type_id))
        .filter(issue_type::Column::WorkflowRevision.eq(input.workflow_revision))
        .exec_with_returning(&transaction)
        .await?;
    let Some(claimed) = claimed.into_iter().next() else {
        if ticketry_entities::work_management::issue_type::Entity::find_by_id(&type_id)
            .one(&transaction)
            .await?
            .is_none()
        {
            return Err(CommandError::NotFound(
                "Work-item type not found.".to_owned(),
            ));
        }
        return Err(CommandError::StaleRevision(
            "Workflow revision is stale; read the current workflow and retry.".to_owned(),
        ));
    };
    let project_id = claimed.project_id;
    require_project_state(&transaction, &project_id, &state_id, "State").await?;
    let current = launch_binding::Entity::find()
        .filter(launch_binding::Column::IssueTypeId.eq(&type_id))
        .filter(launch_binding::Column::StateId.eq(&state_id))
        .one(&transaction)
        .await?;
    let prompt = required_value(
        input.prompt,
        current.as_ref().map(|row| row.prompt.clone()),
        String::new(),
        "prompt",
    )?
    .trim()
    .to_owned();
    let required_skills = required_value(
        input.required_skills,
        current.as_ref().map(|row| {
            row.required_skills
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|value| value.as_str().map(str::to_owned))
                .collect()
        }),
        Vec::new(),
        "required_skills",
    )?;
    let model_id = nullable_value(
        model_patch,
        current.as_ref().and_then(|row| row.model_id.clone()),
    );
    let reasoning_id = nullable_value(
        reasoning_patch,
        current.as_ref().and_then(|row| row.reasoning_id.clone()),
    );
    let auto_start = required_value(
        input.auto_start,
        current.as_ref().map(|row| row.auto_start),
        false,
        "auto_start",
    )?;
    let subtree_run_enabled = required_value(
        input.subtree_run_enabled,
        current.as_ref().map(|row| row.subtree_run_enabled),
        false,
        "subtree_run_enabled",
    )?;
    if current.is_none() && !describes_a_binding {
        return Err(CommandError::NotFound(
            "Launch binding not found.".to_owned(),
        ));
    }
    validate_launch_binding(
        &transaction,
        LaunchBindingCandidate {
            prompt: &prompt,
            required_skills: &required_skills,
            model_id: model_id.as_deref(),
            reasoning_id: reasoning_id.as_deref(),
            auto_start,
            subtree_run_enabled,
        },
    )
    .await?;
    if let Some(row) = &current {
        if row.prompt == prompt
            && row.required_skills == serde_json::json!(required_skills)
            && row.model_id == model_id
            && row.reasoning_id == reasoning_id
            && row.auto_start == auto_start
            && row.subtree_run_enabled == subtree_run_enabled
        {
            let id = row.id;
            transaction.commit().await?;
            return Ok(id);
        }
    }
    let now = super::super::timestamp::now();
    let row = match current {
        Some(row) => {
            let mut active: launch_binding::ActiveModel = row.into();
            active.prompt = Set(prompt);
            active.required_skills = Set(serde_json::json!(required_skills));
            active.model_id = Set(model_id);
            active.reasoning_id = Set(reasoning_id);
            active.auto_start = Set(auto_start);
            active.subtree_run_enabled = Set(subtree_run_enabled);
            active.updated_at = Set(now);
            active.update(&transaction).await?
        }
        None => {
            launch_binding::ActiveModel {
                id: sea_orm::ActiveValue::NotSet,
                issue_type_id: Set(type_id.clone()),
                state_id: Set(state_id),
                prompt: Set(prompt),
                required_skills: Set(serde_json::json!(required_skills)),
                model_id: Set(model_id),
                reasoning_id: Set(reasoning_id),
                auto_start: Set(auto_start),
                subtree_run_enabled: Set(subtree_run_enabled),
                created_at: Set(now),
                updated_at: Set(now),
            }
            .insert(&transaction)
            .await?
        }
    };
    issue_type::Entity::update_many()
        .col_expr(
            issue_type::Column::WorkflowRevision,
            sea_orm::sea_query::Expr::col(issue_type::Column::WorkflowRevision).add(1),
        )
        .col_expr(
            issue_type::Column::UpdatedAt,
            sea_orm::sea_query::Expr::current_timestamp(),
        )
        .filter(issue_type::Column::Id.eq(type_id))
        .exec(&transaction)
        .await?;
    transaction.commit().await?;
    Ok(row.id)
}

fn map_nullable_id(
    value: PatchValue<String>,
    field: &'static str,
) -> Result<PatchValue<String>, CommandError> {
    match value {
        PatchValue::Value(value) => Ok(PatchValue::Value(database_uuid(&value, field)?)),
        other => Ok(other),
    }
}

fn nullable_value<T>(patch: PatchValue<T>, current: Option<T>) -> Option<T> {
    match patch {
        PatchValue::Unset => current,
        PatchValue::Null => None,
        PatchValue::Value(value) => Some(value),
    }
}

fn required_value<T>(
    patch: PatchValue<T>,
    current: Option<T>,
    default: T,
    field: &'static str,
) -> Result<T, CommandError> {
    match patch {
        PatchValue::Unset => Ok(current.unwrap_or(default)),
        PatchValue::Null => Err(CommandError::field(field, "This field may not be null.")),
        PatchValue::Value(value) => Ok(value),
    }
}

pub async fn delete_launch_binding(
    database: &DatabaseConnection,
    input: RevisionedState,
) -> Result<(), CommandError> {
    let type_id = database_uuid(&input.issue_type_id, "issue_type_id")?;
    let state_id = database_uuid(&input.state_id, "state_id")?;
    let transaction = database.begin().await?;
    let kind = claim_workflow_revision(&transaction, &type_id, input.workflow_revision).await?;
    require_project_state(&transaction, &kind.project_id, &state_id, "State").await?;
    launch_binding::Entity::delete_many()
        .filter(launch_binding::Column::IssueTypeId.eq(type_id))
        .filter(launch_binding::Column::StateId.eq(state_id))
        .exec(&transaction)
        .await?;
    transaction.commit().await?;
    Ok(())
}
