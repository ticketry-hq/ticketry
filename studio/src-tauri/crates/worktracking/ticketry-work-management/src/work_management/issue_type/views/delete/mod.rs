//! Authored deletion of one Issue Type aggregate.
//!
//! Generated delete accepts an optional filter and cannot reassign existing
//! Work Items before deleting the concrete Issue Type in one transaction.

use seaography::{
    async_graphql::{Context, Result},
    Builder, CustomFields,
};

use crate::work_management::{
    commands::catalog,
    graphql::{command_database, command_error},
};

struct DeleteIssueTypeView;

#[CustomFields]
impl DeleteIssueTypeView {
    async fn delete_issue_type(
        ctx: &Context<'_>,
        id: String,
        reassign_to: Option<String>,
    ) -> Result<bool> {
        catalog::delete_issue_type(command_database(ctx)?, &id, reassign_to.as_deref())
            .await
            .map_err(command_error)?;
        Ok(true)
    }
}

pub(super) fn register(builder: &mut Builder) {
    builder.register_custom_mutation::<DeleteIssueTypeView>();
}
