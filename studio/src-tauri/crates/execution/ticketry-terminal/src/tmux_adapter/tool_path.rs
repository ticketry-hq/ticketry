//! Approved executable resolution without launch-specific side effects.

use std::path::PathBuf;

use ticketry_tool_discovery::{discover_tool, SupportedTool, ToolHealth};

use super::TmuxAdapterError;

pub(crate) struct ApprovedToolResolution {
    pub(crate) result: Result<PathBuf, TmuxAdapterError>,
    pub(crate) candidate_path: Option<String>,
    pub(crate) candidate_version: Option<String>,
    pub(crate) refusal_reason: Option<&'static str>,
}

pub fn approved_tool_path(tool: SupportedTool) -> Result<PathBuf, TmuxAdapterError> {
    resolve_approved_tool_path(tool).result
}

pub(crate) fn resolve_approved_tool_path(tool: SupportedTool) -> ApprovedToolResolution {
    let item = discover_tool(tool);
    let candidate_path = item.path.clone();
    let candidate_version = item.version.clone();
    if item.health != ToolHealth::Ready {
        return ApprovedToolResolution {
            result: Err(TmuxAdapterError::Unavailable(
                item.guidance
                    .unwrap_or_else(|| "approved executable was not found".into()),
            )),
            candidate_path,
            candidate_version,
            refusal_reason: Some("executable_not_ready"),
        };
    }
    match item
        .path
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
    {
        Some(path) => ApprovedToolResolution {
            result: Ok(path),
            candidate_path,
            candidate_version,
            refusal_reason: None,
        },
        None => ApprovedToolResolution {
            result: Err(TmuxAdapterError::Unavailable(
                "approved executable has no absolute path".into(),
            )),
            candidate_path,
            candidate_version,
            refusal_reason: Some("executable_path_not_absolute"),
        },
    }
}
