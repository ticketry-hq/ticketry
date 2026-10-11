//! Reading skill roots and choosing a match. Directory listing only.

use std::io;
use std::path::PathBuf;

use super::{SkillAvailability, SkillAvailabilityStatus};

/// One searched root's skill directories, or why it could not be read.
pub(super) enum RootListing {
    Read(Vec<InstalledSkill>),
    ReadWithErrors {
        skills: Vec<InstalledSkill>,
        errors: Vec<(PathBuf, String)>,
    },
    Unreadable {
        root: PathBuf,
        error: String,
    },
}

pub(super) struct InstalledSkill {
    name: String,
    location: PathBuf,
}

/// The immediate children of `root` that are directories (directly or through
/// a symlink) containing `SKILL.md`, sorted by name for determinism. A root
/// that does not exist is an empty listing, not an error.
pub(super) fn list_skills(root: &std::path::Path) -> RootListing {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return RootListing::Read(Vec::new())
        }
        Err(error) => {
            return RootListing::Unreadable {
                root: root.to_path_buf(),
                error: error.to_string(),
            }
        }
    };
    let mut skills = Vec::new();
    let mut errors = Vec::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                return RootListing::Unreadable {
                    root: root.to_path_buf(),
                    error: error.to_string(),
                }
            }
        };
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let location = entry.path();
        // Metadata follows symlinks, so linked skill directories count. Keep
        // read failures alongside valid matches; absence is only established
        // when metadata was readable or the path does not exist.
        let skill_file = location.join("SKILL.md");
        match std::fs::metadata(&skill_file) {
            Ok(metadata) if metadata.is_file() => skills.push(InstalledSkill { name, location }),
            Ok(_) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::NotADirectory
                ) => {}
            Err(error) => errors.push((skill_file, error.to_string())),
        }
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    if errors.is_empty() {
        RootListing::Read(skills)
    } else {
        RootListing::ReadWithErrors { skills, errors }
    }
}

/// Exact matches in root order win over case-only matches in root order.
pub(super) fn resolve(requested: &str, listings: &[RootListing]) -> SkillAvailability {
    let wanted = requested.trim();
    let installed = || {
        listings.iter().filter_map(|listing| match listing {
            RootListing::Read(skills) | RootListing::ReadWithErrors { skills, .. } => Some(skills),
            RootListing::Unreadable { .. } => None,
        })
    };
    let exact = installed().flatten().find(|skill| skill.name == wanted);
    let folded = wanted.to_lowercase();
    let chosen = exact.or_else(|| {
        installed()
            .flatten()
            .find(|skill| skill.name.to_lowercase() == folded)
    });
    if let Some(skill) = chosen {
        return SkillAvailability {
            requested: requested.to_owned(),
            status: SkillAvailabilityStatus::Available,
            installed_name: Some(skill.name.clone()),
            location: Some(skill.location.clone()),
        };
    }
    let unreadable = listings.iter().find_map(|listing| match listing {
        RootListing::Unreadable { root, error } => {
            Some(format!("Could not read {}: {error}", root.display()))
        }
        RootListing::ReadWithErrors { errors, .. } => errors
            .first()
            .map(|(path, error)| format!("Could not read {}: {error}", path.display())),
        RootListing::Read(_) => None,
    });
    SkillAvailability {
        requested: requested.to_owned(),
        status: match unreadable {
            Some(reason) => SkillAvailabilityStatus::Unchecked { reason },
            None => SkillAvailabilityStatus::Missing,
        },
        installed_name: None,
        location: None,
    }
}
