//! What the webview is allowed to learn from the native folder chooser: one
//! absolute Unicode path, or cancellation.

use tauri_plugin_dialog::FilePath;

pub fn absolute_folder_path(selection: Option<FilePath>) -> Result<Option<String>, String> {
    selection
        .map(|selected| {
            let path = selected.into_path().map_err(|error| {
                format!("native folder picker returned an invalid path: {error}")
            })?;
            if !path.is_absolute() {
                return Err("native folder picker returned a non-absolute path".to_owned());
            }
            path.into_os_string()
                .into_string()
                .map_err(|_| "native folder picker returned a non-Unicode path".to_owned())
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn native_folder_result_maps_cancellation_and_one_absolute_path() {
        assert_eq!(absolute_folder_path(None), Ok(None));
        assert_eq!(
            absolute_folder_path(Some(FilePath::from(PathBuf::from("/repos/picked")))),
            Ok(Some("/repos/picked".to_owned()))
        );
    }

    #[test]
    fn native_folder_result_rejects_a_non_absolute_path() {
        assert_eq!(
            absolute_folder_path(Some(FilePath::from(PathBuf::from("repos/picked")))),
            Err("native folder picker returned a non-absolute path".to_owned())
        );
    }
}
