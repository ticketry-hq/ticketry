//! Configures the foreground native viewer from Studio's effective keymap.

#[tauri::command]
pub(crate) fn native_terminal_set_module_manager_shortcut(
    window: tauri::WebviewWindow,
    key: String,
    modifiers: u64,
) -> Result<(), String> {
    if window.label() != crate::desktop::lifecycle::MAIN_WINDOW_LABEL {
        return Err("native shortcuts are restricted to the main window".to_owned());
    }
    if key.is_empty() || key.len() > 64 || key.contains('\0') || modifiers & !0x1E0000 != 0 {
        return Err("invalid native shortcut".to_owned());
    }
    #[cfg(all(target_os = "macos", feature = "native-libghostty"))]
    {
        unsafe extern "C" {
            fn muxed_ghostty_set_module_manager_shortcut(
                key: *const std::ffi::c_char,
                modifiers: u64,
            );
        }
        let key = std::ffi::CString::new(key).map_err(|error| error.to_string())?;
        window
            .run_on_main_thread(move || unsafe {
                muxed_ghostty_set_module_manager_shortcut(key.as_ptr(), modifiers);
            })
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}
