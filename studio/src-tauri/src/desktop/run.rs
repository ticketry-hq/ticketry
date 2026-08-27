//! Builder wiring for the desktop application: managed state, the invoke
//! surface, and the mapping from Tauri run events onto lifecycle actions.

use tauri::Manager;

use crate::desktop::commands;
use crate::desktop::data_directory::{
    data_directory_ownership_for_startup, release_data_directory_ownership,
};
use crate::desktop::document_protocol;
use crate::desktop::environment::automated_startup_exit_requested;
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::lifecycle::{
    detach_transient_viewers, lifecycle_action, shutdown_rust_runtime, DesktopLifecycleAction,
    DesktopLifecycleEvent, MAIN_WINDOW_LABEL,
};
use crate::desktop::service_state::DesktopServiceState;
use crate::desktop::startup::initialize_services;
use crate::native_terminal::focus_trace;
use crate::terminal_viewer::webview_commands;
use crate::{graphql_foundation, native_terminal};

pub fn run() {
    let ownership = data_directory_ownership_for_startup();
    if let Some(error) = ownership.startup_error.as_deref() {
        eprintln!("Ticketry could not acquire data-directory ownership: {error}");
    }
    let graphql_api = graphql_foundation::transport_api();
    let setup_graphql_api = graphql_api.clone();
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(feature = "desktop-acceptance")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    let application = match builder
        .manage(ownership)
        .manage(DesktopServiceState::new())
        .manage(DesktopLaunchRuntime::new())
        .manage(webview_commands::ViewerCommandState::new())
        .manage(native_terminal::NativeTerminalState::new())
        .invoke_handler(graphql_foundation::combine_with_native_handler(
            tauri::generate_handler![
                commands::desktop_runtime_configuration,
                commands::desktop_launch_default_coding_agent,
                commands::desktop_append_frontend_log,
                commands::desktop_retry_services,
                commands::desktop_pick_folder,
                commands::desktop_validate_module_folder,
                commands::desktop_preflight_report,
                commands::desktop_approve_executable_path,
                webview_commands::viewer_attach,
                webview_commands::viewer_input,
                webview_commands::viewer_resize,
                webview_commands::viewer_scroll,
                webview_commands::viewer_detach,
                webview_commands::viewer_status,
                native_terminal::native_terminal_available,
                native_terminal::native_terminal_attach,
                native_terminal::native_terminal_reconcile_frame,
                native_terminal::native_terminal_set_frame,
                native_terminal::native_terminal_hide,
                native_terminal::native_terminal_show,
                native_terminal::native_terminal_focus,
                native_terminal::native_terminal_detach,
                focus_trace::native_terminal_trace
            ],
            graphql_api,
        ))
        .register_asynchronous_uri_scheme_protocol(
            document_protocol::DOCUMENT_SCHEME,
            document_protocol::serve_document_request,
        )
        .setup(move |application| initialize_services(application, &setup_graphql_api))
        .on_page_load(|webview, payload| {
            if webview.label() == MAIN_WINDOW_LABEL
                && payload.event() == tauri::webview::PageLoadEvent::Started
            {
                detach_transient_viewers(webview.app_handle());
            }
            if webview.label() == MAIN_WINDOW_LABEL
                && payload.event() == tauri::webview::PageLoadEvent::Finished
                && automated_startup_exit_requested()
            {
                webview.app_handle().exit(0);
            }
        })
        .build(tauri::generate_context!())
    {
        Ok(application) => application,
        Err(error) => {
            eprintln!("Ticketry failed to initialize: {error}");
            if let DesktopLifecycleAction::Exit(code) =
                lifecycle_action(DesktopLifecycleEvent::FatalInitialization)
            {
                std::process::exit(code);
            }
            unreachable!("fatal initialization must exit")
        }
    };

    application.run(|application, event| {
        let lifecycle_event = match &event {
            tauri::RunEvent::Ready => Some(DesktopLifecycleEvent::StartupReady),
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { api, .. },
                ..
            } if label == MAIN_WINDOW_LABEL => {
                api.prevent_close();
                Some(DesktopLifecycleEvent::MainWindowCloseRequested)
            }
            tauri::RunEvent::Exit => {
                shutdown_rust_runtime(application);
                detach_transient_viewers(application);
                release_data_directory_ownership(application);
                Some(DesktopLifecycleEvent::ApplicationShutdown)
            }
            _ => None,
        };

        match lifecycle_event.map(lifecycle_action) {
            Some(DesktopLifecycleAction::Exit(code)) => application.exit(code),
            Some(DesktopLifecycleAction::Continue | DesktopLifecycleAction::Finished) | None => {}
        }
    });
}
