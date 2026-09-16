//! Builder wiring for the desktop application: managed state, the invoke
//! surface, and the mapping from Tauri run events onto lifecycle actions.

use std::path::Path;

use chrono::Utc;
use tauri::Manager;

use crate::desktop::commands;
use crate::desktop::crash_reports::CrashReportsRuntime;
use crate::desktop::data_directory::data_directory_ownership_for_startup;
use crate::desktop::document_protocol;
#[cfg(debug_assertions)]
use crate::desktop::environment::development_panic_abort_requested;
use crate::desktop::environment::{automated_startup_exit_requested, development_log_path};
use crate::desktop::launch_runtime::DesktopLaunchRuntime;
use crate::desktop::lifecycle::{
    detach_transient_viewers_for_page_load, lifecycle_action, tear_down_before_exit,
    DesktopLifecycleAction, DesktopLifecycleEvent, MAIN_WINDOW_LABEL,
};
use crate::desktop::service_state::DesktopServiceState;
use crate::desktop::startup::{initialize_services, startup_plugin};
use crate::desktop::startup_trace::DesktopStartupTrace;
use crate::{app_updates, native_terminal};
use ticketry_terminal::ViewerCommandState;

macro_rules! native_invoke_handler {
    ($($acceptance_command:path),* $(,)?) => {
        tauri::generate_handler![
            commands::desktop_runtime_configuration,
            commands::desktop_launch_default_coding_agent,
            commands::desktop_append_frontend_log,
            commands::desktop_file_logging_enabled,
            commands::desktop_retry_services,
            commands::desktop_pick_folder,
            commands::directory_trust::desktop_prepare_directory_trust,
            commands::desktop_validate_module_folder,
            commands::desktop_preflight_report,
            commands::desktop_approve_executable_path,
            crate::desktop::handy::desktop_toggle_handy_transcription,
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
            native_terminal::native_terminal_set_webview_interaction,
            native_terminal::native_terminal_detach,
            native_terminal::focus_trace::native_terminal_trace,
            $($acceptance_command),*
        ]
    };
}

#[cfg(feature = "desktop-acceptance")]
fn native_invoke_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static
{
    native_invoke_handler![native_terminal::native_terminal_retention_benchmark]
}

#[cfg(not(feature = "desktop-acceptance"))]
fn native_invoke_handler() -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static
{
    native_invoke_handler![]
}

fn trace_plugin(stage: &'static str) -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new(stage)
        .setup(move |application, _| {
            application.state::<DesktopStartupTrace>().record(stage);
            Ok(())
        })
        .on_webview_ready(|webview| {
            webview
                .state::<DesktopStartupTrace>()
                .record("main-webview-created");
        })
        .build()
}

/// Builds and runs the desktop application.
///
/// The `context` is produced by `tauri::generate_context!()` in the root
/// `ticketry` package: that macro reads the artifacts `tauri-build` writes
/// into its own `OUT_DIR`, and `tauri-build` stays with `tauri.conf.json` in
/// the root package. Passing the context in is the one seam that lets the
/// shell itself live here.
pub fn run(context: tauri::Context, file_logging_requested: bool, app_version: &str, commit: &str) {
    let process_started = std::time::Instant::now();
    let ownership = data_directory_ownership_for_startup();
    let file_log = ticketry_diagnostics::configure_process_file_log(
        file_logging_requested,
        &ownership.data_directory,
        development_log_path(),
    );
    let startup_trace = DesktopStartupTrace::begin(file_log.clone(), process_started);
    startup_trace.record("ownership-and-file-log-ready");
    // Crash-report collection scans ~/Library/Logs/DiagnosticReports, which
    // took 90-120 ms on the main thread ahead of window creation. Nothing the
    // window needs depends on it, so it runs beside Tauri's builder and the
    // crash-reports state joins it on first use.
    let crash_collection = {
        let data_directory = ownership.data_directory.clone();
        let event_log_path = file_log.path().map(Path::to_path_buf);
        let startup_trace = startup_trace.clone();
        let app_version = app_version.to_owned();
        let commit = commit.to_owned();
        std::thread::spawn(move || {
            let diagnostic_reports_directory =
                ticketry_diagnostics::system_diagnostic_reports_directory();
            let crash_report = ticketry_diagnostics::collect_dirty_shutdown(
                &data_directory,
                &diagnostic_reports_directory,
                event_log_path.as_deref(),
                &app_version,
                &commit,
                Utc::now,
            );
            startup_trace.record("dirty-shutdown-collected");
            // Installed after collection clears the previous session's
            // attribution, so an early panic is never wiped by the scan.
            ticketry_diagnostics::install_panic_attribution_hook(&data_directory);
            #[cfg(debug_assertions)]
            if development_panic_abort_requested() {
                ticketry_diagnostics::force_development_panic_abort();
            }
            crash_report
        })
    };
    let crash_reports = CrashReportsRuntime::new(&ownership.data_directory, crash_collection);
    if let Some(error) = ownership.startup_error.as_deref() {
        eprintln!("Ticketry could not acquire data-directory ownership: {error}");
    }
    let graphql_api = ticketry_graphql_schema::transport_api();
    startup_trace.record("graphql-transport-built");
    let setup_graphql_api = graphql_api.clone();
    let builder = tauri::Builder::default()
        .plugin(trace_plugin("builder-started"))
        .plugin(startup_plugin(graphql_api.clone()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(trace_plugin("dialog-plugin-initialized"))
        .plugin(tauri_plugin_launchkey_adaptor::init())
        .plugin(trace_plugin("launchkey-plugin-initialized"))
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(feature = "desktop-acceptance")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    let native_handler = native_invoke_handler();
    // Registered last so its setup marks the end of plugin initialization.
    // Tauri creates the configured windows right after it and before `setup`,
    // so the gap to `tauri-setup-entered` is native window and WebView creation.
    let builder = builder.plugin(trace_plugin("plugins-initialized"));
    let application = match builder
        .manage(ownership)
        .manage(crash_reports)
        .manage(file_log)
        .manage(startup_trace)
        .manage(DesktopServiceState::new())
        .manage(DesktopLaunchRuntime::new())
        .manage(ViewerCommandState::new())
        .manage(native_terminal::NativeTerminalState::new())
        .invoke_handler(ticketry_graphql_schema::combine_with_native_handler(
            native_handler,
            graphql_api,
        ))
        .register_asynchronous_uri_scheme_protocol(
            document_protocol::DOCUMENT_SCHEME,
            document_protocol::serve_document_request,
        )
        .menu(crate::desktop::window_menu::build)
        .setup(move |application| initialize_services(application, &setup_graphql_api))
        .on_page_load(|webview, payload| {
            if webview.label() == MAIN_WINDOW_LABEL
                && payload.event() == tauri::webview::PageLoadEvent::Started
            {
                detach_transient_viewers_for_page_load(webview.app_handle());
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
