//! Real Git fixtures for this capability's own unit tests.
//!
//! Nothing here simulates Git. A test that asks whether a branch is taken or a
//! path is occupied gets its answer from a real repository in a temporary
//! directory, which is the only way these assertions mean anything.

use std::path::Path;
use std::process::Command;

/// Run one Git command in a fixture, failing the test if Git refuses.
pub fn git(arguments: &[&str], working_directory: &Path) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(working_directory)
        .args(arguments)
        .env("GIT_AUTHOR_NAME", "Ticketry Test")
        .env("GIT_AUTHOR_EMAIL", "test@ticketry.invalid")
        .env("GIT_COMMITTER_NAME", "Ticketry Test")
        .env("GIT_COMMITTER_EMAIL", "test@ticketry.invalid")
        .output()
        .expect("run git");
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

/// A repository on `main` with one commit. Returns its committed HEAD.
pub fn repository(root: &Path) -> String {
    std::fs::create_dir_all(root).expect("create the repository directory");
    git(&["init", "-b", "main"], root);
    git(&["config", "user.email", "test@ticketry.invalid"], root);
    git(&["config", "user.name", "Ticketry Test"], root);
    std::fs::write(root.join("README.md"), "base\n").expect("write the base file");
    git(&["add", "."], root);
    git(&["commit", "-m", "base"], root);
    git(&["rev-parse", "HEAD"], root)
}
