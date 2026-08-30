//! Where the data directory is.
//!
//! Production web and installed desktop builds share one path. Development
//! launchers select isolated paths through an explicit environment override.
//! Resolving the product path never moves or copies configuration.

use std::env;
use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};

use serde::Deserialize;

use super::error::OwnershipError;

const PRODUCT_IDENTITY_JSON: &str = include_str!("../../../../config/product-identity.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductIdentity {
    default_data_directory_name: String,
    data_directory_name_environment_variable: String,
    data_directory_path_environment_variables: Vec<String>,
}

/// The product path shared by production web and installed desktop builds.
/// This deliberately does not move or copy configuration.
pub fn established_data_directory() -> Result<PathBuf, OwnershipError> {
    let identity = product_identity()?;
    resolve_data_directory(
        &identity,
        &env::current_dir().map_err(|error| OwnershipError::Io(error.to_string()))?,
        env::var_os("HOME").as_deref(),
        |name| env::var_os(name),
    )
}

fn product_identity() -> Result<ProductIdentity, OwnershipError> {
    serde_json::from_str(PRODUCT_IDENTITY_JSON)
        .map_err(|error| OwnershipError::Io(format!("could not read product identity: {error}")))
}

fn resolve_data_directory(
    identity: &ProductIdentity,
    current_directory: &Path,
    home: Option<&OsStr>,
    environment: impl Fn(&str) -> Option<OsString>,
) -> Result<PathBuf, OwnershipError> {
    for variable in &identity.data_directory_path_environment_variables {
        let Some(value) = environment(variable) else {
            continue;
        };
        if value.is_empty() {
            continue;
        }
        let path = PathBuf::from(value);
        return Ok(if path.is_absolute() {
            path
        } else {
            current_directory.join(path)
        });
    }

    let directory_name = environment(&identity.data_directory_name_environment_variable)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| OsString::from(&identity.default_data_directory_name));
    if !is_single_directory_name(&directory_name) {
        return Err(OwnershipError::Io(format!(
            "{} must be one directory name",
            identity.data_directory_name_environment_variable
        )));
    }
    let home = home.ok_or_else(|| {
        OwnershipError::Io("could not determine HOME for the product data directory".to_owned())
    })?;
    Ok(PathBuf::from(home).join(".config").join(directory_name))
}

fn is_single_directory_name(value: &OsStr) -> bool {
    let mut components = Path::new(value).components();
    matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn resolve(
        identity: &ProductIdentity,
        home: Option<&str>,
        values: &[(&str, &str)],
    ) -> Result<PathBuf, OwnershipError> {
        let values = values
            .iter()
            .map(|(key, value)| ((*key).to_owned(), OsString::from(value)))
            .collect::<HashMap<_, _>>();
        resolve_data_directory(
            identity,
            Path::new("/repository"),
            home.map(OsStr::new),
            |name| values.get(name).cloned(),
        )
    }

    #[test]
    fn manifest_maps_the_product_to_its_default_profile() {
        let identity = product_identity().expect("product identity");
        assert_eq!(identity.default_data_directory_name, "ticketry");
        assert_eq!(
            resolve(&identity, Some("/users/ticketry"), &[]).expect("default directory"),
            PathBuf::from("/users/ticketry/.config").join(&identity.default_data_directory_name)
        );
    }

    #[test]
    fn configured_path_precedes_the_configured_name() {
        let identity = product_identity().expect("product identity");
        let path_variable = &identity.data_directory_path_environment_variables[0];
        let values = [
            (path_variable.as_str(), "../shared-data"),
            (
                identity.data_directory_name_environment_variable.as_str(),
                "ignored-name",
            ),
        ];
        assert_eq!(
            resolve(&identity, Some("/users/ticketry"), &values).expect("configured path"),
            PathBuf::from("/repository/../shared-data")
        );
    }

    #[test]
    fn configured_name_changes_the_directory_under_config() {
        let identity = product_identity().expect("product identity");
        let values = [(
            identity.data_directory_name_environment_variable.as_str(),
            "ticketry-next",
        )];
        assert_eq!(
            resolve(&identity, Some("/users/ticketry"), &values).expect("configured name"),
            PathBuf::from("/users/ticketry/.config/ticketry-next")
        );
    }

    #[test]
    fn configured_name_cannot_escape_the_config_directory() {
        let identity = product_identity().expect("product identity");
        let values = [(
            identity.data_directory_name_environment_variable.as_str(),
            "../outside",
        )];
        let error = resolve(&identity, Some("/users/ticketry"), &values)
            .expect_err("escaping name must fail");
        assert!(error.to_string().contains("must be one directory name"));
    }
}
