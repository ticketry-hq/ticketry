//! Sandbox-safe lifecycle hook transport for packaged Ticketry sessions.
//!
//! Agent command hooks run under the agent's command sandbox.  Re-entering the
//! one-file PyInstaller backend from there fails during bootloader semaphore
//! setup, and the sandbox does not allow a direct loopback POST.  This tiny
//! dependency-free executable only writes the raw hook payload into the
//! backend-owned spool directory.  The backend normalizes and ingests it.

use std::env;
use std::fs::{self, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_HOOK_BYTES: u64 = 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
struct HookInvocation {
    agent: String,
    agent_run_id: String,
    spool_dir: PathBuf,
}

fn safe_component(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn parse_invocation<I>(arguments: I) -> Option<HookInvocation>
where
    I: IntoIterator<Item = String>,
{
    let mut arguments = arguments.into_iter();
    if arguments.next().as_deref() != Some("hook") {
        return None;
    }
    let agent = arguments.next()?;
    let mut agent_run_id = None;
    let mut spool_dir = None;

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--agent-run-id" => agent_run_id = arguments.next(),
            "--spool-dir" => spool_dir = arguments.next().map(PathBuf::from),
            // The source-Python reporter needs this argument.  The packaged
            // spool transport deliberately ignores it.
            "--lifecycle-url" => {
                arguments.next()?;
            }
            _ => return None,
        }
    }

    let agent_run_id = agent_run_id.or_else(|| env::var("MUXED_AGENT_RUN_ID").ok())?;
    let spool_dir = spool_dir?;
    if !matches!(agent.as_str(), "agy" | "claude" | "codex" | "gemini")
        || !safe_component(&agent_run_id)
        || !spool_dir.is_absolute()
    {
        return None;
    }

    Some(HookInvocation {
        agent,
        agent_run_id,
        spool_dir,
    })
}

fn unique_stem() -> Option<String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    Some(format!("{}-{nanos}", std::process::id()))
}

fn create_private_file(path: &Path) -> io::Result<std::fs::File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn spool(invocation: &HookInvocation, input: impl Read) -> io::Result<()> {
    let mut payload = Vec::new();
    input.take(MAX_HOOK_BYTES + 1).read_to_end(&mut payload)?;
    if payload.len() as u64 > MAX_HOOK_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "hook payload exceeds spool limit",
        ));
    }

    let stem =
        unique_stem().ok_or_else(|| io::Error::other("system clock is before Unix epoch"))?;
    let metadata = format!(
        "v1__{}__{}__{stem}",
        invocation.agent, invocation.agent_run_id
    );
    let temporary_path = invocation.spool_dir.join(format!(".{metadata}.tmp"));
    let final_path = invocation.spool_dir.join(format!("{metadata}.hook"));

    let result = (|| {
        let mut output = create_private_file(&temporary_path)?;
        output.write_all(&payload)?;
        output.sync_data()?;
        drop(output);
        fs::rename(&temporary_path, &final_path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

fn run() -> io::Result<()> {
    let invocation = parse_invocation(env::args().skip(1))
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid hook invocation"))?;
    spool(&invocation, io::stdin().lock())
}

fn main() {
    // A status reporter must never break the coding-agent session and must
    // leave stdout/stderr clean because providers may parse hook output.
    let _ = run();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_packaged_hook_arguments() {
        let invocation = parse_invocation(
            [
                "hook",
                "codex",
                "--agent-run-id",
                "run-123",
                "--lifecycle-url",
                "http://127.0.0.1:8787/api/lifecycle/events",
                "--spool-dir",
                "/tmp/ticketry-hooks",
            ]
            .into_iter()
            .map(str::to_owned),
        )
        .expect("valid invocation");

        assert_eq!(
            invocation,
            HookInvocation {
                agent: "codex".to_owned(),
                agent_run_id: "run-123".to_owned(),
                spool_dir: PathBuf::from("/tmp/ticketry-hooks"),
            }
        );
    }

    #[test]
    fn rejects_run_ids_that_could_escape_the_file_name() {
        assert!(parse_invocation(
            [
                "hook",
                "codex",
                "--agent-run-id",
                "../run-123",
                "--spool-dir",
                "/tmp/ticketry-hooks",
            ]
            .into_iter()
            .map(str::to_owned),
        )
        .is_none());
    }

    #[test]
    fn atomically_spools_the_raw_payload() {
        let root = env::temp_dir().join(format!(
            "ticketry-hook-test-{}",
            unique_stem().expect("unique test path")
        ));
        fs::create_dir(&root).expect("create spool");
        let invocation = HookInvocation {
            agent: "codex".to_owned(),
            agent_run_id: "run-123".to_owned(),
            spool_dir: root.clone(),
        };

        spool(
            &invocation,
            br#"{"hook_event_name":"SessionStart","session_id":"provider-1"}"#.as_slice(),
        )
        .expect("spool hook");

        let entries = fs::read_dir(&root)
            .expect("read spool")
            .map(|entry| entry.expect("entry").path())
            .collect::<Vec<_>>();
        assert_eq!(entries.len(), 1);
        assert_eq!(
            entries[0].extension().and_then(|value| value.to_str()),
            Some("hook")
        );
        assert_eq!(
            fs::read(&entries[0]).expect("read event"),
            br#"{"hook_event_name":"SessionStart","session_id":"provider-1"}"#
        );
        fs::remove_dir_all(root).expect("remove spool");
    }
}
