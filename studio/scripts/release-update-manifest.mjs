/**
 * Validation for the `latest.json` the stable update feed serves.
 *
 * The release manifest declares the shape (`artifacts.updater.latest_manifest`)
 * and this module is the only thing that reads that policy, so the feed
 * contract lives in one place instead of being restated by each publisher.
 */
export class UpdateManifestError extends Error {}

function fieldValue(latest, dottedPath) {
  return dottedPath
    .split(".")
    .reduce((value, key) => (value === undefined || value === null ? value : value[key]), latest);
}

export function validateLatestJson(manifest, latest) {
  const policy = manifest?.artifacts?.updater?.latest_manifest;
  if (!policy) {
    throw new UpdateManifestError(
      "the release manifest must declare artifacts.updater.latest_manifest",
    );
  }
  if (policy.format !== "tauri-static-json-v2") {
    throw new UpdateManifestError(
      "artifacts.updater.latest_manifest.format must be tauri-static-json-v2",
    );
  }
  if (!latest || typeof latest !== "object") {
    throw new UpdateManifestError("latest.json must be a JSON object");
  }
  for (const field of policy.required_fields ?? []) {
    const value = fieldValue(latest, field);
    if (typeof value !== "string" || value === "") {
      throw new UpdateManifestError(`latest.json requires ${field}`);
    }
  }
  if (
    policy.version_matches_release_version === true
    && latest.version !== manifest.release_version
  ) {
    throw new UpdateManifestError(
      `latest.json version must match the release version ${manifest.release_version}`,
    );
  }
  if (policy.notes_required === true && latest.notes.trim() === "") {
    throw new UpdateManifestError("latest.json requires non-empty notes");
  }
  if (Number.isNaN(new Date(latest.pub_date).valueOf())) {
    throw new UpdateManifestError("latest.json requires a valid pub_date");
  }
  return latest;
}
