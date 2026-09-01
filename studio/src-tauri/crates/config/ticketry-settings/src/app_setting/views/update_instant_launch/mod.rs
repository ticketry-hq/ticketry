use std::time::{SystemTime, UNIX_EPOCH};

use sea_orm::{ActiveValue::Set, DatabaseTransaction, EntityTrait, IntoActiveModel};
use seaography::{
    async_graphql::{
        dynamic::{InputValue, ResolverContext, TypeRef},
        Error, ErrorExtensions,
    },
    Builder, OperationType,
};
use seaolim::{
    register_restricted_model_mutation, ModelWrite, PreparedModelWrite, RestrictedModelMutation,
    RestrictedMutationField, ViewSerializers,
};

use crate::{
    entities::app_settings,
    instant_launch::{self, InstantLaunchSettings, MAX_INITIAL_PROMPT_CHARACTERS},
    schema::settings_error,
    SettingsPersistenceError,
};

struct UpdateInstantLaunch;

#[sea_orm::prelude::async_trait::async_trait]
impl RestrictedModelMutation<app_settings::Entity, app_settings::ActiveModel>
    for UpdateInstantLaunch
{
    async fn prepare(
        &self,
        ctx: &ResolverContext<'_>,
        transaction: &DatabaseTransaction,
    ) -> seaography::async_graphql::Result<
        PreparedModelWrite<app_settings::ActiveModel, app_settings::Model>,
    > {
        let initial_prompt = ctx.args.try_get("initial_prompt")?.string()?.to_owned();
        let auto_close = ctx.args.try_get("auto_close")?.boolean()?;
        let settings = InstantLaunchSettings::new(initial_prompt, auto_close).ok_or_else(|| {
            Error::new(format!(
                "The Instant initial prompt must be at most {MAX_INITIAL_PROMPT_CHARACTERS} characters."
            ))
            .extend_with(|_, extension| extension.set("code", "instant_launch_setting_invalid"))
            .extend_with(|_, extension| extension.set("field", "initial_prompt"))
        })?;
        let encoded = serde_json::to_string(&settings).map_err(|error| {
            settings_error(
                SettingsPersistenceError::from(error),
                "Instant settings could not be saved.",
            )
        })?;
        let (scope, key) = instant_launch::fixed_identity()
            .map_err(|error| settings_error(error, "Instant settings could not be saved."))?;
        let existing =
            app_settings::Entity::find_by_id((scope.as_str().to_owned(), key.as_str().to_owned()))
                .one(transaction)
                .await
                .map_err(|error| {
                    settings_error(
                        SettingsPersistenceError::from(error),
                        "Instant settings could not be saved.",
                    )
                })?;
        let updated_at = now();
        let write = match existing {
            Some(model) => {
                let mut active = model.into_active_model();
                active.value = Set(encoded);
                active.updated_at = Set(updated_at);
                ModelWrite::Update(active)
            }
            None => ModelWrite::Insert(app_settings::ActiveModel {
                scope: Set(scope.as_str().to_owned()),
                key: Set(key.as_str().to_owned()),
                value: Set(encoded),
                updated_at: Set(updated_at),
            }),
        };
        Ok(PreparedModelWrite::new(write, ()))
    }
}

pub(super) fn register(builder: &mut Builder) {
    register_restricted_model_mutation::<app_settings::Entity, app_settings::ActiveModel, _>(
        builder,
        RestrictedMutationField::new("update_instant_launch_setting", OperationType::Update)
            .argument(InputValue::new(
                "initial_prompt",
                TypeRef::named_nn(TypeRef::STRING),
            ))
            .argument(InputValue::new(
                "auto_close",
                TypeRef::named_nn(TypeRef::BOOLEAN),
            )),
        UpdateInstantLaunch,
        ViewSerializers::default(),
    );
}

fn now() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("the system clock predates the Unix epoch");
    sea_orm::prelude::DateTimeUtc::from_timestamp(elapsed.as_secs() as i64, elapsed.subsec_nanos())
        .expect("the system clock is outside SQLite's datetime range")
        .to_rfc3339()
}
