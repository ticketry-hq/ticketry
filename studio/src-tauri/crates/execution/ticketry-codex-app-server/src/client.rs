use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{broadcast, Mutex};

use crate::{CodexAppServerError, CodexThreadTitleReader};

const RESPONSE_TIMEOUT: Duration = Duration::from_secs(5);
const RESTART_POLL_INTERVAL: Duration = Duration::from_millis(100);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_secs(1);
const MAX_RESTART_ATTEMPTS: u32 = 5;
const MAX_RESTART_DELAY: Duration = Duration::from_millis(1_600);

#[derive(Clone)]
pub struct CodexAppServerClient {
    resident: Arc<Mutex<Resident>>,
    restarts: broadcast::Sender<()>,
}

impl CodexAppServerClient {
    pub async fn start(executable: impl AsRef<Path>) -> Result<Self, CodexAppServerError> {
        let restarts = broadcast::channel(1).0;
        let mut resident = Resident::new(executable.as_ref().to_path_buf(), restarts.clone());
        resident.connect().await?;
        let resident = Arc::new(Mutex::new(resident));
        tokio::spawn(supervise(Arc::downgrade(&resident)));
        Ok(Self { resident, restarts })
    }

    pub fn subscribe_restarts(&self) -> broadcast::Receiver<()> {
        self.restarts.subscribe()
    }
}

#[async_trait]
impl CodexThreadTitleReader for CodexAppServerClient {
    async fn read_thread_title(
        &self,
        thread_id: &str,
    ) -> Result<Option<String>, CodexAppServerError> {
        let mut resident = self.resident.lock().await;
        let result = resident
            .request(
                "thread/read",
                json!({"threadId": thread_id, "includeTurns": false}),
            )
            .await?;
        let response: ThreadReadResponse = serde_json::from_value(result).map_err(|error| {
            let error = CodexAppServerError::protocol(error.to_string());
            resident.log_current_failure(&error);
            error
        })?;
        Ok(response
            .thread
            .name
            .map(|name| name.trim().to_owned())
            .filter(|name| !name.is_empty()))
    }
}

struct Resident {
    executable: PathBuf,
    connection: Option<Connection>,
    next_request_id: u64,
    restarts: broadcast::Sender<()>,
    restart_attempts: u32,
    restart_after: Instant,
    unavailable: bool,
    notify_when_verified: bool,
    recovery_probe_pending: bool,
}

impl Resident {
    fn new(executable: PathBuf, restarts: broadcast::Sender<()>) -> Self {
        Self {
            executable,
            connection: None,
            next_request_id: 1,
            restarts,
            restart_attempts: 0,
            restart_after: Instant::now(),
            unavailable: false,
            notify_when_verified: false,
            recovery_probe_pending: false,
        }
    }

    async fn connect(&mut self) -> Result<(), CodexAppServerError> {
        let mut connection = Connection::spawn(&self.executable).await?;
        let request_id = self.take_request_id();
        connection
            .request(
                request_id,
                "initialize",
                json!({
                    "clientInfo": {
                        "name": "ticketry",
                        "title": "Ticketry",
                        "version": env!("CARGO_PKG_VERSION"),
                    }
                }),
            )
            .await?;
        self.connection = Some(connection);
        Ok(())
    }

    async fn recover(&mut self) -> Result<(), CodexAppServerError> {
        if self.unavailable || self.restart_attempts >= MAX_RESTART_ATTEMPTS {
            self.unavailable = true;
            return Err(CodexAppServerError::unavailable(
                "codex app-server title reader unavailable after repeated restarts",
            ));
        }
        if Instant::now() < self.restart_after {
            return Err(CodexAppServerError::unavailable(
                "codex app-server title reader unavailable while restart is backing off",
            ));
        }

        self.restart_attempts += 1;
        let result = self.connect().await;
        self.recovery_probe_pending = result.is_ok();
        self.restart_after = Instant::now() + restart_delay(self.restart_attempts);
        if result.is_err() && self.restart_attempts >= MAX_RESTART_ATTEMPTS {
            self.unavailable = true;
        }
        result
    }

    async fn request(
        &mut self,
        method: &'static str,
        params: Value,
    ) -> Result<Value, CodexAppServerError> {
        if self.connection.is_none() {
            self.recover().await?;
        }
        let request_id = self.take_request_id();
        let result = self
            .connection
            .as_mut()
            .expect("connect installs a resident connection")
            .request(request_id, method, params)
            .await;
        if let Err(error) = &result {
            self.log_current_failure(error);
        }
        match result {
            Err(error) if error.is_transport() => {
                self.notify_when_verified = true;
                self.record_connection_loss();
                Err(error)
            }
            result => {
                self.record_served_request();
                result
            }
        }
    }

    fn take_request_id(&mut self) -> u64 {
        let request_id = self.next_request_id;
        self.next_request_id += 1;
        request_id
    }

    fn log_current_failure(&mut self, error: &CodexAppServerError) {
        if let Some(connection) = self.connection.as_mut() {
            connection.log_failure(error);
        }
    }

