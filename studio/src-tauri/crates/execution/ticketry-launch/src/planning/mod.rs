//! Approved provider launch planning.
//!
//! Durable launch material contains policy and identity facts only. Provider
//! executables, hook commands, MCP authorization, settings overlays, and
//! concrete workspace paths are resolved when an effect is executed.

mod error;
#[cfg(test)]
mod golden_tests;
mod materialize;
mod prompt;
mod provider;
mod types;

pub use error::{LaunchPlanningError, LaunchPlanningErrorCode};
pub use materialize::{materialize, ExecutionAuthority};
pub use prompt::{
    build_document_chat_prompt, build_instant_prompt, build_planning_prompt, build_task_prompt,
    DocumentChatPrompt, InstantPrompt, ModulePromptFacts, PlanningPrompt, TaskPromptFacts,
    TaskPromptInput, TaskSummary,
};
pub use provider::{provider_contract, Provider, ProviderContract, TimeoutUnit};
pub use types::{
    DurableLaunchMaterial, LaunchKind, MaterializedLaunch, ProviderOptions, RuntimeSettings,
    WorkspaceIdentity,
};
