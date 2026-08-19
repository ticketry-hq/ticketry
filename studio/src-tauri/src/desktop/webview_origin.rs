//! The single origin the packaged backend is told to trust. Development uses
//! the Vite dev server; a packaged build uses Tauri's custom protocol.

use crate::desktop::environment::endpoint;

const DEVELOPMENT_WEBVIEW_ORIGIN: &str = "http://127.0.0.1:5174";
const PACKAGED_WEBVIEW_ORIGIN: &str = "tauri://localhost";

pub(crate) fn desktop_webview_origin() -> Result<String, String> {
    if cfg!(debug_assertions) {
        endpoint("MUXED_DESKTOP_ORIGIN", DEVELOPMENT_WEBVIEW_ORIGIN)
    } else {
        Ok(PACKAGED_WEBVIEW_ORIGIN.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packaged_origin_matches_the_macos_tauri_custom_protocol() {
        assert_eq!(PACKAGED_WEBVIEW_ORIGIN, "tauri://localhost");
    }
}
