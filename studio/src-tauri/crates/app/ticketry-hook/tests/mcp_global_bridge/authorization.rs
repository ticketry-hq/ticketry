use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;

use super::*;

#[tokio::test]
async fn global_mode_ignores_empty_malformed_and_nonunicode_authorization() {
    for authorization in [
        OsString::new(),
        OsString::from("malformed-secret-global-must-never-read"),
        OsString::from_vec(b"Bearer invalid-utf8-secret-\xff".to_vec()),
    ] {
        let directory = tempfile::tempdir_in("/tmp").unwrap();
        let listener = UnixListener::bind(directory.path().join("mcp.sock")).unwrap();
        let server = tokio::spawn(async move {
            let (mut read, mut write) = accept_global(&listener).await;
            initialize_server(&mut read, &mut write).await;
        });
        let mut child = bridge(&directory, Some(&authorization));
        let mut input = child.stdin.take().unwrap();
        let mut output = BufReader::new(child.stdout.take().unwrap());
        send(&mut input, initialize("ignore-env")).await;
        let response = line(&mut output).await;
        assert_eq!(response["id"], "ignore-env");
        assert!(response.get("result").is_some(), "{response}");
        server.await.unwrap();
        finish(child, input, output).await;
    }
}
