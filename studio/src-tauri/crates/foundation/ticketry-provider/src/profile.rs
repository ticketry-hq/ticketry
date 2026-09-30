use std::collections::BTreeSet;

use crate::{ProviderError, ProviderErrorCode};

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct ProfileSelection<'a> {
    pub profile: Option<&'a str>,
    pub model: Option<&'a str>,
    pub effort: Option<&'a str>,
}

pub(crate) fn normalize_supported(values: &[String]) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

pub(crate) fn normalize_unsupported(values: &[String]) -> Result<Vec<String>, ProviderError> {
    if values.iter().all(|value| value.trim().is_empty()) {
        Ok(Vec::new())
    } else {
        Err(ProviderError::new(
            ProviderErrorCode::UnsupportedProfile,
            "This provider does not support launch profiles.",
        ))
    }
}

pub(crate) fn validate_supported(
    selection: ProfileSelection<'_>,
    registered: &[String],
) -> Result<(), ProviderError> {
    let Some(profile) = selection.profile else {
        return Ok(());
    };
    if profile.trim().is_empty() {
        return Err(ProviderError::new(
            ProviderErrorCode::InvalidProfile,
            "A launch profile must be non-empty.",
        ));
    }
    if selection.model.is_some() || selection.effort.is_some() {
        return Err(ProviderError::new(
            ProviderErrorCode::ProfileConflict,
            "A launch profile cannot be combined with model or effort overrides.",
        ));
    }
    if !registered.iter().any(|candidate| candidate == profile) {
        return Err(ProviderError::new(
            ProviderErrorCode::UnregisteredProfile,
            format!("Launch profile '{profile}' is not registered."),
        ));
    }
    Ok(())
}

pub(crate) fn validate_unsupported(selection: ProfileSelection<'_>) -> Result<(), ProviderError> {
    if selection.profile.is_none() {
        Ok(())
    } else {
        Err(ProviderError::new(
            ProviderErrorCode::UnsupportedProfile,
            "This provider does not support launch profiles.",
        ))
    }
}
