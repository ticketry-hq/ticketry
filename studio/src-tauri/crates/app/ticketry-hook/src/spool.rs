use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::cli::HookInvocation;

const MAX_HOOK_BYTES: u64 = 1024 * 1024;

pub fn run(invocation: &HookInvocation, input: impl Read) -> io::Result<()> {
    let root_metadata = fs::symlink_metadata(&invocation.spool_dir)?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "hook spool root must be a real directory",
        ));
    }
    let mut payload = Vec::new();
    input.take(MAX_HOOK_BYTES + 1).read_to_end(&mut payload)?;
    if payload.len() as u64 > MAX_HOOK_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "hook payload exceeds spool limit",
        ));
    }

    let stem = unique_stem()?;
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
        fs::rename(&temporary_path, &final_path)?;
        File::open(&invocation.spool_dir)?.sync_data()
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary_path);
    }
    result
}

fn unique_stem() -> io::Result<String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| io::Error::other("system clock is before Unix epoch"))?
        .as_nanos();
    Ok(format!("{}-{nanos}", std::process::id()))
}

fn create_private_file(path: &Path) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}
