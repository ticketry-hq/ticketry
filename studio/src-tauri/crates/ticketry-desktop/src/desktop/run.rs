//! Builder wiring for the desktop application: managed state, the invoke
//! surface, and the mapping from Tauri run events onto lifecycle actions.

use chrono::Utc;
use tauri::Manager;

use crate::desktop::commands;
use crate::desktop::crash_reports::CrashReportsRuntime;
use crate::desktop::data_directory::data_directory_ownership_for_startup;
use crate::desktop::document_protocol;
use crate::desktop::environment::{automated_startup_exit_requested, development_log_path};
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::lifecycle::{
    detach_transient_viewers, lifecycle_action, tear_down_before_exit, DesktopLifecycleAction,
    DesktopLifecycleEvent, MAIN_WINDOW_LABEL,
};
use crate::desktop::service_state::DesktopServiceState;
use crate::desktop::startup::initialize_services;
use crate::{app_updates, native_terminal};
use ticketry_terminal::ViewerCommandState;

/// Builds and runs the desktop application.
///
/// The `context` is produced by `tauri::generate_context!()` in the root
/// `ticketry` package: that macro reads the artifacts `tauri-build` writes
/// into its own `OUT_DIR`, and `tauri-build` stays with `tauri.conf.json` in
/// the root package. Passing the context in is the one seam that lets the
/// shell itself live here.
pub fn run(context: tauri::Context, file_logging_requested: bool) {
    let ownership = data_directory_ownership_for_startup();
    let file_log = ticketry_diagnostics::configure_process_file_log(
        file_logging_requested,
        &ownership.data_directory,
        development_log_path(),
    );
    let diagnostic_reports_directory = ticketry_diagnostics::system_diagnostic_reports_directory();
    let crash_report = ticketry_diagnostics::collect_dirty_shutdown(
        &ownership.data_directory,
        &diagnostic_reports_directory,
        file_log.path(),
        Utc::now,
    );
    let crash_reports = CrashReportsRuntime::new(&ownership.data_directory, crash_report);
    if let Some(error) = ownership.startup_error.as_deref() {
        eprintln!("Ticketry could not acquire data-directory ownership: {error}");
    }
    let graphql_api = ticketry_graphql_schema::transport_api();
    let setup_graphql_api = graphql_api.clone();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(feature = "desktop-acceptance")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    let application = match builder
        .manage(ownership)
        .manage(crash_reports)
        .manage(file_log)
        .manage(DesktopServiceState::new())
        .manage(DesktopLaunchRuntime::new())
        .manage(ViewerCommandState::new())
        .manage(native_terminal::NativeTerminalState::new())
        .invoke_handler(
                    ticketry_graphql_schema::combine_with_native_handler(
                tauri::generate_handler![
                    commands::desktop_runtime_configuration,
                    commands::desktop_launch_default_coding_agent,
                    commands::desktop_append_frontend_log,
                    commands::desktop_file_logging_enabled,
                    commands::desktop_retry_services,
                    commands::desktop_pick_folder,
                    commands::desktop_validate_module_folder,
                    commands::desktop_preflight_report,
                    commands::desktop_approve_executable_path,
                    app_updates::desktop_update_check,
                    app_updates::install::desktop_update_download_and_install,
                    app_updates::install::desktop_update_restart,
                    crate::desktop::crash_reports::desktop_latest_crash_collection_outcome,
                    crate::desktop::crash_reports::desktop_reveal_crash_report_folder,
                    commands::terminal_viewer::viewer_attach,
                    commands::terminal_viewer::viewer_input,
                    commands::terminal_viewer::viewer_resize,
                    commands::terminal_viewer::viewer_scroll,
                    commands::terminal_viewer::viewer_detach,
                    commands::terminal_viewer::viewer_status,
                    native_terminal::native_terminal_available,
                    native_terminal::native_terminal_attach,
                    native_terminal::native_terminal_reconcile_frame,
                    native_terminal::native_terminal_set_frame,
                    native_terminal::native_terminal_hide,
                    native_terminal::native_terminal_show,
                    native_terminal::native_terminal_focus,
                    native_terminal::native_terminal_detach,
                    native_terminal::focus_trace::native_terminal_trace
                ],
                graphql_api,
            ),
        )
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
            {
                if automated_startup_exit_requested() {
                    webview.app_handle().exit(0);
                } else {
                    // Release acceptance drives the real update path from here;
                    // an ordinary launch configures no run and returns at once.
                    app_updates::acceptance::run_if_requested(webview.app_handle());
                }
            }
        })
        .build(context)
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
                tear_down_before_exit(application);
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
