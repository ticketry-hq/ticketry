#![allow(non_snake_case)]

//! Authored retry view. Attempt lineage and status publication remain one
//! transaction inside `AttemptService`.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::runs_persistence::AutomationAttemptProjection;

use super::super::support::{attempt_error, services};

struct RetryAutomationAttemptView;

#[CustomFields]
impl RetryAutomationAttemptView {
    async fn retry_automation_attempt(
        ctx: &Context<'_>,
        attempt_id: String,
    ) -> Result<AutomationAttemptProjection> {
        services(ctx)?
            .attempts()
            .retry(&attempt_id)
            .await
            .map_err(attempt_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<RetryAutomationAttemptView>();
}
