#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::persistence::AutomationAttemptProjection;

use super::super::support::{attempt_error, services};

struct AutomationAttemptListQuery;

#[CustomFields]
impl AutomationAttemptListQuery {
    async fn automation_attempts(
        ctx: &Context<'_>,
        project_id: String,
        task_id: Option<String>,
    ) -> Result<Vec<AutomationAttemptProjection>> {
        services(ctx)?
            .attempts()
            .latest(&project_id, task_id.as_deref())
            .await
            .map_err(attempt_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_query::<AutomationAttemptListQuery>();
}
