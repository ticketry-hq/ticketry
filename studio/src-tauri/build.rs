use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

mod build_provenance;

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
            "desktop_toggle_handy_transcription",
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
            "native_terminal_set_webview_interaction",
            "native_terminal_detach",
            "native_terminal_retention_benchmark",
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
    println!("cargo:rerun-if-env-changed=TICKETRY_ALLOW_DIRTY_BUILD");
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let explicit = env::var("TICKETRY_COMMIT").ok();
    let allow_dirty = env::var("TICKETRY_ALLOW_DIRTY_BUILD").as_deref() == Ok("true");
    let profile = env::var("PROFILE").unwrap_or_default();
    if profile == "release" {
        // A missing watched path makes Cargo rerun this check for every release build.
        println!(
            "cargo:rerun-if-changed={}",
            manifest
                .join(".ticketry-release-provenance-always")
                .display()
        );
    }
    let commit = build_provenance::resolve_build_commit(
        &profile,
        allow_dirty,
        explicit.as_deref(),
        |arguments| git(&manifest, arguments),
    )
    .unwrap_or_else(|error| panic!("invalid Ticketry build provenance: {error}"));
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

fn git(repository: &std::path::Path, arguments: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(repository)
        .output()
        .map_err(|error| format!("could not run git: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    String::from_utf8(output.stdout)
        .map(|output| output.trim().to_owned())
        .map_err(|error| format!("git returned non-UTF-8 output: {error}"))
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
        "native/libghostty_webview_composition.m",
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

    stage_unbundled_ghostty_resources(&manifest, &vendor);
}

/// CODING-1486 — native libghostty reads its configuration and pinned runtime
/// resources through `NSBundle.mainBundle`. A packaged `.app` gets them from
/// `bundle.resources` in `tauri.conf.json`, but `tauri dev` and `tauri build
/// --no-bundle` run a bare executable whose "bundle" is the directory holding
/// it. Staging the same files beside the binary makes native initialization
/// work the same way in every build, instead of silently falling back to xterm
/// outside a packaged bundle.
fn stage_unbundled_ghostty_resources(manifest: &Path, vendor: &Path) {
    // OUT_DIR is `<target>/<profile>/build/<package>-<hash>/out`; the built
    // executable sits three levels up.
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let Some(profile) = out_dir.ancestors().nth(3) else {
        return;
    };

    let configuration = manifest.join("native/ticketry-ghostty.conf");
    if let Err(error) = fs::copy(&configuration, profile.join("ticketry-ghostty.conf")) {
        println!("cargo:warning=could not stage ticketry-ghostty.conf: {error}");
        return;
    }
    for resource in ["ghostty", "terminfo"] {
        let destination = profile.join(resource);
        let _ = fs::remove_dir_all(&destination);
        if let Err(error) = copy_directory(&vendor.join("resources").join(resource), &destination) {
            println!("cargo:warning=could not stage libghostty {resource} resources: {error}");
            return;
        }
    }
}

fn copy_directory(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::create_dir_all(destination)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
