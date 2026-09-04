#![allow(non_snake_case)]

use seaography::{
    async_graphql::{Context, Error, ErrorExtensions, Result},
    CustomFields,
};

use ticketry_entities::session;
use ticketry_entities::StringList;

use super::TerminalLaunchService;
use ticketry_launch::{CreateTerminalSession, TerminalLaunchError, TerminalLaunchKind};

pub struct TerminalSessionMutations;

/// The restricted, model-shaped create seam for Terminal Session. Callers
/// provide launch policy and model identities, never an executable, command,
/// environment, tmux identity, credential, or filesystem path.
#[CustomFields]
impl TerminalSessionMutations {
    async fn terminal_session_create(
        ctx: &Context<'_>,
        client_request_id: String,
        project_id: Option<String>,
        issue_id: Option<String>,
        module_id: String,
        target_id: Option<String>,
        kind: String,
        provider: Option<String>,
        working_directory_identity: Option<String>,
        columns: i32,
        rows: i32,
        model: Option<String>,
        reasoning: Option<String>,
        policy_reference: Option<String>,
        prompt: Option<String>,
        resume_from_agent_run_id: Option<String>,
        automation_attempt_id: Option<String>,
        required_skills: Option<StringList>,
        design_directory_identity: Option<String>,
        document_relative_path: Option<String>,
    ) -> Result<session::Model> {
        let kind = TerminalLaunchKind::parse(&kind).map_err(graphql_error)?;
        let required_skills = required_skills.map(|value| value.0).unwrap_or_default();
        let columns = u16::try_from(columns)
            .map_err(|_| typed("terminal_launch_invalid", "Terminal columns are invalid."))?;
        let rows = u16::try_from(rows)
            .map_err(|_| typed("terminal_launch_invalid", "Terminal rows are invalid."))?;
        let service = service(ctx)?;
        if kind == TerminalLaunchKind::Shell {
            if project_id.is_some()
                || issue_id.is_some()
                || target_id.is_some()
                || provider.is_some()
                || working_directory_identity.is_some()
                || model.is_some()
                || reasoning.is_some()
                || policy_reference.is_some()
                || prompt.is_some()
                || resume_from_agent_run_id.is_some()
                || automation_attempt_id.is_some()
                || !required_skills.is_empty()
                || design_directory_identity.is_some()
                || document_relative_path.is_some()
            {
                return Err(typed(
                    "terminal_launch_invalid",
                    "Shell creation accepts only request identity, module identity, and geometry.",
                ));
            }
            return ticketry_diagnostics::requested_by(
                ticketry_diagnostics::LaunchSurface::LaunchPicker,
                service.create_module_shell(client_request_id, module_id, columns, rows),
            )
            .await
            .map_err(graphql_error);
        }
        let surface = if resume_from_agent_run_id.is_some() {
            ticketry_diagnostics::LaunchSurface::Resume
        } else {
            ticketry_diagnostics::LaunchSurface::LaunchPicker
        };
        ticketry_diagnostics::requested_by(
            surface,
            service.create(CreateTerminalSession {
                client_request_id,
                project_id: required(project_id, "project")?,
                issue_id: required(issue_id, "Work Item")?,
                module_id,
                target_id: required(target_id, "target")?,
                kind,
                provider,
                model,
                reasoning,
                policy_reference,
                prompt,
                resume_from_agent_run_id,
                automation_attempt_id,
                required_skills,
                working_directory_identity: required(
                    working_directory_identity,
                    "working directory",
                )?,
                design_directory_identity,
                document_relative_path,
                columns,
                rows,
            }),
        )
        .await
        .map_err(graphql_error)
    }
}

fn required(value: Option<String>, name: &'static str) -> Result<String> {
    value.ok_or_else(|| {
        typed(
            "terminal_launch_invalid",
            &format!("An agent terminal launch requires a {name} identity."),
        )
    })
}

pub(super) fn register(mut builder: seaography::Builder) -> seaography::Builder {
    builder.register_custom_mutation::<TerminalSessionMutations>();
    builder
}

fn service<'a>(ctx: &'a Context<'a>) -> Result<&'a TerminalLaunchService> {
    ctx.data::<TerminalLaunchService>().map_err(|_| {
        typed(
            "terminal_launch_unavailable",
            "Terminal launch is unavailable.",
        )
    })
}

fn graphql_error(error: TerminalLaunchError) -> Error {
    typed(error.code_str(), &error.to_string())
}

fn typed(code: &'static str, message: &str) -> Error {
    Error::new(message.to_owned())
        .extend_with(|_, extension| extension.set("code", code))
        .extend_with(|_, extension| extension.set("detail", message))
}
