#![allow(non_snake_case)]

//! Authored dismiss view. Eligibility and status publication remain one
//! transaction inside `AttemptService`.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::runs_persistence::AutomationAttemptProjection;

use super::super::support::{attempt_error, services};

struct DismissAutomationAttemptView;

#[CustomFields]
impl DismissAutomationAttemptView {
    async fn dismiss_automation_attempt(
        ctx: &Context<'_>,
        attempt_id: String,
    ) -> Result<AutomationAttemptProjection> {
        services(ctx)?
            .attempts()
            .dismiss(&attempt_id)
            .await
            .map_err(attempt_error)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<DismissAutomationAttemptView>();
}
