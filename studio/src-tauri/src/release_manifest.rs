//! The supported desktop targets embedded from the release build manifest.

use serde::Deserialize;

const RELEASE_MANIFEST: &str = include_str!("../../release/manifest.v1.json");

#[derive(Debug, Deserialize)]
struct ReleaseManifest {
    schema_version: u8,
    targets: Vec<ReleaseTarget>,
}

#[derive(Debug, Deserialize)]
struct ReleaseTarget {
    platform: String,
    architecture: String,
    sidecar: Sidecar,
}

#[derive(Debug, Deserialize)]
struct Sidecar {
    bundle_binary_name: String,
}

pub fn packaged_sidecar_name() -> Result<String, String> {
    let manifest: ReleaseManifest = serde_json::from_str(RELEASE_MANIFEST)
        .map_err(|error| format!("release manifest is invalid: {error}"))?;
    if manifest.schema_version != 1 {
        return Err(format!(
            "release manifest schema version {} is unsupported",
            manifest.schema_version
        ));
    }
    let target = manifest
        .targets
        .iter()
        .find(|target| {
            target.platform == std::env::consts::OS
                && target.architecture == std::env::consts::ARCH
        })
        .ok_or_else(|| {
            format!(
                "no release manifest target declares {}/{}; packaged desktop launch is unsupported on this platform",
                std::env::consts::OS,
                std::env::consts::ARCH
            )
        })?;
    Ok(format!(
        "{}{}",
        target.sidecar.bundle_binary_name,
        std::env::consts::EXE_SUFFIX
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_is_versioned_and_declares_only_macos_targets() {
        let manifest: ReleaseManifest = serde_json::from_str(RELEASE_MANIFEST).unwrap();
        assert_eq!(manifest.schema_version, 1);
        assert_eq!(manifest.targets.len(), 2);
        assert!(manifest
            .targets
            .iter()
            .all(|target| target.platform == "macos"));
        assert!(manifest
            .targets
            .iter()
            .all(|target| !target.sidecar.bundle_binary_name.is_empty()));
    }
}
