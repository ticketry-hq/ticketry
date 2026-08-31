//! Provider, model, and reasoning rows required by a new installation.

use std::collections::BTreeMap;

use sea_orm::{ActiveValue::NotSet, DatabaseConnection, DbErr, EntityTrait, Set, TransactionTrait};

use ticketry_entities::work_management::{
    agent_model, agent_model_reasoning_level, provider, reasoning_level,
};

const CLAUDE_REASONING: &[&str] = &["low", "medium", "high", "xhigh", "max"];
const CODEX_REASONING: &[&str] = &["minimal", "low", "medium", "high", "xhigh"];
const REASONING_LEVELS: &[&str] = &["high", "low", "max", "medium", "minimal", "xhigh"];

struct ProviderDefault {
    slug: &'static str,
    activated: bool,
    models: &'static [&'static str],
    reasoning: &'static [&'static str],
}

const PROVIDERS: &[ProviderDefault] = &[
    ProviderDefault {
        slug: "agy",
        activated: false,
        models: &["vendor/model"],
        reasoning: &[],
    },
    ProviderDefault {
        slug: "claude",
        activated: true,
        models: &["sonnet", "opus", "haiku", "fable"],
        reasoning: CLAUDE_REASONING,
    },
    ProviderDefault {
        slug: "codex",
        activated: true,
        models: &["gpt-5.4"],
        reasoning: CODEX_REASONING,
    },
    ProviderDefault {
        slug: "gemini",
        activated: true,
        models: &["gemini-3.1-pro-preview"],
        reasoning: &[],
    },
];

pub async fn provision(database: &DatabaseConnection) -> Result<(), DbErr> {
    let transaction = database.begin().await?;
    let mut reasoning_ids = BTreeMap::new();

    for name in REASONING_LEVELS {
        let id = new_id();
        reasoning_level::Entity::insert(reasoning_level::ActiveModel {
            id: Set(id.clone()),
            name: Set((*name).to_owned()),
        })
        .exec(&transaction)
        .await?;
        reasoning_ids.insert(*name, id);
    }

    for definition in PROVIDERS {
        let provider_id = new_id();
        provider::Entity::insert(provider::ActiveModel {
            id: Set(provider_id.clone()),
            slug: Set(definition.slug.to_owned()),
            activated: Set(definition.activated),
            supports_unattended: Set(true),
        })
        .exec(&transaction)
        .await?;

        for name in definition.models {
            let model_id = new_id();
            agent_model::Entity::insert(agent_model::ActiveModel {
                id: Set(model_id.clone()),
                provider_id: Set(provider_id.clone()),
                name: Set((*name).to_owned()),
            })
            .exec(&transaction)
            .await?;

            for level in definition.reasoning {
                agent_model_reasoning_level::Entity::insert(
                    agent_model_reasoning_level::ActiveModel {
                        id: NotSet,
                        agent_model_id: Set(model_id.clone()),
                        reasoning_level_id: Set(reasoning_ids[*level].clone()),
                    },
                )
                .exec(&transaction)
                .await?;
            }
        }
    }

    transaction.commit().await
}

fn new_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}
