//! Provider executable resolution for one launch attempt.

use std::path::PathBuf;
use std::time::Instant;

use ticketry_diagnostics as trace;
use ticketry_tool_discovery::SupportedTool;

use crate::tmux_adapter::{resolve_approved_tool_path, TmuxAdapterError};

pub(super) fn resolve(tool: SupportedTool) -> Result<PathBuf, TmuxAdapterError> {
    let started = Instant::now();
    let resolution = resolve_approved_tool_path(tool);
    let duration_ms = started.elapsed().as_millis();
    let consulted = ticketry_tool_discovery::consulted_discovery(tool);
    let operator_approved_path = consulted
        .operator_approved_path
        .map(|path| path.to_string_lossy().into_owned());

    trace::stage(trace::EXECUTABLE_RESOLVED, resolution.refusal_reason)
        .with("executableName", tool.executable_name())
        .with("rootsWalked", consulted.trusted_root_count)
        .with(
            "operatorApprovalConsulted",
            operator_approved_path.is_some(),
        )
        .with_optional("operatorApprovedPath", operator_approved_path)
        .with("discoveryDurationMs", duration_ms as u64)
        .with_optional("candidatePath", resolution.candidate_path.clone())
        .with_optional("candidateVersion", resolution.candidate_version.clone())
        .record();

    resolution.result
}
