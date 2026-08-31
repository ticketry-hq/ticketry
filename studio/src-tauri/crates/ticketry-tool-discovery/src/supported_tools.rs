//! The named tools the desktop shell knows how to find.
//!
//! Adding a tool means adding it here and nowhere else: the executable name,
//! its approval environment variable, and the flag that makes it print a
//! version all live on the one enum.

use serde::{Deserialize, Serialize};

pub(super) const SUPPORTED_TOOLS: [SupportedTool; 5] = [
    SupportedTool::Tmux,
    SupportedTool::Claude,
    SupportedTool::Agy,
    SupportedTool::Codex,
    SupportedTool::Gemini,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportedTool {
    Tmux,
    Claude,
    Agy,
    Codex,
    Gemini,
}

impl SupportedTool {
    pub fn executable_name(self) -> &'static str {
        match self {
            Self::Tmux => "tmux",
            Self::Claude => "claude",
            Self::Agy => "agy",
            Self::Codex => "codex",
            Self::Gemini => "gemini",
        }
    }

    pub(super) fn environment_name(self) -> &'static str {
        match self {
            Self::Tmux => "MUXED_APPROVED_TMUX_PATH",
            Self::Claude => "MUXED_APPROVED_CLAUDE_PATH",
            Self::Agy => "MUXED_APPROVED_AGY_PATH",
            Self::Codex => "MUXED_APPROVED_CODEX_PATH",
            Self::Gemini => "MUXED_APPROVED_GEMINI_PATH",
        }
    }

    pub(super) fn version_argument(self) -> &'static str {
        match self {
            Self::Tmux => "-V",
            _ => "--version",
        }
    }
}
