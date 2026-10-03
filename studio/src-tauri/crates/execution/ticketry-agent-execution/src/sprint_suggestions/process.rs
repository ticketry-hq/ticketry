use super::{
    output::{self, SuggestionOutput},
    snapshot::Snapshot,
    SprintSuggestionExecutor,
};
use sea_orm::EntityTrait;
use std::{path::PathBuf, process::Stdio, time::Duration};
use ticketry_entities::agent_execution;
use tokio::{io::AsyncWriteExt, process::Command};

pub(crate) fn executable() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("MUXED_APPROVED_CODEX_PATH") {
        let path = PathBuf::from(path);
        return path
            .is_file()
            .then_some(path)
            .ok_or("The configured Codex executable is unavailable.".into());
    }
    std::env::var_os("PATH")
        .and_then(|paths| {
            std::env::split_paths(&paths)
                .map(|dir| dir.join("codex"))
                .find(|path| path.is_file())
        })
        .ok_or("Codex is unavailable. Install it before finding stories.".into())
}
pub(crate) async fn run(
    service: &SprintSuggestionExecutor,
    job: &agent_execution::Model,
    snapshot: &Snapshot,
) -> Result<SuggestionOutput, String> {
    let directory = service.directory.join("executions").join(&job.id);
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|_| "The execution directory could not be created.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(|_| "The execution directory could not be secured.")?;
    }
    let result = match service.executable() {
        Ok(program) => run_in(service, job, snapshot, &directory, &program).await,
        Err(error) => Err(error),
    };
    let _ = tokio::fs::remove_dir_all(&directory).await;
    result
}
pub(super) async fn run_in(
    service: &SprintSuggestionExecutor,
    job: &agent_execution::Model,
    snapshot: &Snapshot,
    directory: &std::path::Path,
    program: &std::path::Path,
) -> Result<SuggestionOutput, String> {
    let schema_path = directory.join("output-schema.json");
    let result_path = directory.join("result.json");
    tokio::fs::write(
        &schema_path,
        serde_json::to_vec(&output::schema()).map_err(|e| e.to_string())?,
    )
    .await
    .map_err(|_| "The output schema could not be written.")?;
    let args = ticketry_provider::construct_exec(ticketry_provider::ExecConstructionRequest {
        provider: ticketry_provider::Provider::Codex,
        options: ticketry_provider::ProviderOptions {
            profile: snapshot.profile.as_deref(),
            model: snapshot.model.as_deref(),
            effort: snapshot.reasoning.as_deref(),
        },
        schema: &schema_path,
        result: &result_path,
    })
    .map_err(|e| e.to_string())?;
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .env_remove("MUXED_AGENT_RUN_ID")
        .env_remove("TICKETRY_MCP_AUTHORIZATION")
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = command.spawn().map_err(|_| "The agent could not start.")?;
    let process_group = child.id();
    let _guard = ProcessGroup(process_group);
    let prompt = snapshot.prompt()?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("The agent input is unavailable.")?;
    let _input = InputTask(tokio::spawn(async move {
        let result = stdin.write_all(prompt.as_bytes()).await;
        drop(stdin);
        result
    }));
    let deadline = tokio::time::Instant::now() + Duration::from_secs(300);
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "The agent status is unavailable.")?
        {
            stop_descendants(process_group);
            if !status.success() {
                return Err(
                    "The agent couldn't finish. Check the provider configuration and retry.".into(),
                );
            }
            let metadata = tokio::fs::metadata(&result_path)
                .await
                .map_err(|_| "The agent returned no suggestion result.")?;
            if metadata.len() > 1024 * 1024 {
                return Err("The suggestion result is too large.".into());
            }
            let bytes = tokio::fs::read(&result_path)
                .await
                .map_err(|_| "The suggestion result could not be read.")?;
            return SuggestionOutput::parse(&bytes);
        }
        let current = agent_execution::Entity::find_by_id(&job.id)
            .one(&service.database)
            .await;
        let cancelled = match current {
            Ok(Some(row)) => row.cancel_requested || row.state != "running",
            _ => true,
        };
        let too_large = tokio::fs::metadata(&result_path)
            .await
            .is_ok_and(|m| m.len() > 1024 * 1024);
        if cancelled || too_large || tokio::time::Instant::now() >= deadline {
            stop(&mut child, process_group).await;
            return Err(if cancelled {
                "Cancelled."
            } else if too_large {
                "The suggestion result is too large."
            } else {
                "The agent timed out. Retry to run it again."
            }
            .into());
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}
fn stop_descendants(group: Option<u32>) {
    #[cfg(unix)]
    if let Some(group) = group {
        // The child starts a dedicated process group, so this cannot address
        // the host or another execution's processes.
        unsafe {
            libc::kill(-(group as i32), libc::SIGKILL);
        }
    }
}
async fn stop(child: &mut tokio::process::Child, group: Option<u32>) {
    stop_descendants(group);
    let _ = child.kill().await;
    let _ = child.wait().await;
}

struct ProcessGroup(Option<u32>);
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        stop_descendants(self.0);
    }
}

struct InputTask(tokio::task::JoinHandle<std::io::Result<()>>);
impl Drop for InputTask {
    fn drop(&mut self) {
        self.0.abort();
    }
}
