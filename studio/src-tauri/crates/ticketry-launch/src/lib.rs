//! What a launch is allowed to be, before anything is spawned.
//!
//! Every agent run starts as a request — launch this Work Item, this module,
//! this document, with this agent and this free text — and this crate is the
//! part of that path that decides, rather than executes. [`terminal_session`]
//! is the caller-owned request contract itself, owned here because launch
//! authority resolves it and the terminal slice executes it.
//! [`authority`] answers the one question asked before anything is persisted:
//! what launch policy actually governs this run, drawn from the Work Item, its
//! module and the global default rather than from the caller. [`paths`] fixes
//! where the run may start — its working directory and its design directory —
//! against the worktree that owns them. [`planning`] resolves durable launch
//! material into the concrete provider command, hook wiring, MCP endpoint and
//! settings overlay an effect executes with. [`trace_reasons`] renders this
//! crate's refusal codes as the stable names the launch trace in
//! `ticketry-diagnostics` reports; the trace emitter itself lives there so
//! nothing below launch has to read back up into it.
//!
//! The module tree is implementation detail. These explicit exports are the
//! caller-owned launch, authority, planning, path, and trace seams. In
//! particular, the terminal and Graph Run integrations use the request and
//! planning types here without reaching into implementation modules.

mod authority;
mod paths;
mod planning;
mod terminal_session;
mod trace_reasons;

pub use authority::{
    compose_task_prompt, InteractiveLaunchAuthority, LaunchAuthorityError,
    LaunchAuthorityErrorCode, LaunchAuthorityService, ResolvedLaunchMaterial, TaskPromptSource,
};
pub use paths::{
    LaunchPathsError, LaunchPathsErrorCode, LaunchPathsRequest, LaunchPathsService,
    LaunchPathsView, LaunchScope, WorktreeUse,
};
pub use planning::{
    build_document_chat_prompt, build_instant_prompt, build_planning_prompt, build_task_prompt,
    materialize, provider_contract, DocumentChatPrompt, DurableLaunchMaterial, ExecutionAuthority,
    InstantPrompt, LaunchKind, LaunchPlanningError, LaunchPlanningErrorCode, MaterializedLaunch,
    ModulePromptFacts, PlanningPrompt, Provider, ProviderContract, ProviderOptions,
    RuntimeSettings, TaskPromptFacts, TaskPromptInput, TaskSummary, TimeoutUnit, WorkspaceIdentity,
};
pub use terminal_session::{
    CreateTerminalSession, TerminalLaunchError, TerminalLaunchErrorCode, TerminalLaunchKind,
};
pub use trace_reasons::{authority_reason, planning_reason};
