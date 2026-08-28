use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ModuleFolderFailure {
    Unset,
    Relative,
    Missing,
    NotDirectory,
    Inaccessible,
}

impl ModuleFolderFailure {
    pub(crate) fn message(self) -> &'static str {
        match self {
            Self::Unset => "No local folder is configured for this module.",
            Self::Relative => "The configured module folder must be an absolute path.",
            Self::Missing => "The configured module folder does not exist.",
            Self::NotDirectory => "The configured module folder is not a directory.",
            Self::Inaccessible => "The configured module folder is inaccessible.",
        }
    }
}

pub(crate) fn validate_configured(path: Option<&str>) -> Result<PathBuf, ModuleFolderFailure> {
    let value = path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or(ModuleFolderFailure::Unset)?;
    let path = PathBuf::from(value);
    validate(&path)?;
    Ok(path)
}

pub(crate) fn validate(path: &Path) -> Result<(), ModuleFolderFailure> {
    if !path.is_absolute() {
        return Err(ModuleFolderFailure::Relative);
    }
    let metadata = std::fs::metadata(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => ModuleFolderFailure::Missing,
        _ => ModuleFolderFailure::Inaccessible,
    })?;
    if !metadata.is_dir() {
        return Err(ModuleFolderFailure::NotDirectory);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(ModuleFolderFailure::Inaccessible);
        }
    }
    std::fs::read_dir(path)
        .map(drop)
        .map_err(|_| ModuleFolderFailure::Inaccessible)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_every_unusable_folder_shape() {
        let root = tempfile::tempdir().expect("create a folder fixture");
        let missing = root.path().join("missing");
        let file = root.path().join("file");
        std::fs::write(&file, b"not a directory").expect("write the file fixture");

        assert_eq!(validate_configured(None), Err(ModuleFolderFailure::Unset));
        assert_eq!(
            validate_configured(Some("relative")),
            Err(ModuleFolderFailure::Relative)
        );
        assert_eq!(validate(&missing), Err(ModuleFolderFailure::Missing));
        assert_eq!(validate(&file), Err(ModuleFolderFailure::NotDirectory));
        assert_eq!(validate(root.path()), Ok(()));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_directory_without_search_permission() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempfile::tempdir().expect("create a folder fixture");
        let blocked = root.path().join("blocked");
        std::fs::create_dir(&blocked).expect("create the blocked directory");
        std::fs::set_permissions(&blocked, std::fs::Permissions::from_mode(0o600))
            .expect("remove search permission");

        assert_eq!(validate(&blocked), Err(ModuleFolderFailure::Inaccessible));
    }
}
