use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

const GHOSTTY_REVISION: &str = "332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28";

fn main() {
    println!("cargo:rerun-if-changed=../../config/product-identity.json");
    record_build_commit();
    build_native_libghostty();

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_runtime_configuration",
            "desktop_file_logging_enabled",
            "desktop_append_frontend_log",
            "desktop_retry_services",
            "desktop_pick_folder",
            "desktop_validate_module_folder",
            "desktop_preflight_report",
            "desktop_approve_executable_path",
            "desktop_launch_default_coding_agent",
            "desktop_update_check",
            "desktop_update_download_and_install",
            "desktop_update_restart",
            "desktop_latest_crash_collection_outcome",
            "desktop_reveal_crash_report_folder",
            "viewer_attach",
            "viewer_input",
            "viewer_resize",
            "viewer_scroll",
            "viewer_detach",
            "viewer_status",
            "native_terminal_available",
            "native_terminal_attach",
            "native_terminal_reconcile_frame",
            "native_terminal_set_frame",
            "native_terminal_hide",
            "native_terminal_show",
            "native_terminal_focus",
            "native_terminal_detach",
            "native_terminal_trace",
            "TauRPC__graphql_execute",
            "TauRPC__graphql_subscribe",
            "TauRPC__graphql_unsubscribe",
        ]),
    ))
    .expect("failed to build the Ticketry Tauri application");
}

fn record_build_commit() {
    println!("cargo:rerun-if-env-changed=TICKETRY_COMMIT");
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let commit = env::var("TICKETRY_COMMIT")
        .ok()
        .filter(|commit| !commit.trim().is_empty())
        .or_else(|| {
            Command::new("git")
                .args(["rev-parse", "HEAD"])
                .current_dir(&manifest)
                .output()
                .ok()
                .filter(|output| output.status.success())
                .and_then(|output| String::from_utf8(output.stdout).ok())
                .map(|commit| commit.trim().to_owned())
                .filter(|commit| !commit.is_empty())
        })
        .unwrap_or_else(|| "unknown".to_owned());
    println!("cargo:rustc-env=TICKETRY_COMMIT={commit}");
    if let Ok(git_head) = Command::new("git")
        .args(["rev-parse", "--git-path", "HEAD"])
        .current_dir(manifest)
        .output()
    {
        if git_head.status.success() {
            if let Ok(path) = String::from_utf8(git_head.stdout) {
                println!("cargo:rerun-if-changed={}", path.trim());
            }
        }
    }
}

fn build_native_libghostty() {
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_NATIVE_LIBGHOSTTY");
    if env::var_os("CARGO_FEATURE_NATIVE_LIBGHOSTTY").is_none()
        || env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos")
    {
        return;
    }

    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let vendor = manifest.join("vendor/libghostty");
    let revision = fs::read_to_string(vendor.join("REVISION")).unwrap_or_else(|_| {
        panic!(
            "native-libghostty requires `npm run libghostty:prepare` from {}",
            manifest.parent().unwrap().display()
        )
    });
    assert_eq!(
        revision.trim(),
        GHOSTTY_REVISION,
        "prepared libghostty revision does not match the pinned revision"
    );

    cc::Build::new()
        .file(manifest.join("native/libghostty_host.m"))
        .include(manifest.join("native"))
        .include(vendor.join("include"))
        .flag("-fno-objc-arc")
        .compile("muxed_ghostty_host");

    println!(
        "cargo:rustc-link-search=native={}",
        vendor.join("lib").display()
    );
    println!("cargo:rustc-link-lib=static=ghostty");
    for library in ["c++", "bz2", "iconv", "resolv", "z"] {
        println!("cargo:rustc-link-lib={library}");
    }
    for framework in [
        "AppKit",
        "Carbon",
        "CoreFoundation",
        "CoreGraphics",
        "CoreText",
        "Foundation",
        "IOSurface",
        "Metal",
        "QuartzCore",
        "Security",
        "UniformTypeIdentifiers",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }

    println!(
        "cargo:rerun-if-changed={}",
        manifest.join("native/libghostty_host.h").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        manifest.join("native/libghostty_host.m").display()
    );
    for source in [
        "native/libghostty_surface_owner.m",
        "native/libghostty_runtime.m",
        "native/libghostty_key_event.m",
        "native/libghostty_studio_chord.m",
        "native/libghostty_view.m",
        "native/libghostty_command_routing.m",
        "native/libghostty_view_bridge.m",
    ] {
        println!("cargo:rerun-if-changed={}", manifest.join(source).display());
    }
    println!(
        "cargo:rerun-if-changed={}",
        vendor.join("REVISION").display()
    );
}
