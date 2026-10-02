//! Collect version output under one deadline, including inherited pipes.

use std::io::{self, Read};
use std::process::{Child, Command, Output};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const MAX_OUTPUT: usize = 64 * 1024;
const POLL_INTERVAL: Duration = Duration::from_millis(10);

pub(super) fn collect(command: &mut Command, timeout: Duration) -> Result<Output, String> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let deadline = Instant::now() + timeout;
    let mut process = ProbeProcess(
        command
            .spawn()
            .map_err(|_| "version probe could not start")?,
    );
    let stdout = reader(process.0.stdout.take().ok_or("missing probe stdout")?)?;
    let stderr = reader(process.0.stderr.take().ok_or("missing probe stderr")?)?;
    loop {
        let status = process
            .0
            .try_wait()
            .map_err(|_| "version probe could not be read")?;
        if let Some(status) = status {
            if stdout.is_finished() && stderr.is_finished() {
                return Ok(Output {
                    status,
                    stdout: finish(stdout)?,
                    stderr: finish(stderr)?,
                });
            }
        }
        if Instant::now() >= deadline {
            return Err("version probe timed out".to_owned());
        }
        thread::sleep(POLL_INTERVAL);
    }
}

fn reader(mut pipe: impl Read + Send + 'static) -> Result<JoinHandle<io::Result<Vec<u8>>>, String> {
    thread::Builder::new()
        .name("tool-version-output".to_owned())
        .spawn(move || {
            let mut output = Vec::new();
            let mut buffer = [0; 8192];
            loop {
                let count = pipe.read(&mut buffer)?;
                if count == 0 {
                    return Ok(output);
                }
                let keep = count.min(MAX_OUTPUT.saturating_sub(output.len()));
                output.extend_from_slice(&buffer[..keep]);
            }
        })
        .map_err(|_| "version probe reader could not start".to_owned())
}

fn finish(reader: JoinHandle<io::Result<Vec<u8>>>) -> Result<Vec<u8>, String> {
    reader
        .join()
        .map_err(|_| "version probe reader failed")?
        .map_err(|_| "version probe could not be read".to_owned())
}

struct ProbeProcess(Child);

impl Drop for ProbeProcess {
    fn drop(&mut self) {
        #[cfg(unix)]
        // The probe owns its process group, including helpers retaining pipes.
        // SAFETY: the negative PID addresses only the group created above.
        unsafe {
            libc::kill(-(self.0.id() as libc::pid_t), libc::SIGKILL);
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
