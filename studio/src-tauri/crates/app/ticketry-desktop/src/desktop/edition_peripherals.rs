//! Host peripherals only some editions compose: the LaunchKey MIDI plugin with
//! its shutdown disconnect, and Handy voice transcription with the microphone
//! request that serves it.
//!
//! Both editions compile this code and its dependencies; the compiled edition
//! decides only whether each piece joins the running application.

use tauri::ipc::Invoke;
use tauri::{AppHandle, Builder, Runtime};
use tauri_plugin_launchkey_adaptor::{LaunchkeyAdaptorExt, PortName};
use ticketry_edition::{has, EditionCapability};

/// The name the LaunchKey adaptor plugin registers under.
#[cfg(test)]
pub(crate) const LAUNCHKEY_PLUGIN: &str = "launchkey-adaptor";
const HANDY_TOGGLE_COMMAND: &str = "desktop_toggle_handy_transcription";

/// Adds the LaunchKey adaptor plugin where the edition grants LaunchKey MIDI.
pub(crate) fn with_launchkey_plugin<R: Runtime>(
    builder: Builder<R>,
    after_init: impl FnOnce(Builder<R>) -> Builder<R>,
) -> Builder<R> {
    if !has(EditionCapability::LaunchkeyMidi) {
        return builder;
    }
    after_init(builder.plugin(tauri_plugin_launchkey_adaptor::init()))
}

/// Clears the DAW pad light and disconnects the LaunchKey before exit, when the
/// plugin was composed; otherwise there is nothing to release.
pub(crate) fn release_launchkey<R: Runtime>(application: &AppHandle<R>) {
    release_launchkey_with(|| {
        let launchkey = application.launchkey_adaptor();
        let _ = launchkey.send(PortName::Daw, &[0x9f, 0x0c, 0]);
        let _ = launchkey.disconnect();
    });
}

fn release_launchkey_with(disconnect: impl FnOnce()) {
    if has(EditionCapability::LaunchkeyMidi) {
        disconnect();
    }
}

/// Routes the Handy toggle command ahead of `native` where the edition grants
/// voice transcription; elsewhere the command is not registered at all.
pub(crate) fn with_voice_transcription_command<R, N>(
    native: N,
) -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static
where
    R: Runtime,
    N: Fn(Invoke<R>) -> bool + Send + Sync + 'static,
{
    let voice = voice_transcription_handler::<R>();
    move |invoke| {
        if has(EditionCapability::VoiceTranscription)
            && invoke.message.command() == HANDY_TOGGLE_COMMAND
        {
            voice(invoke)
        } else {
            native(invoke)
        }
    }
}

fn voice_transcription_handler<R: Runtime>() -> impl Fn(Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![crate::desktop::handy::desktop_toggle_handy_transcription]
}

/// Asks for microphone authorization on `Ready` where voice transcription is
/// granted; Pocock never prompts for the microphone.
pub(crate) fn request_microphone_on_ready(request: impl FnOnce()) {
    if has(EditionCapability::VoiceTranscription) {
        request();
    }
}

#[cfg(test)]
#[path = "edition_peripherals_tests.rs"]
mod tests;
