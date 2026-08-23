import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveTauriCliPath } from "./desktop-dev.mjs";

const studioRoot = fileURLToPath(new URL("..", import.meta.url));
const tauriCli = resolveTauriCliPath();
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
if (process.platform === "darwin" && process.arch !== "arm64") {
  throw new Error(
    `desktop smoke does not support macOS host architecture ${process.arch}; `
      + "Ticketry releases require macOS/arm64",
  );
}
const developmentPort = process.env.MUXED_DESKTOP_SMOKE_PORT ?? "15174";
const developmentConfig = JSON.stringify({
  build: {
    beforeDevCommand: `npm run dev -- --host 127.0.0.1 --port ${developmentPort} --strictPort`,
    devUrl: `http://127.0.0.1:${developmentPort}`,
  },
});
const smokeEnvironment = {
  ...process.env,
  MUXED_DESKTOP_SMOKE_EXIT_AFTER_STARTUP: "1",
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

if (mode === "all" || mode === "dev") {
  await withSmokeDataDirectory(async (developmentSmokeEnvironment) => {
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
  });
}

if (mode === "all" || mode === "packaged") {
  await withSmokeDataDirectory(async (packagedSmokeEnvironment) => {
    await runCommandWithTimeout(
      "desktop production build",
      process.execPath,
      [tauriCli, "build", "--no-bundle"],
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
