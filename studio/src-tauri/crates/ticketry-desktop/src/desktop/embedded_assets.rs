//! Narrow access to large frontend assets embedded in the packaged binary.
//!
//! WKWebView cannot reliably fetch these through Tauri's custom URL scheme.
//! Returning raw IPC bytes also avoids JSON encoding a multi-megabyte module.

const GHOSTTY_VT_ASSET_PATH: &str = "/ghostty-vt/ghostty-vt.wasm";

#[tauri::command]
pub fn desktop_ghostty_vt_artifact(
    application: tauri::AppHandle,
) -> Result<tauri::ipc::Response, String> {
    application
        .asset_resolver()
        .get(GHOSTTY_VT_ASSET_PATH.to_owned())
        .map(|asset| tauri::ipc::Response::new(asset.bytes))
        .ok_or_else(|| {
            format!("packaged asset {GHOSTTY_VT_ASSET_PATH} is missing from this application")
        })
}
