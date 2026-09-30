#[cfg(unix)]
mod unix {
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;
    use std::time::Duration;

    use serde_json::Value;
    use tempfile::TempDir;
    use ticketry_codex_app_server::{CodexAppServerClient, CodexThreadTitles};

    /// One scripted `codex app-server` over stdio, shared by every test.
    ///
    /// It reads its behavior and its capture files from the directory of the
    /// symlink it was launched through, so each test gets an isolated
    /// app-server without installing a new executable. That matters on macOS,
    /// where first-exec scanning of a freshly written script serialises across
    /// concurrent tests and can outlast the client's five-second timeout.
    const APP_SERVER_SCRIPT: &str = r#"#!/bin/sh
home=$(dirname "$0")
mode=$(cat "$home/mode")
printf '%s\n' launched >> "$home/launches"
if [ "$mode" = exiting ]; then
  IFS= read -r request
  printf '{"id":1,"result":{}}\n'
  exit 0
fi
if [ "$mode" = stuck ]; then
  printf '{"id":1,"result":{}}\n'
  IFS= read -r request
  printf '%s\n' "$request" >> "$home/requests.jsonl"
  while :; do sleep 30; done
fi
request_id=0
renamed=''
while IFS= read -r request; do
  printf '%s\n' "$request" >> "$home/requests.jsonl"
  request_id=$((request_id + 1))
  if [ "$request_id" -eq 1 ]; then
    printf '{"id":%s,"result":{}}\n' "$request_id"
    continue
  fi
  if [ "$mode" = failing ]; then
    printf '{"id":%s,"error":{"code":-32602,"message":"%s"}}\n' \
      "$request_id" "$(cat "$home/message")"
    continue
  fi
  case "$request" in
    *'"thread/name/set"'*)
      renamed=$(printf '%s' "$request" | sed 's/.*"name":"\([^"]*\)".*/\1/')
      printf '{"id":%s,"result":{}}\n' "$request_id"
      ;;
    *'"thread/read"'*)
      if [ -n "$renamed" ]; then
        printf '{"id":%s,"result":{"thread":{"name":"%s"}}}\n' "$request_id" "$renamed"
      else
        printf '{"id":%s,"result":{"thread":%s}}\n' "$request_id" "$(cat "$home/thread.json")"
      fi
      ;;
    *)
      printf '{"id":%s,"result":{}}\n' "$request_id"
      ;;
  esac
