import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  defaultPackagedUpdateWebDriverBoundaries,
  executeWebviewRequest,
  packagedUpdateRuntimeError,
} from "./packaged-update-webdriver-boundaries.mjs";
import { createPackagedUpdateDataAdapter } from "./packaged-update-webdriver-data.mjs";

export class PackagedUpdateWebDriverError extends Error {}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PackagedUpdateWebDriverError(`${label} is required`);
  }
}

export async function startPackagedUpdateWebDriver({
  appPath,
  dataDirectory,
  evidenceDirectory = path.join(dataDirectory, "evidence"),
  home,
  versionA,
  versionB,
  environment = process.env,
  boundaries: boundaryOverrides = {},
}) {
  requiredText(appPath, "app path");
  requiredText(dataDirectory, "data directory");
  requiredText(home, "acceptance HOME");
  requiredText(versionA, "version A");
  requiredText(versionB, "version B");
  const boundaries = {
    ...defaultPackagedUpdateWebDriverBoundaries,
    ...boundaryOverrides,
  };
  const port = await boundaries.allocatePort();
  const executable = await boundaries.findAppExecutable(appPath);
  await Promise.all([
    mkdir(dataDirectory, { recursive: true }),
    mkdir(evidenceDirectory, { recursive: true }),
    mkdir(home, { recursive: true }),
  ]);

  let session;
  let child;
  let currentVersion = versionA;
  let initialOwner;
  let checkedVersion;
  let disposed = false;
  const observedOwners = new Map();
  const applicationEnvironment = {
    ...environment,
    HOME: home,
    MUXED_DATA_DIR: dataDirectory,
    TICKETRY_DATA_DIR: dataDirectory,
    TAURI_WEBDRIVER_PORT: String(port),
    NO_PROXY: "127.0.0.1,localhost",
  };

  async function invoke(command, args) {
    if (!session) {
      throw new PackagedUpdateWebDriverError("the installed app is not connected");
    }
    const result = await executeWebviewRequest(session, {
      kind: "invoke",
      command,
      args,
    });
    if (!result?.ok) throw packagedUpdateRuntimeError(result?.error);
    return result.value;
  }

  async function health() {
    const configuration = await invoke("desktop_runtime_configuration");
    const serviceHealth = configuration?.serviceHealth ?? configuration?.service_health;
    return serviceHealth?.state === "ready";
  }

  async function connectHealthy() {
    session = await boundaries.waitFor(
      () => boundaries.connect(port),
      "installed Ticketry WebDriver",
    );
    await boundaries.waitFor(health, "installed Ticketry readiness");
  }

  async function rememberOwner(version, previousPid) {
    const owner = await boundaries.waitFor(async () => {
      const candidate = await boundaries.readLockOwner(dataDirectory);
      return candidate
        && candidate.pid !== previousPid
        && boundaries.isProcessAlive(candidate.pid)
        ? candidate
        : false;
    }, "data-directory ownership");
    observedOwners.set(owner.pid, version);
    return owner;
  }

  const browser = {
    async openInstalledApp() {
      if (!session) {
        child = boundaries.spawnApp(executable, {
          cwd: path.dirname(executable),
          environment: applicationEnvironment,
          stderrPath: path.join(evidenceDirectory, "app.stderr.log"),
          stdoutPath: path.join(evidenceDirectory, "app.stdout.log"),
        });
        await connectHealthy();
        initialOwner = await rememberOwner(versionA);
      }
      return { version: currentVersion, healthy: await health() };
    },

    async checkForUpdate() {
      try {
        const result = await invoke("desktop_update_check");
        if (result?.status === "available") {
          checkedVersion = result.availableVersion ?? result.available_version;
          return { status: "available", version: checkedVersion };
        }
        return {
          status: "current",
          version: result?.installedVersion ?? result?.installed_version,
        };
      } catch (error) {
        return { status: "error", error: packagedUpdateRuntimeError(error) };
      }
    },

    async confirmUpdate() {
      if (!checkedVersion) {
        throw new PackagedUpdateWebDriverError(
          "check for an available update before confirming it",
        );
      }
      try {
        await invoke("desktop_update_download_and_install", {
          expectedVersion: checkedVersion,
        });
        return { status: "relaunching" };
      } catch (error) {
        return { status: "refused", error: packagedUpdateRuntimeError(error) };
      }
    },

    async waitForRelaunch() {
      if (!initialOwner) {
        throw new PackagedUpdateWebDriverError("version A is not running");
      }
      const previousPid = initialOwner.pid;
      await invoke("desktop_update_restart");
      const oldSession = session;
      session = undefined;
      await oldSession?.deleteSession().catch(() => undefined);
      await boundaries.waitFor(
        () => !boundaries.isProcessAlive(previousPid),
        "version A shutdown",
      );
      await rememberOwner(versionB, previousPid);
      await connectHealthy();
      currentVersion = versionB;
    },

    async inspectApp() {
      return { version: currentVersion, healthy: await health() };
    },
  };

  const processes = {
    async inspectCurrent() {
      const owner = await boundaries.readLockOwner(dataDirectory);
      const active = owner && boundaries.isProcessAlive(owner.pid)
        ? [{
            role: "app",
            version: observedOwners.get(owner.pid) ?? currentVersion,
            pid: owner.pid,
          }]
        : [];
      const stranded = [...observedOwners.keys()]
        .filter((pid) => pid !== owner?.pid && boundaries.isProcessAlive(pid));
      if (initialOwner && owner?.pid !== initialOwner.pid) {
        return {
          dataDirectoryLock: {
            releasedByVersion: versionA,
            reacquiredByVersion: observedOwners.get(owner?.pid) ?? currentVersion,
            clean: active.length === 1 && stranded.length === 0,
          },
          active,
          stranded,
        };
      }
      return {
        dataDirectoryLock: {
          ownerVersion: owner
            ? observedOwners.get(owner.pid) ?? currentVersion
            : undefined,
          clean: active.length === 1 && stranded.length === 0,
        },
        active,
        stranded,
      };
    },
  };

  const data = createPackagedUpdateDataAdapter({
    boundaries,
    currentSession: () => session,
    dataDirectory,
    disconnectedError: () => new PackagedUpdateWebDriverError(
      "the installed app is not connected",
    ),
    home,
  });

  return {
    browser,
    data,
    processes,
    async dispose() {
      if (disposed) return;
      disposed = true;
      const currentSession = session;
      session = undefined;
      await currentSession?.deleteSession().catch(() => undefined);
      const owner = await boundaries.readLockOwner(dataDirectory);
      const pids = new Set([
        ...(owner ? [owner.pid] : []),
        ...(child?.pid ? [child.pid] : []),
      ]);
      for (const pid of pids) await boundaries.stopPid(pid);
    },
  };
}
