import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveTauriCliPath } from "./desktop-dev.mjs";
import {
  assertDevelopmentEndpointAgreement,
  buildDevelopmentSmokeConfiguration,
} from "./desktop-smoke-config.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const tauriCli = resolveTauriCliPath();
const executable = path.join(
  studioRoot,
  "src-tauri",
  "target",
  "release",
  process.platform === "win32" ? "ticketry.exe" : "ticketry",
);
const backendBuildScript = path.join(
  studioRoot,
  "..",
  "backend",
  "packaging",
  "build-sidecar.sh",
);
const libghosttyPrepareScript = path.join(
  studioRoot,
  "scripts",
  "prepare-libghostty.sh",
);
const backendSidecarSmoke = path.join(
  studioRoot,
  "..",
  "backend",
  "packaging",
  "test-built-sidecar.sh",
);
const targetTriples = {
  darwin: process.arch === "arm64" ? "aarch64-apple-darwin" : null,
  linux: process.arch === "arm64"
    ? "aarch64-unknown-linux-gnu"
    : "x86_64-unknown-linux-gnu",
  win32: process.arch === "arm64"
    ? "aarch64-pc-windows-msvc"
    : "x86_64-pc-windows-msvc",
};
const targetTriple = targetTriples[process.platform];
if (process.platform === "darwin" && process.arch !== "arm64") {
  throw new Error(
    `desktop smoke does not support macOS host architecture ${process.arch}; `
      + "Ticketry releases require macOS/arm64",
  );
}
if (!targetTriple) {
  throw new Error(`desktop smoke does not support ${process.platform}/${process.arch}`);
}
const sidecarBinary = path.join(
  studioRoot,
  "src-tauri",
  "binaries",
  `muxed-backend-${targetTriple}${process.platform === "win32" ? ".exe" : ""}`,
);
const developmentPort = process.env.MUXED_DESKTOP_SMOKE_PORT ?? "15174";
const developmentSmokeConfiguration = buildDevelopmentSmokeConfiguration(
  developmentPort,
);
const developmentConfig = JSON.stringify({
  build: {
    beforeDevCommand: `npm run dev -- --host 127.0.0.1 --port ${developmentPort} --strictPort`,
    devUrl: developmentSmokeConfiguration.webviewUrl,
  },
});
const smokeEnvironment = {
  ...process.env,
  MUXED_DESKTOP_SMOKE_EXIT_AFTER_STARTUP: "1",
  MUXED_DESKTOP_SMOKE_SIDECAR_BINARY: sidecarBinary,
};
const developmentSmokeEnvironment = {
  ...smokeEnvironment,
  ...developmentSmokeConfiguration.runtimeEnvironment,
};
const mode = process.argv[2] ?? "all";
if (!["all", "dev", "packaged"].includes(mode)) {
  throw new Error("desktop smoke mode must be all, dev, or packaged");
}

function supportsGuiSmoke() {
  return process.platform !== "linux" || Boolean(
    process.env.DISPLAY || process.env.WAYLAND_DISPLAY,
  );
}

function runCommandWithTimeout(
  label,
  command,
  args,
  timeoutMs,
  environment = smokeEnvironment,
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: studioRoot,
      env: environment,
      stdio: "inherit",
    });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${label} did not shut down within ${timeoutMs / 1000}s`));
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} exited with ${code ?? signal}`));
      }
    });
  });
}

async function withSmokeDataDirectory(run) {
  const dataDirectory = await mkdtemp(path.join(tmpdir(), "muxed-desktop-smoke-"));
  try {
    return await run({
      ...smokeEnvironment,
      MUXED_DATA_DIR: dataDirectory,
    });
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

async function assertPackagedAssets() {
  const indexPath = path.join(studioRoot, "dist", "index.html");
  await Promise.all([access(indexPath), access(executable)]);
  const index = await readFile(indexPath, "utf8");
  const resourceReferences = [...index.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1]);
  if (resourceReferences.length === 0) {
    throw new Error("packaged Studio index does not reference any local assets");
  }
  for (const reference of resourceReferences) {
    if (/^(?:[a-z]+:)?\/\//i.test(reference)) {
      throw new Error(`packaged Studio asset is remote: ${reference}`);
    }
    const relativePath = reference.replace(/^\/+/, "");
    await access(path.join(studioRoot, "dist", relativePath));
  }
}

const guiSmokeSupported = supportsGuiSmoke();

await runCommandWithTimeout(
  "pinned libghostty preparation",
  "sh",
  [libghosttyPrepareScript],
  600_000,
  smokeEnvironment,
);

// Tauri validates every externalBin path while compiling the development
// shell. A clean checkout deliberately contains no generated sidecar, so
// produce the ignored smoke binary before either `tauri dev` or `tauri build`.
// Packaged-only mode prepares it in its own block below.
if (mode === "all" || mode === "dev") {
  await runCommandWithTimeout(
    "development backend sidecar build",
    "bash",
    [backendBuildScript],
    300_000,
    smokeEnvironment,
  );
}

if (mode === "all" || mode === "dev") {
  assertDevelopmentEndpointAgreement(
    developmentSmokeConfiguration.webviewUrl,
    developmentSmokeEnvironment,
  );
  if (guiSmokeSupported) {
    await runCommandWithTimeout(
      "desktop development startup",
      process.execPath,
      [tauriCli, "dev", "--no-watch", "--config", developmentConfig],
      180_000,
      developmentSmokeEnvironment,
    );
  } else {
    console.log("Desktop development window smoke skipped: no display available.");
  }
}

if (mode === "all" || mode === "packaged") {
  await withSmokeDataDirectory(async (packagedSmokeEnvironment) => {
    if (mode === "packaged") {
      await runCommandWithTimeout(
        "packaged backend sidecar build",
        "bash",
        [backendBuildScript],
        300_000,
        packagedSmokeEnvironment,
      );
    }
    await runCommandWithTimeout(
      "desktop production build",
      process.execPath,
      [tauriCli, "build", "--no-bundle"],
      300_000,
      packagedSmokeEnvironment,
    );
    await assertPackagedAssets();
    if (guiSmokeSupported) {
      await runCommandWithTimeout(
        "packaged desktop startup",
        executable,
        [],
        60_000,
        packagedSmokeEnvironment,
      );
    } else {
      await runCommandWithTimeout(
        "headless packaged backend service smoke",
        "bash",
        [backendSidecarSmoke, sidecarBinary],
        120_000,
        packagedSmokeEnvironment,
      );
    }
  });
}

console.log(
  mode === "all"
    ? "Desktop development, packaged startup, and clean shutdown smoke passed."
    : `Desktop ${mode} startup and clean shutdown smoke passed.`,
);
