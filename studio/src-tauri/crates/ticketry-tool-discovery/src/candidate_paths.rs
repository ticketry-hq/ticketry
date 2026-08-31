//! The fixed set of directories discovery is willing to walk.
//!
//! No shell is ever asked to resolve a command; the roots below are the whole
//! search space.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

pub(super) fn trusted_roots(home: Option<&Path>) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = match env::consts::OS {
        "macos" => vec!["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"],
        "linux" => vec!["/usr/local/bin", "/usr/bin", "/bin"],
        "windows" => Vec::new(),
        _ => vec!["/usr/local/bin", "/usr/bin"],
    }
    .into_iter()
    .map(PathBuf::from)
    .collect();

    if let Some(home) = home {
        roots.push(home.join(".local/bin"));
        roots.push(home.join(".volta/bin"));
        // These are layouts only. We inspect directories directly and never run
        // nvm, fnm, mise, asdf, or their shell integration.
        roots.extend(version_manager_bins(home, ".nvm/versions/node", "bin"));
        roots.extend(version_manager_bins(
            home,
            ".fnm/node-versions",
            "installation/bin",
        ));
        roots.extend(version_manager_bins(
            home,
            ".local/share/mise/installs/node",
            "bin",
        ));
        roots.extend(version_manager_bins(home, ".asdf/installs/nodejs", "bin"));
    }
    roots.sort();
    roots.dedup();
    roots
}

pub(super) fn version_manager_bins(home: &Path, relative: &str, suffix: &str) -> Vec<PathBuf> {
    let parent = home.join(relative);
    let Ok(entries) = fs::read_dir(parent) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path().join(suffix))
        .filter(|path| path.is_dir())
        .collect()
}
