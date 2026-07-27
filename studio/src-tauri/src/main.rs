fn main() {
    let mut arguments = std::env::args_os();
    let _executable = arguments.next();
    if arguments.next().as_deref() == Some(std::ffi::OsStr::new("--muxed-ghostty-bridge")) {
        let Some(path) = arguments.next() else {
            eprintln!("missing native terminal bridge socket path");
            std::process::exit(2);
        };
        if let Err(error) =
            muxed_studio_lib::native_terminal::run_bridge(std::path::Path::new(&path))
        {
            eprintln!("native terminal bridge failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    muxed_studio_lib::run();
}
