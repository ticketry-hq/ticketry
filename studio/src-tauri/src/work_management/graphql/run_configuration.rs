#![allow(non_snake_case)]

use std::collections::BTreeMap;

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use super::support::command_database;
use crate::entities::work_management::run_configuration;

pub struct RunConfigurationMutations;

#[CustomFields]
impl RunConfigurationMutations {
    async fn create_run_configuration(
        ctx: &Context<'_>,
        module_id: String,
        command: String,
        environment: crate::settings_persistence::keybindings::JsonValue,
        preview_url: Option<String>,
    ) -> Result<run_configuration::Model> {
        crate::work_management::run_configuration::create(
            command_database(ctx)?,
            crate::work_management::run_configuration::NewRunConfiguration {
                module_id,
                command,
                environment: parse_environment(environment)?,
                preview_url,
            },
        )
        .await
        .map_err(graphql_error)
    }

    async fn update_run_configuration(
        ctx: &Context<'_>,
        module_id: String,
        command: String,
        environment: crate::settings_persistence::keybindings::JsonValue,
        preview_url: Option<String>,
    ) -> Result<run_configuration::Model> {
        crate::work_management::run_configuration::update(
            command_database(ctx)?,
            crate::work_management::run_configuration::RunConfigurationPatch {
                module_id,
                command,
                environment: parse_environment(environment)?,
                preview_url,
            },
        )
        .await
        .map_err(graphql_error)
    }

    async fn delete_run_configuration(ctx: &Context<'_>, module_id: String) -> Result<bool> {
        crate::work_management::run_configuration::delete(command_database(ctx)?, &module_id)
            .await
            .map_err(graphql_error)?;
        Ok(true)
    }
}

fn parse_environment(
    environment: crate::settings_persistence::keybindings::JsonValue,
) -> Result<BTreeMap<String, String>> {
    serde_json::from_value(environment.0).map_err(|error| {
        Error::new(format!(
            "Environment must be an object of string values: {error}"
        ))
        .extend_with(|_, extensions| extensions.set("code", "invalid_environment"))
    })
}

fn graphql_error(error: crate::work_management::run_configuration::RunConfigurationError) -> Error {
    let code = error.code();
    let message = error.to_string();
    Error::new(message.clone())
        .extend_with(|_, extensions| extensions.set("code", code))
        .extend_with(|_, extensions| extensions.set("detail", message))
}
