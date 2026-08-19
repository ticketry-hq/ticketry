//! Exclusive ownership of the selected data directory for the lifetime of any
//! backend the desktop starts.

use std::env;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

use crate::desktop::environment::{optional_port, DEVELOPMENT_BACKEND_PORT_ENV};
use crate::ownership::{
    established_data_directory, DataDirectoryAccess, DataDirectoryGuard, DevelopmentMode,
    DEVELOPMENT_BACKEND_PORT,
};

/// Kept in Tauri managed state for the entire lifetime of any backend that
/// the desktop may start.  `None` is the deliberate `pnpm dev` connect mode.
pub(crate) struct DesktopDataDirectoryOwnership {
    pub(crate) data_directory: PathBuf,
    pub(crate) guard: Mutex<Option<DataDirectoryGuard>>,
    pub(crate) startup_error: Option<String>,
}

fn acquire_data_directory_ownership() -> Result<DesktopDataDirectoryOwnership, String> {
    let mode = DevelopmentMode::from_environment().map_err(|error| error.to_string())?;
    let data_directory = established_data_directory().map_err(|error| error.to_string())?;
    let development_backend_port = if cfg!(debug_assertions) {
        optional_port(DEVELOPMENT_BACKEND_PORT_ENV)?.unwrap_or(DEVELOPMENT_BACKEND_PORT)
    } else {
        DEVELOPMENT_BACKEND_PORT
    };
    let guard = match DataDirectoryGuard::acquire(&data_directory, mode, development_backend_port)
        .map_err(|error| {
        format!(
            "could not own selected data directory {}: {error}",
            data_directory.display()
        )
    })? {
        DataDirectoryAccess::Owned(guard) => Some(guard),
        DataDirectoryAccess::DevelopmentStack => None,
    };
    Ok(DesktopDataDirectoryOwnership {
        data_directory,
        guard: Mutex::new(guard),
        startup_error: None,
    })
}

pub(crate) fn data_directory_ownership_for_startup() -> DesktopDataDirectoryOwnership {
    acquire_data_directory_ownership().unwrap_or_else(|error| {
        let data_directory = established_data_directory()
            .unwrap_or_else(|_| env::temp_dir().join("ticketry-unavailable-data-directory"));
        DesktopDataDirectoryOwnership {
            data_directory,
            guard: Mutex::new(None),
            startup_error: Some(error),
        }
    })
}

pub(crate) fn release_data_directory_ownership(application: &tauri::AppHandle) {
    let ownership = application.state::<DesktopDataDirectoryOwnership>();
    let guard = ownership
        .guard
        .lock()
        .expect("data-directory lock poisoned")
        .take();
    if let Some(guard) = guard {
        if let Err(error) = guard.release() {
            eprintln!(
                "Ticketry could not release data-directory ownership for {}: {error}",
                ownership.data_directory.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    const CONFIGURED_PORT_OWNERSHIP_CHILD: &str = "MUXED_CONFIGURED_PORT_OWNERSHIP_CHILD";

    #[test]
    fn ownership_failure_is_retained_for_the_startup_health_screen() {
        let ownership = DesktopDataDirectoryOwnership {
            data_directory: PathBuf::from("/tmp/ticketry"),
            guard: Mutex::new(None),
            startup_error: Some("another backend owns the data directory".to_owned()),
        };

        assert!(ownership
            .guard
            .lock()
            .expect("data-directory lock poisoned")
            .is_none());
        assert_eq!(
            ownership.startup_error.as_deref(),
            Some("another backend owns the data directory")
        );
    }

    #[test]
    fn configured_backend_port_keeps_an_unrelated_default_listener_out_of_ownership() {
        if env::var_os(CONFIGURED_PORT_OWNERSHIP_CHILD).is_some() {
            let ownership = acquire_data_directory_ownership()
                .expect("the configured backend port must drive ownership detection");
            if let Some(guard) = ownership
                .guard
                .into_inner()
                .expect("data-directory lock poisoned")
            {
                guard.release().expect("release configured-port owner");
            }
            return;
        }

        let default_responder = match std::net::TcpListener::bind((
            "127.0.0.1",
            DEVELOPMENT_BACKEND_PORT,
        )) {
            Ok(listener) => Some(std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().expect("accept ownership health probe");
                let mut request = [0_u8; 256];
                let _ = stream.read(&mut request);
                let _ = stream.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\n{\"ok\": true}",
                );
            })),
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => None,
            Err(error) => panic!("occupy the default development port: {error}"),
        };
        let selected_listener = std::net::TcpListener::bind(("127.0.0.1", 0))
            .expect("reserve a selected development port");
        let selected_port = selected_listener
            .local_addr()
            .expect("read selected development port")
            .port();
        assert_ne!(selected_port, DEVELOPMENT_BACKEND_PORT);
        drop(selected_listener);

        let data_directory = env::temp_dir().join(format!(
            "muxed-configured-port-ownership-{}",
            std::process::id()
        ));
        let status = std::process::Command::new(env::current_exe().expect("test executable"))
            .args([
                "--exact",
                "desktop::data_directory::tests::configured_backend_port_keeps_an_unrelated_default_listener_out_of_ownership",
                "--nocapture",
            ])
            .env(CONFIGURED_PORT_OWNERSHIP_CHILD, "1")
            .env("MUXED_DATA_DIR", &data_directory)
            .env(DEVELOPMENT_BACKEND_PORT_ENV, selected_port.to_string())
            .status()
            .expect("start configured-port ownership child");

        if let Some(responder) = default_responder {
            let _ = std::net::TcpStream::connect(("127.0.0.1", DEVELOPMENT_BACKEND_PORT));
            responder.join().expect("join ownership health responder");
        }
        let _ = std::fs::remove_dir_all(data_directory);
        assert!(status.success());
    }
}
