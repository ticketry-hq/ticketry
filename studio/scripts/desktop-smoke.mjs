import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildTauriDevArguments } from "./desktop-dev-launch-plan.mjs";
import { resolveTauriCliPath } from "./desktop-dev.mjs";
import { editionFeatureArguments, resolveEditionBuild } from "./edition-build-policy.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const executable = path.join(
  studioRoot,
  "src-tauri",
  "target",
  "release",
  process.platform === "win32" ? "ticketry.exe" : "ticketry",
);
const libghosttyPrepareScript = path.join(
  studioRoot,
  "scripts",
  "prepare-libghostty.sh",
);
const smokeModes = ["all", "dev", "packaged"];

/**
 * Plan one smoke run of the resolved edition: both Tauri commands carry the
 * edition's Cargo features and the shared environment carries TICKETRY_EDITION
 * to the Vite frontend. An invalid edition or mode throws before anything runs.
 */
export function planDesktopSmoke({ mode = "all", environment = process.env, tauriCli }) {
  const editionBuild = resolveEditionBuild(environment);
  if (!smokeModes.includes(mode)) {
    throw new Error("desktop smoke mode must be all, dev, or packaged");
  }
  const developmentPort = environment.MUXED_DESKTOP_SMOKE_PORT ?? "15174";
  const developmentConfig = JSON.stringify({
    build: {
      beforeDevCommand: `bun run dev -- --host 127.0.0.1 --port ${developmentPort} --strictPort`,
      devUrl: `http://127.0.0.1:${developmentPort}`,
    },
  });
  return {
    mode,
    editionBuild,
    environment: {
      ...editionBuild.environment,
      MUXED_DESKTOP_SMOKE_EXIT_AFTER_STARTUP: "1",
    },
    developmentArguments: buildTauriDevArguments({ tauriCli, config: developmentConfig, editionBuild }),
    packagedArguments: [tauriCli, "build", "--no-bundle"].concat(editionFeatureArguments(editionBuild)),
  };
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
  environment,
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

async function withSmokeDataDirectory(smokeEnvironment, run) {
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

async function main() {
  if (process.platform === "darwin" && process.arch !== "arm64") {
    throw new Error(
      `desktop smoke does not support macOS host architecture ${process.arch}; `
        + "Ticketry releases require macOS/arm64",
    );
  }
  const tauriCli = resolveTauriCliPath();
  const plan = planDesktopSmoke({ mode: process.argv[2] ?? "all", environment: process.env, tauriCli });
  const { mode, environment: smokeEnvironment } = plan;
  console.log(plan.editionBuild.description);
  const guiSmokeSupported = supportsGuiSmoke();

  // CODING-1486 — native libghostty is a default Cargo feature, so both smoke
  // builds need the pinned static library in place before cargo runs.
  await runCommandWithTimeout(
    "pinned libghostty preparation",
    "sh",
    [libghosttyPrepareScript],
    600_000,
    smokeEnvironment,
  );

  if (mode === "all" || mode === "dev") {
    await withSmokeDataDirectory(smokeEnvironment, async (developmentSmokeEnvironment) => {
      if (guiSmokeSupported) {
        await runCommandWithTimeout(
          "desktop development startup",
          process.execPath,
          plan.developmentArguments,
          180_000,
          developmentSmokeEnvironment,
        );
      } else {
        console.log("Desktop development window smoke skipped: no display available.");
      }
    });
  }

  if (mode === "all" || mode === "packaged") {
    await withSmokeDataDirectory(smokeEnvironment, async (packagedSmokeEnvironment) => {
      await runCommandWithTimeout(
        "desktop production build",
        process.execPath,
        plan.packagedArguments,
        300_000,
        packagedSmokeEnvironment,
      );
      await assertPackagedAssets();
      if (guiSmokeSupported) {
        for (const label of ["startup", "restart/reopen"]) {
          await runCommandWithTimeout(
            `packaged desktop ${label}`,
            executable,
            [],
            60_000,
            packagedSmokeEnvironment,
          );
        }
      } else {
        console.log("Packaged desktop window smoke skipped: no display available.");
      }
    });
  }

  console.log(
    mode === "all"
      ? "Desktop development, packaged startup, and clean shutdown smoke passed."
      : `Desktop ${mode} startup and clean shutdown smoke passed.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Desktop smoke failed: ${error.message}`);
    process.exitCode = 1;
  });
}
