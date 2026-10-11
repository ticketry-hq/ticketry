#![allow(non_snake_case)]

//! The read-only GraphQL face of stage-skill availability. It is a query, not
//! a model write, so it adds no mutation and no operation-registry exception.

use sea_orm::DatabaseConnection;
use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields, CustomOutputType,
};
use ticketry_entities::StringList;
use ticketry_provider::{SkillAvailabilityStatus, SkillSearchEnvironment};

use super::{
    check_launch_skill_availability, LaunchSkillAvailability, LaunchSkillAvailabilityRequest,
};

#[derive(Clone, Debug, Eq, PartialEq, CustomOutputType)]
pub struct LaunchSkillAvailabilityEntry {
    pub requested: String,
    /// `available`, `missing` or `unchecked`.
    pub status: String,
    pub installed_name: Option<String>,
    pub location: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, CustomOutputType)]
pub struct LaunchSkillAvailabilityPayload {
    /// `checked` when every searched root was consulted, else `unchecked`.
    pub status: String,
    pub code: Option<String>,
    pub message: Option<String>,
    pub provider: Option<String>,
    pub searched_roots: StringList,
    pub skills: Vec<LaunchSkillAvailabilityEntry>,
}

struct LaunchSkillAvailabilityQueries;

#[CustomFields]
impl LaunchSkillAvailabilityQueries {
    async fn launch_skill_availability(
        ctx: &Context<'_>,
        module_id: String,
        agent: Option<String>,
        profile: Option<String>,
        names: StringList,
    ) -> Result<LaunchSkillAvailabilityPayload> {
        let database = ctx.data::<DatabaseConnection>().map_err(|_| {
            Error::new("Skill availability is unavailable.")
                .extend_with(|_, extension| extension.set("code", "skill_check_unavailable"))
        })?;
        let request = LaunchSkillAvailabilityRequest {
            module_id,
            agent,
            profile,
            names: names.0,
        };
        let result = check_launch_skill_availability(
            database,
            &request,
            &SkillSearchEnvironment::from_process(),
        )
        .await;
        Ok(payload(&request.names, result))
    }
}

fn payload(names: &[String], result: LaunchSkillAvailability) -> LaunchSkillAvailabilityPayload {
    match result {
        LaunchSkillAvailability::Checked(report) => LaunchSkillAvailabilityPayload {
            status: "checked".to_owned(),
            code: None,
            message: None,
            provider: Some(report.provider.slug().to_owned()),
            searched_roots: StringList(
                report
                    .searched_roots
                    .iter()
                    .map(|root| root.display().to_string())
                    .collect(),
            ),
            skills: report
                .skills
                .into_iter()
                .map(|skill| {
                    let (status, reason) = match skill.status {
                        SkillAvailabilityStatus::Available => ("available", None),
                        SkillAvailabilityStatus::Missing => ("missing", None),
                        SkillAvailabilityStatus::Unchecked { reason } => {
                            ("unchecked", Some(reason))
                        }
                    };
                    LaunchSkillAvailabilityEntry {
                        requested: skill.requested,
                        status: status.to_owned(),
                        installed_name: skill.installed_name,
                        location: skill.location.map(|path| path.display().to_string()),
                        reason,
                    }
                })
                .collect(),
        },
        LaunchSkillAvailability::Unchecked {
            code,
            provider,
            message,
        } => LaunchSkillAvailabilityPayload {
            status: "unchecked".to_owned(),
            code: Some(code.to_owned()),
            message: Some(message.clone()),
            provider: provider.map(|provider| provider.slug().to_owned()),
            searched_roots: StringList(Vec::new()),
            skills: names
                .iter()
                .map(|name| LaunchSkillAvailabilityEntry {
                    requested: name.clone(),
                    status: "unchecked".to_owned(),
                    installed_name: None,
                    location: None,
                    reason: Some(message.clone()),
                })
                .collect(),
        },
    }
}

pub(crate) fn register(builder: &mut seaography::Builder) {
    builder.register_custom_output::<LaunchSkillAvailabilityEntry>();
    builder.register_custom_output::<LaunchSkillAvailabilityPayload>();
    builder.register_custom_query::<LaunchSkillAvailabilityQueries>();
}
