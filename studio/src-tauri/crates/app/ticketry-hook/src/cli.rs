use std::path::PathBuf;

pub const HELP: &str = "ticketry-hook\n\nUSAGE:\n  ticketry-hook hook <agy|claude|codex|gemini> --agent-run-id <id> --spool-dir <path>\n  ticketry-hook mcp --data-dir <absolute-path> --agent-run-id <id>\n\nMCP OPTIONS:\n  --data-dir <path>      Ticketry data directory\n  --agent-run-id <id>   Agent Run identity\n  -h, --help            Print help\n";

#[derive(Debug, PartialEq, Eq)]
pub struct HookInvocation {
    pub agent: String,
    pub agent_run_id: String,
    pub spool_dir: PathBuf,
}

#[derive(Debug, PartialEq, Eq)]
pub struct McpInvocation {
    pub agent_run_id: String,
    pub data_dir: PathBuf,
}

pub enum Invocation {
    Help,
    Hook(HookInvocation),
    Mcp(McpInvocation),
}

pub fn parse(arguments: impl IntoIterator<Item = String>) -> Result<Invocation, &'static str> {
    let mut arguments = arguments.into_iter();
    match arguments.next().as_deref() {
        Some("mcp") if matches!(arguments.size_hint(), (1, Some(1))) => {
            match arguments.next().as_deref() {
                Some("-h" | "--help") => Ok(Invocation::Help),
                _ => Err("invalid mcp invocation"),
            }
        }
        Some("mcp") => parse_mcp(arguments).map(Invocation::Mcp),
        Some("hook") => parse_hook(arguments).map(Invocation::Hook),
        Some("-h" | "--help") => Ok(Invocation::Help),
        _ => Err("expected hook or mcp; use --help for usage"),
    }
}

fn parse_mcp(mut arguments: impl Iterator<Item = String>) -> Result<McpInvocation, &'static str> {
    let mut data_dir = None;
    let mut agent_run_id = None;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--data-dir" => data_dir = arguments.next().map(PathBuf::from),
            "--agent-run-id" => agent_run_id = arguments.next(),
            _ => return Err("invalid mcp invocation"),
        }
    }
    let invocation = McpInvocation {
        data_dir: data_dir.ok_or("mcp requires --data-dir")?,
        agent_run_id: agent_run_id.ok_or("mcp requires --agent-run-id")?,
    };
    if !invocation.data_dir.is_absolute() || !safe_component(&invocation.agent_run_id) {
        return Err("mcp requires an absolute data directory and valid Agent Run ID");
    }
    Ok(invocation)
}

fn parse_hook(mut arguments: impl Iterator<Item = String>) -> Result<HookInvocation, &'static str> {
    let agent = arguments.next().ok_or("hook requires a provider")?;
    let mut agent_run_id = None;
    let mut spool_dir = None;
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--agent-run-id" => agent_run_id = arguments.next(),
            "--spool-dir" => spool_dir = arguments.next().map(PathBuf::from),
            _ => return Err("invalid hook invocation"),
        }
    }
    let invocation = HookInvocation {
        agent,
        agent_run_id: agent_run_id
            .or_else(|| std::env::var("MUXED_AGENT_RUN_ID").ok())
            .ok_or("hook requires an Agent Run ID")?,
        spool_dir: spool_dir.ok_or("hook requires --spool-dir")?,
    };
    if !matches!(
        invocation.agent.as_str(),
        "agy" | "claude" | "codex" | "gemini"
    ) || !safe_component(&invocation.agent_run_id)
        || !invocation.spool_dir.is_absolute()
    {
        return Err("invalid hook invocation");
    }
    Ok(invocation)
}

fn safe_component(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}
