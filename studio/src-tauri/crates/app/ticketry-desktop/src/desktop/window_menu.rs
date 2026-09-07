//! The application menu: Tauri's default menu minus "Close Window".
//!
//! Studio is a single-window application whose main window closing is the
//! application exiting (`lifecycle.rs`). The default menu binds `Cmd+W` to
//! "Close Window", so pressing it to close a workspace tab quit the app before
//! the WebView ever saw the key (CODING-1547). Removing the item lets the
//! keydown reach Studio's `close-tab` binding.

use tauri::menu::{Menu, MenuItemKind};
use tauri::{AppHandle, Runtime};

const CLOSE_WINDOW_TEXT: &str = "Close Window";

pub(crate) fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    for item in menu.items()? {
        let MenuItemKind::Submenu(submenu) = item else { continue };
        for child in submenu.items()? {
            if is_close_window(&child) {
                submenu.remove(&child)?;
            }
        }
        if submenu.items()?.is_empty() {
            menu.remove(&submenu)?;
        }
    }
    Ok(menu)
}

fn is_close_window<R: Runtime>(item: &MenuItemKind<R>) -> bool {
    matches!(item, MenuItemKind::Predefined(predefined)
        if predefined.text().is_ok_and(|text| text == CLOSE_WINDOW_TEXT))
}