    fn record_connection_loss(&mut self) {
        self.notify_when_verified |= self
            .connection
            .take()
            .is_some_and(|connection| connection.served_request);
        self.recovery_probe_pending = false;
        if self.restart_attempts == 0 {
            self.restart_after = Instant::now() + RESTART_POLL_INTERVAL;
        }
    }

    fn record_served_request(&mut self) {
        if let Some(connection) = self.connection.as_mut() {
            connection.served_request = true;
        }
        self.restart_attempts = 0;
        self.restart_after = Instant::now();
        if std::mem::take(&mut self.notify_when_verified) {
            let _ = self.restarts.send(());
        }
    }

    async fn restart_if_exited(&mut self) -> bool {
        if self.unavailable {
            return false;
        }
        if let Some(connection) = self.connection.as_mut() {
            if !connection.has_exited().unwrap_or(true) {
                self.recovery_probe_pending = false;
                if self.notify_when_verified {
                    self.notify_when_verified = false;
                    let _ = self.restarts.send(());
                }
                return true;
            }
            self.record_connection_loss();
        }
        let _ = self.recover().await;
        !self.unavailable
    }

    fn next_poll_delay(&self) -> Option<Duration> {
        if self.unavailable {
            return None;
        }
        match self.connection.as_ref() {
            Some(_) if self.recovery_probe_pending => Some(RESTART_POLL_INTERVAL),
            Some(_) => Some(HEALTH_POLL_INTERVAL),
            None => Some(self.restart_after.saturating_duration_since(Instant::now())),
        }
    }
}

async fn supervise(resident: Weak<Mutex<Resident>>) {
    loop {
        let Some(resident) = resident.upgrade() else {
            return;
        };
        let delay = {
            let mut resident = resident.lock().await;
            if !resident.restart_if_exited().await {
                return;
            }
            resident.next_poll_delay()
        };
        let Some(delay) = delay else {
            return;
        };
        tokio::time::sleep(delay).await;
    }
}

fn restart_delay(attempt: u32) -> Duration {
    RESTART_POLL_INTERVAL
        .saturating_mul(1 << attempt.saturating_sub(1))
        .min(MAX_RESTART_DELAY)
}

struct Connection {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    failure_logged: bool,
    served_request: bool,
}

impl Connection {
    fn has_exited(&mut self) -> Result<bool, CodexAppServerError> {
        self.child
            .try_wait()
            .map(|status| status.is_some())
            .map_err(|error| CodexAppServerError::transport(error.to_string()))
    }

    async fn spawn(executable: &Path) -> Result<Self, CodexAppServerError> {
        let mut child = Command::new(executable)
            .args(["app-server", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|error| CodexAppServerError::transport(error.to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| CodexAppServerError::transport("app-server stdin was not piped"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CodexAppServerError::transport("app-server stdout was not piped"))?;
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            failure_logged: false,
            served_request: false,
        })
    }

    fn log_failure(&mut self, error: &CodexAppServerError) {
        if !self.failure_logged {
            eprintln!("Ticketry could not read a Codex thread title: {error}");
            self.failure_logged = true;
        }
    }

    async fn request(
        &mut self,
        request_id: u64,
        method: &'static str,
        params: Value,
    ) -> Result<Value, CodexAppServerError> {
        tokio::time::timeout(
            RESPONSE_TIMEOUT,
            self.request_without_timeout(request_id, method, params),
        )
        .await
        .map_err(|_| CodexAppServerError::timeout(method))?
    }

    async fn request_without_timeout(
        &mut self,
        request_id: u64,
        method: &'static str,
        params: Value,
    ) -> Result<Value, CodexAppServerError> {
        let request = json!({"id": request_id, "method": method, "params": params});
        let mut bytes = serde_json::to_vec(&request)
            .map_err(|error| CodexAppServerError::protocol(error.to_string()))?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .await
            .map_err(|error| CodexAppServerError::transport(error.to_string()))?;
        self.stdin
            .flush()
            .await
            .map_err(|error| CodexAppServerError::transport(error.to_string()))?;

        loop {
            let mut line = String::new();
            let read = self
                .stdout
                .read_line(&mut line)
                .await
                .map_err(|error| CodexAppServerError::transport(error.to_string()))?;
            if read == 0 {
                return Err(CodexAppServerError::transport(
                    "app-server closed stdout before replying",
                ));
            }
            let response: Value = serde_json::from_str(&line)
                .map_err(|error| CodexAppServerError::protocol(error.to_string()))?;
            if response.get("id") != Some(&json!(request_id)) {
                continue;
            }
            if let Some(error) = response.get("error") {
                let error: RpcError = serde_json::from_value(error.clone())
                    .map_err(|error| CodexAppServerError::protocol(error.to_string()))?;
                return Err(CodexAppServerError::protocol(error.message));
            }
            return response
                .get("result")
                .cloned()
                .ok_or_else(|| CodexAppServerError::protocol("app-server response has no result"));
        }
    }
}

#[derive(Deserialize)]
struct RpcError {
    message: String,
}

#[derive(Deserialize)]
struct ThreadReadResponse {
    thread: ThreadSummary,
}

#[derive(Deserialize)]
struct ThreadSummary {
    name: Option<String>,
}
