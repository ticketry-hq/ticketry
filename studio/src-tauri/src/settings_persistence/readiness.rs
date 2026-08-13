//! One versioned readiness result for the complete Slice 2 runtime.

use std::path::Path;

use serde::{Deserialize, Serialize};

use super::atomic_json::{write_json, RealAtomicFileOperations};
use super::ownership_manifest::VERSION;
use super::SettingsPersistenceError;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Slice2Readiness {
    pub version: i32,
    pub ownership: bool,
    pub graphql: bool,
    pub rust_mcp: bool,
    pub django_effect_port: bool,
    pub ready: bool,
    pub django_write_fallback: bool,
}

impl Slice2Readiness {
    pub fn unavailable() -> Self {
        Self {
            version: VERSION,
            ownership: false,
            graphql: false,
            rust_mcp: false,
            django_effect_port: false,
            ready: false,
            django_write_fallback: false,
        }
    }

    pub fn complete() -> Self {
        Self {
            version: VERSION,
            ownership: true,
            graphql: true,
            rust_mcp: true,
            django_effect_port: true,
            ready: true,
            django_write_fallback: false,
        }
    }

    pub fn validate(&self) -> Result<(), SettingsPersistenceError> {
        let complete = self.ownership
            && self.graphql
            && self.rust_mcp
            && self.django_effect_port
            && !self.django_write_fallback;
        if self.ready != complete {
            return Err(SettingsPersistenceError::UnknownSchema(
                "partial Slice 2 readiness cannot accept commands".to_owned(),
            ));
        }
        Ok(())
    }
}

pub fn publish(
    data_directory: &Path,
    readiness: &Slice2Readiness,
) -> Result<(), SettingsPersistenceError> {
    readiness.validate()?;
    write_json(
        &data_directory.join("slice2-readiness.json"),
        readiness,
        &RealAtomicFileOperations,
    )
}

pub fn published_readiness_is_complete(data_directory: &Path) -> bool {
    let Ok(contents) = std::fs::read(data_directory.join("slice2-readiness.json")) else {
        return false;
    };
    let Ok(readiness) = serde_json::from_slice::<Slice2Readiness>(&contents) else {
        return false;
    };
    readiness == Slice2Readiness::complete() && readiness.validate().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_result_cannot_claim_readiness() {
        let mut readiness = Slice2Readiness::complete();
        readiness.rust_mcp = false;
        assert!(readiness.validate().is_err());
    }

    #[test]
    fn unavailable_result_is_a_valid_closed_gate() {
        assert!(Slice2Readiness::unavailable().validate().is_ok());
    }

    #[test]
    fn missing_or_partial_published_result_keeps_commands_closed() {
        let directory = tempfile::tempdir().expect("create readiness directory");
        assert!(!published_readiness_is_complete(directory.path()));

        publish(directory.path(), &Slice2Readiness::unavailable())
            .expect("publish unavailable readiness");
        assert!(!published_readiness_is_complete(directory.path()));

        std::fs::write(
            directory.path().join("slice2-readiness.json"),
            br#"{"version":1,"ownership":true,"graphql":true,"rust_mcp":true,"django_effect_port":true,"ready":true,"django_write_fallback":false,"unknown":true}"#,
        )
        .expect("write readiness with an unknown field");
        assert!(!published_readiness_is_complete(directory.path()));

        publish(directory.path(), &Slice2Readiness::complete()).expect("publish readiness");
        assert!(published_readiness_is_complete(directory.path()));
    }
}
