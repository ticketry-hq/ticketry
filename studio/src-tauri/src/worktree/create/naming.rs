//! Where a task checkout lives and what its branch is called.
//!
//! Both names are *derived*, never submitted. Studio sends one Work Item
//! identity, and the branch and directory follow from the ticket sequence and
//! the Work Item's name — which keeps the established
//! `wt/CODIN-<seq>-<slug>` branch and
//! `<worktrees dir>/<repository name>/CODIN-<seq>-<slug>` checkout layout that
//! existing rows, existing branches, and existing directories already use.
//!
//! The slug is cosmetic: it is derived from a name that a user may rename at
//! any time, so it is bounded and sanitized here and never used to decide
//! authority. The checkout *name* is what the recovery journal remembers,
//! because it is relative; the absolute path is recomposed from the base
//! directory on every use.

use std::path::{Path, PathBuf};

/// Overrides the base directory holding every checkout. Read at call time so a
/// test can redirect it, exactly as the shipping Python builder does.
const WORKTREES_DIR_ENV: &str = "MUXED_WORKTREES_DIR";

const MAX_SLUG: usize = 40;

/// The base directory holding every task checkout.
pub(crate) fn worktrees_directory() -> PathBuf {
    if let Some(override_path) = std::env::var_os(WORKTREES_DIR_ENV) {
        let override_path = PathBuf::from(override_path);
        if !override_path.as_os_str().is_empty() {
            return override_path;
        }
    }
    ticketry_data_directory::established_data_directory()
        .unwrap_or_else(|_| home_directory().join(".config"))
        .join("worktrees")
}

/// Lower-kebab a Work Item name into a filesystem- and branch-safe slug.
pub(crate) fn slug(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut pending_separator = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            if pending_separator && !slug.is_empty() {
                slug.push('-');
            }
            pending_separator = false;
            slug.push(character.to_ascii_lowercase());
        } else {
            pending_separator = true;
        }
        if slug.len() >= MAX_SLUG {
            break;
        }
    }
    let slug = slug.trim_matches('-').to_owned();
    if slug.is_empty() {
        "task".to_owned()
    } else {
        slug
    }
}

/// `CODIN-<seq>-<slug>`, or `CODIN-<slug>` when the sequence is unknown. It is
/// the checkout directory name and the tail of the branch name.
pub(crate) fn checkout_name(ticket_seq: Option<i32>, slug: &str) -> String {
    match ticket_seq {
        Some(sequence) => format!("CODIN-{sequence}-{slug}"),
        None => format!("CODIN-{slug}"),
    }
}

pub(crate) fn branch_name(checkout_name: &str) -> String {
    format!("wt/{checkout_name}")
}

/// The absolute checkout path, recomposed from the base directory, the
/// repository's own directory name, and the derived checkout name.
pub(crate) fn checkout_path(repository: &Path, checkout_name: &str) -> PathBuf {
    checkout_path_under(&worktrees_directory(), repository, checkout_name)
}

fn checkout_path_under(base: &Path, repository: &Path, checkout_name: &str) -> PathBuf {
    base.join(repository_name(repository)).join(checkout_name)
}

fn repository_name(repository: &Path) -> String {
    repository
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "repo".to_owned())
}

fn home_directory() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_becomes_a_bounded_kebab_slug() {
        assert_eq!(slug("Parent story"), "parent-story");
        assert_eq!(slug("Fix   the   API!!"), "fix-the-api");
        assert_eq!(slug("  "), "task");
        assert_eq!(slug("···"), "task");
        assert!(slug(&"a very long work item name ".repeat(8)).len() <= MAX_SLUG);
    }

    #[test]
    fn the_established_branch_and_directory_layout_is_preserved() {
        let name = checkout_name(Some(881), &slug("Parent story"));
        assert_eq!(name, "CODIN-881-parent-story");
        assert_eq!(branch_name(&name), "wt/CODIN-881-parent-story");
        assert_eq!(checkout_name(None, "parent-story"), "CODIN-parent-story");
    }

    #[test]
    fn a_checkout_path_is_recomposed_under_the_base_directory_and_repository_name() {
        assert_eq!(
            checkout_path_under(
                Path::new("/checkouts"),
                Path::new("/repositories/ticketry"),
                "CODIN-881-parent"
            ),
            PathBuf::from("/checkouts/ticketry/CODIN-881-parent")
        );
        // A repository reached by a rootless or odd path still lands somewhere
        // deterministic rather than at the base directory itself.
        assert_eq!(
            checkout_path_under(Path::new("/checkouts"), Path::new("/"), "CODIN-881-parent"),
            PathBuf::from("/checkouts/repo/CODIN-881-parent")
        );
    }
}
