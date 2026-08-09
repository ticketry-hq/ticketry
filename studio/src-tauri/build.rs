use std::env;
use std::fs;
use std::path::PathBuf;

const GHOSTTY_REVISION: &str = "332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28";

fn main() {
    build_native_libghostty();

    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_runtime_configuration",
            "desktop_append_frontend_log",
            "desktop_retry_services",
            "desktop_pick_folder",
            "desktop_preflight_report",
            "desktop_approve_executable_path",
            "viewer_attach",
            "viewer_input",
            "viewer_resize",
            "viewer_scroll",
            "viewer_detach",
            "viewer_status",
            "native_terminal_available",
            "native_terminal_attach",
            "native_terminal_set_frame",
            "native_terminal_focus",
            "native_terminal_detach",
        ]),
    ))
    .expect("failed to build the Ticketry Tauri application");
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
    println!(
        "cargo:rerun-if-changed={}",
        vendor.join("REVISION").display()
    );
}
