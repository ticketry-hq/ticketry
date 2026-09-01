//! Full task prompt composition from durable Work Item facts and resolved
//! launch-policy input.

use sea_orm::DatabaseConnection;

use crate::planning::{build_task_prompt, TaskPromptInput};

use super::{error::LaunchAuthorityError, facts};

pub struct TaskPromptSource<'a> {
    pub task_id: &'a str,
    pub module_id: &'a str,
    pub local_module_folder: &'a str,
    pub state_name: Option<&'a str>,
    pub workflow_prompt: &'a str,
    pub additional_user_input: Option<&'a str>,
    pub design_directory: Option<&'a str>,
}

pub async fn compose_task_prompt(
    database: &DatabaseConnection,
    source: TaskPromptSource<'_>,
) -> Result<String, LaunchAuthorityError> {
    let task = facts::work_item(database, source.task_id).await?;
    let prompt_facts = facts::task_prompt_facts(
        database,
        &task,
        source.module_id,
        source.local_module_folder.to_owned(),
        source.state_name.map(str::to_owned),
    )
    .await?;
    Ok(build_task_prompt(&TaskPromptInput {
        facts: prompt_facts,
        workflow_prompt: source.workflow_prompt.to_owned(),
        additional_user_input: source.additional_user_input.map(str::to_owned),
        design_directory: source.design_directory.map(str::to_owned),
    }))
}
