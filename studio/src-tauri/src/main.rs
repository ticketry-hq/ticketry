use muxed_studio_lib::file_logging_requested;
use ticketry_terminal::{TemporarySqliteProfile, TEMP_SQLITE_FLAG};

fn main() {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    let temporary_profile = if arguments
        .iter()
        .any(|argument| argument == TEMP_SQLITE_FLAG)
    {
        match TemporarySqliteProfile::create() {
            Ok(profile) => {
                profile.activate();
                Some(profile)
            }
            Err(error) => {
                eprintln!("Ticketry could not create a temporary SQLite profile: {error}");
                std::process::exit(1);
            }
        }
    } else {
        None
    };
    muxed_studio_lib::run_with_file_logging(file_logging_requested(&arguments));
    // Teardown journals the profile's terminal cleanup before its database can
    // be removed. See the terminal crate's temporary-profile facade.
    drop(temporary_profile);
}
