pub use ticketry_provider::{Provider, TimeoutUnit};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ProviderContract {
    pub slug: &'static str,
    pub invocation_prefix: &'static str,
    pub ready_composer_marker: Option<&'static str>,
    pub supports_model: bool,
    pub supports_reasoning: bool,
    pub supports_resume: bool,
    pub supports_worktracker_mcp: bool,
    pub supports_required_skills: bool,
    pub hook_events: &'static [&'static str],
    pub hook_timeout: u64,
    pub hook_timeout_unit: TimeoutUnit,
    pub settings_environment: Option<&'static str>,
}

impl ProviderContract {
    pub fn is_ready_composer(self, screen: &[u8]) -> bool {
        self.launch_metadata().is_ready_composer(screen)
    }

    /// The composer line and everything the provider renders below it, with
    /// terminal control sequences removed. `None` when the marker is absent
    /// from the capture.
    ///
    /// Whether typed text landed is only observable here. A provider that
    /// collapses a multi-line paste renders a placeholder in place of the
    /// pasted body, and a provider whose marker *is* the empty composer's
    /// placeholder stops rendering the marker once the composer holds text.
    /// Neither shows the payload, so callers compare this region across the
    /// paste rather than searching the capture for the text itself.
    pub fn composer_region(self, screen: &[u8]) -> Option<String> {
        self.launch_metadata().composer_region(screen)
    }

    fn launch_metadata(self) -> ticketry_provider::ProviderLaunchMetadata {
        ticketry_provider::ProviderLaunchMetadata {
            invocation_prefix: self.invocation_prefix,
            ready_composer_marker: self.ready_composer_marker,
            supports_model: self.supports_model,
            supports_reasoning: self.supports_reasoning,
            supports_resume: self.supports_resume,
            supports_worktracker_mcp: self.supports_worktracker_mcp,
            supports_required_skills: self.supports_required_skills,
            hook_events: self.hook_events,
            hook_timeout: self.hook_timeout,
            hook_timeout_unit: self.hook_timeout_unit,
            settings_environment: self.settings_environment,
        }
    }
}

pub fn provider_contract(provider: Provider) -> ProviderContract {
    let contract = ticketry_provider::provider_contract(provider);
    let metadata = contract.metadata();
    let launch = contract.launch_metadata();
    ProviderContract {
        slug: metadata.slug,
        invocation_prefix: launch.invocation_prefix,
        ready_composer_marker: launch.ready_composer_marker,
        supports_model: launch.supports_model,
        supports_reasoning: launch.supports_reasoning,
        supports_resume: launch.supports_resume,
        supports_worktracker_mcp: launch.supports_worktracker_mcp,
        supports_required_skills: launch.supports_required_skills,
        hook_events: launch.hook_events,
        hook_timeout: launch.hook_timeout,
        hook_timeout_unit: launch.hook_timeout_unit,
        settings_environment: launch.settings_environment,
    }
}

#[cfg(test)]
mod prompt_delivery_contract_tests {
    use super::*;

    #[test]
    fn provider_contracts_own_invocation_prefixes_and_ready_composer_markers() {
        let cases = [
            (Provider::Claude, "/", "\u{1b}[32m\u{276f}\u{1b}[0m "),
            (Provider::Codex, "$", "\u{203a} Ask Codex to do anything"),
            (
                Provider::Gemini,
                "/",
                "> Type your message or @path/to/file",
            ),
            (Provider::Agy, "/", "> you: "),
        ];

        for (provider, prefix, screen) in cases {
            let contract = provider_contract(provider);
            assert_eq!(contract.invocation_prefix, prefix);
            assert!(contract.is_ready_composer(screen.as_bytes()));
        }
    }

    #[test]
    fn codex_startup_prompt_is_not_a_ready_composer() {
        assert!(!provider_contract(Provider::Codex)
            .is_ready_composer("\u{203a} Selected workflow prompt:\n  Start the task".as_bytes()));
    }

    #[test]
    fn the_composer_region_starts_at_the_marker_and_runs_to_the_end_of_the_capture() {
        let region = provider_contract(Provider::Claude)
            .composer_region(
                "transcript above\n\u{276f} [Pasted text #1 +12 lines]\n? for shortcuts".as_bytes(),
            )
            .expect("the marker is on screen");

        assert_eq!(
            region,
            "\u{276f} [Pasted text #1 +12 lines]\n? for shortcuts"
        );
    }

    #[test]
    fn a_capture_without_the_marker_has_no_composer_region() {
        assert!(provider_contract(Provider::Codex)
            .composer_region(b"working")
            .is_none());
        let mut contract = provider_contract(Provider::Claude);
        contract.ready_composer_marker = None;
        assert!(contract.composer_region("\u{276f} ".as_bytes()).is_none());
    }

    #[test]
    fn a_contract_without_a_marker_is_never_ready() {
        let mut contract = provider_contract(Provider::Claude);
        contract.ready_composer_marker = None;

        assert!(!contract.is_ready_composer(b"ready"));
    }
}
