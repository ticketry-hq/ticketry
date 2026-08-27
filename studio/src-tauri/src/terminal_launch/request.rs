use sha2::{Digest, Sha256};

use super::{TerminalLaunchError, TerminalLaunchErrorCode};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalLaunchKind {
    Task,
    Planning,
    Instant,
    DocumentChat,
    Automation,
    Shell,
}

impl TerminalLaunchKind {
    pub(crate) fn parse(value: &str) -> Result<Self, TerminalLaunchError> {
        match value {
            "task" => Ok(Self::Task),
            "planning" => Ok(Self::Planning),
            "instant" => Ok(Self::Instant),
            "document_chat" => Ok(Self::DocumentChat),
            "automation" => Ok(Self::Automation),
            "shell" => Ok(Self::Shell),
            _ => Err(invalid("The terminal launch kind is unsupported.")),
        }
    }

    pub(crate) fn scope(self) -> &'static str {
        match self {
            Self::Task | Self::Automation => "task",
            Self::Planning => "plan",
            Self::Instant => "instant",
            Self::DocumentChat => "docchat",
            Self::Shell => "shell",
        }
    }

    pub(crate) fn target_kind(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Planning => "planning",
            Self::Instant => "instant",
            Self::DocumentChat => "document",
            Self::Automation => "automation",
            Self::Shell => "shell",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreateTerminalSession {
    pub client_request_id: String,
    pub project_id: String,
    pub issue_id: String,
    pub module_id: String,
    pub target_id: String,
    pub kind: TerminalLaunchKind,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub policy_reference: Option<String>,
    pub prompt: Option<String>,
    pub resume_from_agent_run_id: Option<String>,
    pub automation_attempt_id: Option<String>,
    pub required_skills: Vec<String>,
    pub working_directory_identity: String,
    pub design_directory_identity: Option<String>,
    pub document_relative_path: Option<String>,
    pub columns: u16,
    pub rows: u16,
}

impl CreateTerminalSession {
    /// Validate the caller-owned request shape before launch authority reads
    /// any policy. Interactive requests may omit provider and other launch
    /// material because authority supplies those fields in the next stage.
    pub(crate) fn validate_identity_and_geometry(&self) -> Result<(), TerminalLaunchError> {
        for value in [
            &self.client_request_id,
            &self.project_id,
            &self.issue_id,
            &self.module_id,
            &self.target_id,
            &self.working_directory_identity,
        ] {
            if value.trim().is_empty() || value.len() > 255 || value.chars().any(char::is_control) {
                return Err(invalid("A terminal launch identity is invalid."));
            }
        }
        if !(1..=500).contains(&self.columns) || !(1..=500).contains(&self.rows) {
            return Err(invalid("The terminal launch geometry is invalid."));
        }
        Ok(())
    }

    /// Validate the fully resolved launch before it can be persisted.
    pub(crate) fn validate(&self) -> Result<(), TerminalLaunchError> {
        self.validate_identity_and_geometry()?;
        if (self.kind == TerminalLaunchKind::DocumentChat) != self.document_relative_path.is_some()
        {
            return Err(invalid("Document chat requires one document identity."));
        }
        if self.required_skills.iter().any(|value| {
            value.trim().is_empty() || value.len() > 128 || value.chars().any(char::is_control)
        }) {
            return Err(invalid("A required skill identity is invalid."));
        }
        if self.kind == TerminalLaunchKind::Shell {
            if self.provider.is_some()
                || self.model.is_some()
                || self.reasoning.is_some()
                || self.policy_reference.is_some()
                || self.prompt.is_some()
                || self.resume_from_agent_run_id.is_some()
                || self.automation_attempt_id.is_some()
                || !self.required_skills.is_empty()
                || self.design_directory_identity.is_some()
                || self.document_relative_path.is_some()
            {
                return Err(invalid("A shell launch cannot carry agent metadata."));
            }
        } else if self.provider.as_deref().is_none_or(str::is_empty) {
            return Err(invalid("An agent terminal launch requires a provider."));
        }
        Ok(())
    }

    pub(crate) fn agent_run_id(&self) -> String {
        derived("terminal-agent-run", &self.client_request_id)
    }

    pub(crate) fn effect_id(&self) -> String {
        derived("terminal-launch-effect", &self.client_request_id)
    }

    pub(crate) fn terminal_task_id(&self) -> String {
        match self.kind {
            TerminalLaunchKind::Planning | TerminalLaunchKind::Instant => {
                crate::documents::SCRATCH_TASK_ID.to_owned()
            }
            TerminalLaunchKind::Shell => crate::documents::SCRATCH_TASK_ID.to_owned(),
            TerminalLaunchKind::Task
            | TerminalLaunchKind::DocumentChat
            | TerminalLaunchKind::Automation => self.issue_id.clone(),
        }
    }
}

fn derived(domain: &str, request_id: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(domain.as_bytes());
    hash.update([0]);
    hash.update(request_id.as_bytes());
    format!("{:x}", hash.finalize())[..32].to_owned()
}

fn invalid(message: &'static str) -> TerminalLaunchError {
    TerminalLaunchError::new(TerminalLaunchErrorCode::InvalidRequest, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell() -> CreateTerminalSession {
        CreateTerminalSession {
            client_request_id: "shell-request".to_owned(),
            project_id: "project".to_owned(),
            issue_id: "module".to_owned(),
            module_id: "module".to_owned(),
            target_id: "module".to_owned(),
            kind: TerminalLaunchKind::Shell,
            provider: None,
            model: None,
            reasoning: None,
            policy_reference: None,
            prompt: None,
            resume_from_agent_run_id: None,
            automation_attempt_id: None,
            required_skills: Vec::new(),
            working_directory_identity: "module:module".to_owned(),
            design_directory_identity: None,
            document_relative_path: None,
            columns: 80,
            rows: 24,
        }
    }

    #[test]
    fn shell_requests_accept_no_agent_metadata() {
        assert!(shell().validate().is_ok());
        let mut provider = shell();
        provider.provider = Some("codex".to_owned());
        assert!(provider.validate().is_err());
        let mut prompt = shell();
        prompt.prompt = Some("pretend this is an agent".to_owned());
        assert!(prompt.validate().is_err());
        let mut resume = shell();
        resume.resume_from_agent_run_id = Some("old-shell".to_owned());
        assert!(resume.validate().is_err());
    }

    #[test]
    fn unresolved_interactive_requests_accept_identity_only_until_authority_runs() {
        let mut request = shell();
        request.kind = TerminalLaunchKind::Task;
        request.issue_id = "task".to_owned();
        request.target_id = "task".to_owned();
        request.working_directory_identity = "task:task".to_owned();

        assert!(request.validate_identity_and_geometry().is_ok());
        assert!(request.validate().is_err());
    }

    #[test]
    fn client_request_identity_determines_run_effect_and_restart_identity() {
        let first = shell();
        let replay = shell();
        let mut restart = shell();
        restart.client_request_id = "shell-restart".to_owned();
        assert_eq!(first.agent_run_id(), replay.agent_run_id());
        assert_eq!(first.effect_id(), replay.effect_id());
        assert_ne!(first.agent_run_id(), restart.agent_run_id());
        assert_ne!(first.effect_id(), restart.effect_id());
    }
}
