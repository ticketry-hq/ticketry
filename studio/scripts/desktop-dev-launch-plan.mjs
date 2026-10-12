import { editionFeatureArguments } from "./edition-build-policy.mjs";

/** `tauri dev` arguments for one resolved edition; Core adds its Cargo feature. */
export function buildTauriDevArguments({ tauriCli, config, editionBuild }) {
  return [tauriCli, "dev", "--no-watch", ...editionFeatureArguments(editionBuild), "--config", config];
}

/**
 * The environment cargo and `tauri dev` run in. Tauri's `beforeDevCommand`
 * (Vite) inherits it, so the frontend compiles the same edition as the host.
 */
export function createDesktopDevEnvironment({
  editionBuild,
  dataDirectory,
  logPath,
  startupTraceId,
  tmuxSocket,
  temporarySqlite,
}) {
  return {
    ...editionBuild.environment,
    MUXED_DATA_DIR: dataDirectory,
    MUXED_DEVELOPMENT_LOG_PATH: logPath,
    MUXED_STARTUP_TRACE_ID: startupTraceId,
    MUXED_ENABLE_LOCAL_POSTGRES: "true",
    MUXED_TMUX_SOCKET: tmuxSocket,
    ...(temporarySqlite ? { MUXED_FORCE_SQLITE: "true" } : {}),
  };
}
