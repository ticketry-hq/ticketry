//! Advisory checks are scoped to the exact provider launch directory.
use super::service::TerminalLaunchService;
use std::path::PathBuf;
use ticketry_launch::{
    stage_skill_warning, CreateTerminalSession, LaunchPathsRequest, LaunchPathsService,
    LaunchScope, Provider,
};

impl TerminalLaunchService {
    pub(super) async fn stage_skill_warning(
        &self,
        request: &CreateTerminalSession,
    ) -> Option<String> {
        if request.stage_skills.is_empty() {
            return None;
        }
        let provider = Provider::try_from(request.provider.as_deref().unwrap_or_default()).ok()?;
        let paths = LaunchPathsService::new(self.database.clone())
            .resolve(LaunchPathsRequest {
                version: 1,
                scope: LaunchScope::Task,
                agent_run_id: request.agent_run_id(),
                project_id: request.project_id.clone(),
                module_id: Some(request.module_id.clone()),
                task_id: Some(request.issue_id.clone()),
                document_id: None,
            })
            .await;
        let directory = match paths {
            Ok(paths) => paths.working_directory.map(PathBuf::from),
            Err(error) => {
                let report = stage_skill_warning(
                    provider,
                    None,
                    &request.stage_skills,
                    &self.skill_search_environment,
                )?;
                let mut report: serde_json::Value = serde_json::from_str(&report).ok()?;
                let reason =
                    format!("The provider working directory could not be checked: {error}");
                report["message"] = serde_json::Value::String(reason.clone());
                if let Some(skills) = report["skills"].as_array_mut() {
                    for skill in skills {
                        skill["reason"] = serde_json::Value::String(reason.clone());
                    }
                }
                return Some(report.to_string());
            }
        };
        let names = request.stage_skills.clone();
        let environment = self.skill_search_environment.clone();
        let provider_name = provider.slug().to_owned();
        let names_on_failure = names.clone();
        tokio::task::spawn_blocking(move || stage_skill_warning(provider, directory.as_deref(), &names, &environment))
            .await.unwrap_or_else(|_| Some(serde_json::json!({
                "status":"unchecked", "code":"skill_check_unavailable", "message":"Skill availability could not be checked.",
                "provider":provider_name, "searched_roots":[],
                "skills":names_on_failure.iter().map(|name| serde_json::json!({"requested":name,"status":"unchecked","installed_name":null,"location":null,"reason":"Skill availability could not be checked."})).collect::<Vec<_>>()
            }).to_string()))
    }
}
