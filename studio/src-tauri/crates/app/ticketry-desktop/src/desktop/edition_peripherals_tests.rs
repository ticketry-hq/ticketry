//! Desktop composition per edition: each test runs under plain `cargo test`
//! (Pocock) and under `--features edition-core` (Core) and asserts the
//! compiled edition's composition.

use std::cell::Cell;

use tauri::test::{get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::webview::InvokeRequest;
use tauri::{App, WebviewWindowBuilder};
use ticketry_diagnostics::FileLog;

use super::*;

fn composed_app() -> App<MockRuntime> {
    with_launchkey_plugin(mock_builder(), |builder| builder)
        .manage(FileLog::disabled())
        .invoke_handler(with_voice_transcription_command(tauri::generate_handler![]))
        .build(mock_context(noop_assets()))
        .expect("mock desktop application")
}

fn invoke(app: &App<MockRuntime>, command: &str) -> Result<serde_json::Value, serde_json::Value> {
    // A non-main label keeps the Handy command from spawning Handy itself.
    let webview = WebviewWindowBuilder::new(app, "composition-probe", Default::default())
        .build()
        .expect("probe webview");
    get_ipc_response(
        &webview,
        InvokeRequest {
            cmd: command.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: tauri::ipc::InvokeBody::default(),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<serde_json::Value>().unwrap())
}

#[test]
fn launchkey_plugin_joins_the_builder_only_where_launchkey_midi_is_granted() {
    let app = composed_app();
    let after_init_ran = Cell::new(false);
    let _ = with_launchkey_plugin(mock_builder(), |builder| {
        after_init_ran.set(true);
        builder
    });

    let composed = app.handle().remove_plugin(LAUNCHKEY_PLUGIN);

    if has(EditionCapability::LaunchkeyMidi) {
        assert!(composed, "core initializes the LaunchKey adaptor plugin");
        assert!(
            after_init_ran.get(),
            "core records LaunchKey initialization"
        );
    } else {
        assert!(
            !composed,
            "Pocock never initializes the LaunchKey adaptor plugin"
        );
        assert!(
            !after_init_ran.get(),
            "Pocock records no LaunchKey initialization"
        );
    }
}

#[test]
fn shutdown_disconnects_the_launchkey_only_where_launchkey_midi_is_granted() {
    let disconnected = Cell::new(false);
    release_launchkey_with(|| disconnected.set(true));
    assert_eq!(disconnected.get(), has(EditionCapability::LaunchkeyMidi));

    // The real release completes against the composed application in both
    // editions: Pocock must not reach for a plugin it never initialized.
    let app = composed_app();
    release_launchkey(app.handle());
}

#[test]
fn handy_command_is_registered_only_where_voice_transcription_is_granted() {
    let app = composed_app();

    let response = invoke(&app, HANDY_TOGGLE_COMMAND);

    if has(EditionCapability::VoiceTranscription) {
        assert_eq!(
            response,
            Ok(serde_json::Value::Null),
            "core registers the Handy command"
        );
    } else {
        let error = response.expect_err("Pocock does not register the Handy command");
        assert!(
            error.to_string().contains("not found"),
            "Pocock reports the Handy command as unregistered: {error}"
        );
    }
}

#[test]
fn microphone_is_requested_on_ready_only_where_voice_transcription_is_granted() {
    let requested = Cell::new(false);

    request_microphone_on_ready(|| requested.set(true));

    assert_eq!(requested.get(), has(EditionCapability::VoiceTranscription));
}
