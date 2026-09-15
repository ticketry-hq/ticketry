use std::{env, fs, path::PathBuf};

const GHOSTTY_REVISION: &str = "332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28";

fn main() {
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_NATIVE_LIBGHOSTTY");
    if env::var_os("CARGO_FEATURE_NATIVE_LIBGHOSTTY").is_none()
        || env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos")
    {
        return;
    }

    let root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap()).join("../../..");
    let native = root.join("native");
    let vendor = root.join("vendor/libghostty");
    let revision = fs::read_to_string(vendor.join("REVISION")).unwrap_or_else(|_| {
        panic!(
            "native-libghostty requires `npm run libghostty:prepare` from {}",
            root.parent().unwrap().display()
        )
    });
    assert_eq!(
        revision.trim(),
        GHOSTTY_REVISION,
        "prepared libghostty revision does not match the pinned revision"
    );

    cc::Build::new()
        .file(native.join("libghostty_host.m"))
        .include(&native)
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

    for source in [
        "libghostty_host.h",
        "libghostty_host.m",
        "libghostty_surface_owner.m",
        "libghostty_runtime.m",
        "libghostty_key_event.m",
        "libghostty_studio_chord.m",
        "libghostty_webview_composition.m",
        "libghostty_view.m",
        "libghostty_command_routing.m",
        "libghostty_view_bridge.m",
        "libghostty_view_handles.m",
    ] {
        println!("cargo:rerun-if-changed={}", native.join(source).display());
    }
    println!(
        "cargo:rerun-if-changed={}",
        vendor.join("REVISION").display()
    );
}
