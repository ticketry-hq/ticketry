//! The shape a Module Link's local path must have before it is persisted.
//!
//! Shape is all this module judges. Whether the folder is present, mounted,
//! readable, or a Git repository is a launch-time question, and answering it
//! here would make an installation on a detached external volume unlinkable
//! and would make a write depend on the state of the filesystem at that
//! instant. [`crate::launch::paths`] still refuses an unusable folder before a
//! run starts; this boundary only refuses a value no folder could ever be.

use std::path::{Component, Path};

/// The longest local path a link may record, in bytes.
///
/// Every supported platform refuses a longer path than this, so a longer value
/// is malformed input rather than a folder that merely does not exist yet.
pub const MAX_PATH_BYTES: usize = 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum LocalPathDefect {
    Empty,
    Untrimmed,
    Relative,
    Traversing,
    EmbeddedNul,
    TooLong,
}

impl LocalPathDefect {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::Untrimmed => "untrimmed",
            Self::Relative => "relative",
            Self::Traversing => "traversing",
            Self::EmbeddedNul => "embedded-nul",
            Self::TooLong => "too-long",
        }
    }

    #[must_use]
    pub fn message(self) -> &'static str {
        match self {
            Self::Empty => "A module's local folder cannot be empty.",
            Self::Untrimmed => "A module's local folder cannot start or end with whitespace.",
            Self::Relative => "A module's local folder must be an absolute path.",
            Self::Traversing => "A module's local folder must not step through a parent directory.",
            Self::EmbeddedNul => "A module's local folder cannot contain a null character.",
            Self::TooLong => "A module's local folder is longer than any supported path.",
        }
    }
}

/// A local path whose shape a Module Link row may record.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LocalModulePath(String);

impl LocalModulePath {
    /// Accept `value` only if no persisted row could ever be repaired from it.
    ///
    /// # Errors
    ///
    /// Returns the first [`LocalPathDefect`] the value carries.
    pub fn parse(value: &str) -> Result<Self, LocalPathDefect> {
        if value.is_empty() {
            return Err(LocalPathDefect::Empty);
        }
        if value.trim() != value {
            return Err(LocalPathDefect::Untrimmed);
        }
        if value.contains('\0') {
            return Err(LocalPathDefect::EmbeddedNul);
        }
        if value.len() > MAX_PATH_BYTES {
            return Err(LocalPathDefect::TooLong);
        }
        let path = Path::new(value);
        if !path.is_absolute() {
            return Err(LocalPathDefect::Relative);
        }
        // Preflight authorizes a recorded external root only when it names its
        // target directly, so a value it would flag is refused before it is
        // ever stored.
        if path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        {
            return Err(LocalPathDefect::Traversing);
        }
        Ok(Self(value.to_owned()))
    }

    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_unpersistable_shape_is_named() {
        assert_eq!(LocalModulePath::parse(""), Err(LocalPathDefect::Empty));
        assert_eq!(
            LocalModulePath::parse(" /repo "),
            Err(LocalPathDefect::Untrimmed)
        );
        assert_eq!(
            LocalModulePath::parse("relative/repo"),
            Err(LocalPathDefect::Relative)
        );
        assert_eq!(
            LocalModulePath::parse("/repos/../elsewhere"),
            Err(LocalPathDefect::Traversing)
        );
        assert_eq!(
            LocalModulePath::parse("/repo\0/module"),
            Err(LocalPathDefect::EmbeddedNul)
        );
        assert_eq!(
            LocalModulePath::parse(&format!("/{}", "a".repeat(MAX_PATH_BYTES))),
            Err(LocalPathDefect::TooLong)
        );
    }

    /// A folder on an unmounted volume is a supported link, not a bad value.
    #[test]
    fn an_absent_folder_is_still_a_persistable_shape() {
        let absent = "/Volumes/an-external-disk-that-is-not-mounted/module";
        assert!(!Path::new(absent).exists());
        assert_eq!(
            LocalModulePath::parse(absent).map(LocalModulePath::into_string),
            Ok(absent.to_owned())
        );
    }
}
