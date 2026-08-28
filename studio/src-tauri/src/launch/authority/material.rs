use crate::terminal::launch::CreateTerminalSession;

/// Everything a launch persists that a caller may not choose.
///
/// The resolver returns one of these for every interactive launch and the
/// Terminal Launch service overwrites the submitted request with it, so the
/// durable launch material is a copy of policy rather than a copy of the
/// request.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ResolvedLaunchMaterial {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub policy_reference: Option<String>,
    pub prompt: Option<String>,
    pub required_skills: Vec<String>,
    pub design_directory_identity: Option<String>,
    pub document_relative_path: Option<String>,
}

impl ResolvedLaunchMaterial {
    /// Replace every caller-controlled launch field with the resolved one.
    /// Identities, geometry, and request identity are left untouched: those
    /// are the only things the caller is allowed to choose.
    pub fn apply(self, request: &mut CreateTerminalSession) {
        request.provider = self.provider;
        request.model = self.model;
        request.reasoning = self.reasoning;
        request.policy_reference = self.policy_reference;
        request.prompt = self.prompt;
        request.required_skills = self.required_skills;
        request.design_directory_identity = self.design_directory_identity;
        request.document_relative_path = self.document_relative_path;
    }
}
