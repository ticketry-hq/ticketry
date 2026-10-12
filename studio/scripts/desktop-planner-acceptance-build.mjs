import { editionFeatureArguments, resolveEditionBuild } from "./edition-build-policy.mjs";

/**
 * Plan the planner desktop acceptance binary. Sprint planning ships only in the
 * Core edition, so a Pocock build (default or explicit) is refused before any
 * build starts. The case exercises the desktop lifecycle and WKWebView HTTP
 * transport; the supported xterm fallback keeps the unrelated native terminal
 * library out of this test build, so default features stay off.
 */
export function planPlannerAcceptanceBuild(environment = process.env) {
  const editionBuild = resolveEditionBuild(environment);
  if (editionBuild.edition !== "core") {
    throw new Error("Planner desktop acceptance requires the core edition; rerun with TICKETRY_EDITION=core.");
  }
  return {
    editionBuild,
    command: "cargo",
    args: [
      "build",
      "--offline",
      "--manifest-path",
      "studio/src-tauri/Cargo.toml",
      "--bin",
      "ticketry",
      "--no-default-features",
      ...editionFeatureArguments(editionBuild, ["desktop-acceptance"]),
    ],
    environment: {
      ...editionBuild.environment,
      TAURI_CONFIG: JSON.stringify({ build: { devUrl: null }, bundle: { resources: [] } }),
    },
  };
}