done
"#;

    /// Install the shared script once per test binary and hand back its path.
    fn shared_script() -> &'static Path {
        static SCRIPT: OnceLock<(TempDir, PathBuf)> = OnceLock::new();
        let (_directory, path) = SCRIPT.get_or_init(|| {
            let directory = tempfile::tempdir().expect("create shared app-server directory");
            let path = directory.path().join("codex-app-server");
            fs::write(&path, APP_SERVER_SCRIPT).expect("write shared app-server");
            let mut permissions = fs::metadata(&path)
                .expect("read shared app-server metadata")
                .permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&path, permissions).expect("make shared app-server executable");
            (directory, path)
        });
        path
    }

    struct ScriptedAppServer {
        _directory: TempDir,
        executable: PathBuf,
        requests: PathBuf,
        launches: PathBuf,
    }

    impl ScriptedAppServer {
        fn named(title: &str) -> Self {
            Self::responding_with_thread(serde_json::json!({"name": title}))
        }

        fn responding_with_thread(thread: Value) -> Self {
            let server = Self::running("serving");
            server.write(
                "thread.json",
                &serde_json::to_string(&thread).expect("serialize thread"),
            );
            server
        }

        fn failing_with(message: &str) -> Self {
            let server = Self::running("failing");
            server.write("message", message);
            server
        }

        fn initializing_then_exiting() -> Self {
            Self::running("exiting")
        }

        fn never_answering_reads() -> Self {
            Self::running("stuck")
        }

        fn running(mode: &str) -> Self {
            let directory = tempfile::tempdir().expect("create scripted app-server directory");
            let executable = directory.path().join("codex");
            std::os::unix::fs::symlink(shared_script(), &executable)
                .expect("link the shared app-server");
            let server = Self {
                requests: directory.path().join("requests.jsonl"),
                launches: directory.path().join("launches"),
                _directory: directory,
                executable,
            };
            server.write("mode", mode);
            server
        }

        fn write(&self, name: &str, contents: &str) {
            fs::write(
                self.executable
                    .parent()
                    .expect("scripted app-server has a directory")
                    .join(name),
                contents,
            )
            .expect("write scripted app-server input");
        }

        fn requests(&self) -> Vec<Value> {
            fs::read_to_string(&self.requests)
                .expect("read captured requests")
                .lines()
                .map(|line| serde_json::from_str(line).expect("captured request is JSON"))
                .collect()
        }

        fn methods(&self) -> Vec<String> {
            self.requests()
                .iter()
                .map(|request| request["method"].as_str().unwrap_or_default().to_owned())
                .collect()
        }

        fn launch_count(&self) -> usize {
            fs::read_to_string(&self.launches)
                .unwrap_or_default()
                .lines()
                .count()
        }
    }

    #[tokio::test]
    async fn reads_an_accepted_name_without_starting_or_resuming_the_thread() {
        let server = ScriptedAppServer::named("Fix the flaky launch test");
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let title = client
            .read_thread_title("019e9428-9788-7df0-84cd-755e1b776245")
            .await
            .expect("read thread title");
        let second_title = client
            .read_thread_title("019e9428-9788-7df0-84cd-755e1b776246")
            .await
            .expect("read a second title through the resident process");

        assert_eq!(title.as_deref(), Some("Fix the flaky launch test"));
        assert_eq!(second_title, title);
        let requests = server.requests();
        assert_eq!(requests.len(), 3);
        assert_eq!(requests[0]["method"], "initialize");
        assert_eq!(requests[0]["params"]["clientInfo"]["name"], "ticketry");
        assert_eq!(requests[1]["method"], "thread/read");
        assert_eq!(
            requests[1]["params"],
            serde_json::json!({
                "threadId": "019e9428-9788-7df0-84cd-755e1b776245",
                "includeTurns": false,
            })
        );
        assert_eq!(requests[2]["method"], "thread/read");
        assert_eq!(
            server.methods(),
            ["initialize", "thread/read", "thread/read"]
        );
    }

    #[tokio::test]
    async fn rejects_a_blank_thread_name() {
        let server = ScriptedAppServer::named("   \n  ");
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let title = client
            .read_thread_title("019e9428-9788-7df0-84cd-755e1b776245")
            .await
            .expect("read thread title");

        assert_eq!(title, None);
    }

    #[tokio::test]
    async fn ignores_preview_when_name_is_absent() {
        let server = ScriptedAppServer::responding_with_thread(
            serde_json::json!({"preview": "Private launch prompt"}),
        );
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let title = client
            .read_thread_title("019e9428-9788-7df0-84cd-755e1b776245")
            .await
            .expect("read thread title");

        assert_eq!(title, None);
    }

    #[tokio::test]
    async fn a_missing_codex_executable_starts_no_child() {
        let directory = tempfile::tempdir().expect("create empty executable directory");
        let result = CodexAppServerClient::start(directory.path().join("missing-codex")).await;

        assert!(result.is_err());
        assert!(fs::read_dir(directory.path())
            .expect("read empty executable directory")
            .next()
            .is_none());
    }

    #[tokio::test]
    async fn bounds_a_stuck_app_server_read() {
        let server = ScriptedAppServer::never_answering_reads();
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let result = tokio::time::timeout(
            Duration::from_secs(6),
            client.read_thread_title("stuck-thread"),
        )
        .await
        .expect("client applies its own response timeout");
        let error = result.expect_err("stuck read reports an error");

        assert!(error.to_string().contains("timed out"));
        assert!(!error.is_unavailable());
        assert!(!error.is_unknown_thread());
    }

    #[tokio::test]
    async fn gives_up_when_the_app_server_keeps_exiting_after_initialize() {
        let server = ScriptedAppServer::initializing_then_exiting();
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("initialize the first app-server");
        let mut restarts = client.subscribe_restarts();

        tokio::time::sleep(Duration::from_secs(3)).await;
        let bounded_launches = server.launch_count();
        assert!(
            bounded_launches <= 6,
            "spawned {bounded_launches} app-servers"
        );
        assert!(matches!(
            restarts.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));

        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(server.launch_count(), bounded_launches);
        let error = client
            .read_thread_title("unavailable-thread")
            .await
            .expect_err("reader stays unavailable after giving up");
        assert!(error.is_unavailable());
    }

    #[tokio::test]
    async fn renames_a_thread_and_reads_the_new_name_through_one_app_server() {
        let server = ScriptedAppServer::named("Old title");
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        client
            .set_thread_title("019e9428-9788-7df0-84cd-755e1b776245", "Fix the flaky test")
            .await
            .expect("rename the thread");
        let title = client
            .read_thread_title("019e9428-9788-7df0-84cd-755e1b776245")
            .await
            .expect("read the renamed thread title");

        assert_eq!(title.as_deref(), Some("Fix the flaky test"));
        assert_eq!(server.launch_count(), 1);
        let requests = server.requests();
        assert_eq!(requests[1]["method"], "thread/name/set");
        assert_eq!(
            requests[1]["params"],
            serde_json::json!({
                "threadId": "019e9428-9788-7df0-84cd-755e1b776245",
                "name": "Fix the flaky test",
            })
        );
        assert_eq!(
            server.methods(),
            ["initialize", "thread/name/set", "thread/read"]
        );
    }

    #[tokio::test]
    async fn preserves_whitespace_inside_a_requested_name() {
        let server = ScriptedAppServer::named("Old title");
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        client
            .set_thread_title("thread", "Fix  the   launch test")
            .await
            .expect("rename the thread");

        assert_eq!(
            server.requests()[1]["params"]["name"],
            "Fix  the   launch test"
        );
    }

    #[tokio::test]
    async fn classifies_an_unknown_thread_reported_by_the_app_server() {
        let server = ScriptedAppServer::failing_with("thread not found");
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let error = client
            .set_thread_title("missing-thread", "New title")
            .await
            .expect_err("an unknown thread reports an error");

        assert!(error.is_unknown_thread());
        assert!(!error.is_unavailable());
    }

    #[tokio::test]
    async fn classifies_any_other_provider_error_as_an_app_server_failure() {
        let server = ScriptedAppServer::failing_with("thread is read-only");
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let error = client
            .set_thread_title("019e9428-9788-7df0-84cd-755e1b776245", "New title")
            .await
            .expect_err("a rejected rename reports an error");

        assert!(!error.is_unknown_thread());
        assert!(!error.is_unavailable());
        assert_eq!(error.to_string(), "thread is read-only");
    }

    #[tokio::test]
    async fn bounds_a_stuck_app_server_rename() {
        let server = ScriptedAppServer::never_answering_reads();
        let client = CodexAppServerClient::start(&server.executable)
            .await
            .expect("start resident app-server");

        let result = tokio::time::timeout(
            Duration::from_secs(6),
            client.set_thread_title("stuck-thread", "New title"),
        )
        .await
        .expect("client applies its own response timeout");
        let error = result.expect_err("stuck rename reports an error");

        assert!(error.to_string().contains("thread/name/set"));
        assert!(!error.is_unavailable());
        assert!(!error.is_unknown_thread());
    }
}
