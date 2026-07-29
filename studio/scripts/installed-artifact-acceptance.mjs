import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

export class InstalledArtifactAcceptanceError extends Error {}

const REQUIRED_SCENARIOS = [
  "clean_install",
  "upgrade_with_existing_data",
  "failed_update_recovery",
  "uninstall_preserves_data",
  "missing_dependency_diagnostic",
  "os_permission_diagnostic",
  "durable_agent_terminal_flow",
  "offline_packaged_skill_matrix",
  "skill_configuration_unchanged",
  "skill_overlay_cleanup",
];

const REQUIRED_SKILLS = ["grill-with-docs", "to-spec", "to-tickets"];
const SKILL_PROVIDERS = ["claude", "codex", "agy", "gemini"];

function requireValue(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InstalledArtifactAcceptanceError(`${label} is required`);
  }
  return value;
}

function command(command, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new InstalledArtifactAcceptanceError(
        `${command} ${args.join(" ")} failed (${code ?? signal})`,
      ));
    });
  });
}

export function sanitizedDesktopEnvironment({ home, dataDirectory, resultPath }) {
  return {
    HOME: home,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    TMPDIR: path.join(home, "tmp"),
    NO_PROXY: "127.0.0.1,localhost",
    HTTP_PROXY: "http://127.0.0.1:1",
    HTTPS_PROXY: "http://127.0.0.1:1",
    ALL_PROXY: "http://127.0.0.1:1",
    MUXED_DATA_DIR: dataDirectory,
    MUXED_DESKTOP_ACCEPTANCE_RESULT: resultPath,
    MUXED_DESKTOP_ACCEPTANCE_NODE: process.execPath,
  };
}

export function acceptanceDataDirectory(home) {
  return path.join(home, ".config", "worktracker-studio");
}

export function assertAcceptanceResult(result) {
  if (!result || typeof result !== "object") {
    throw new InstalledArtifactAcceptanceError("acceptance driver did not write a JSON object");
  }
  for (const scenario of REQUIRED_SCENARIOS) {
    if (result[scenario] !== true) {
      throw new InstalledArtifactAcceptanceError(
        `installed-artifact acceptance scenario failed: ${scenario}`,
      );
    }
  }
  const providerEvidence = result.packaged_skill_providers;
  if (!providerEvidence || typeof providerEvidence !== "object") {
    throw new InstalledArtifactAcceptanceError(
      "acceptance driver omitted packaged skill provider evidence",
    );
  }
  for (const provider of SKILL_PROVIDERS) {
    const discovered = providerEvidence[provider];
    if (!Array.isArray(discovered)
      || REQUIRED_SKILLS.some((skill) => !discovered.includes(skill))) {
      throw new InstalledArtifactAcceptanceError(
        `installed artifact did not discover required packaged skills for ${provider}`,
      );
    }
  }
  const diagnostics = result.diagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length < 2) {
    throw new InstalledArtifactAcceptanceError(
      "acceptance driver must record redacted missing-dependency and permission diagnostics",
    );
  }
  const diagnosticKinds = new Set();
  for (const diagnostic of diagnostics) {
    diagnosticKinds.add(diagnostic?.kind);
    const message = diagnostic?.message;
    if (typeof message !== "string" || message.trim() === "") {
      throw new InstalledArtifactAcceptanceError("acceptance driver reported an empty diagnostic");
    }
    if (/((api|access|auth|secret|token|password)[_-]?(key|token|password)?\s*[=:])|bearer\s+/i.test(message)) {
      throw new InstalledArtifactAcceptanceError("acceptance diagnostic leaked a credential");
    }
  }
  for (const kind of ["missing_dependency", "os_permission"]) {
    if (!diagnosticKinds.has(kind)) {
      throw new InstalledArtifactAcceptanceError(`acceptance driver omitted ${kind} diagnostic evidence`);
    }
  }
}

export async function installArtifact(bundlePath, installationRoot) {
  const source = path.resolve(bundlePath);
  const destination = path.join(installationRoot, "Applications", "Ticketry.app");
  try {
    await access(path.join(source, "Contents", "MacOS"));
  } catch {
    throw new InstalledArtifactAcceptanceError(`installed-artifact acceptance requires a macOS .app bundle: ${source}`);
  }
  await cp(source, destination, { recursive: true });
  return destination;
}

export async function runDriverAfterColdLaunch({
  appPath,
  driverPath,
  environment,
  workspace,
  run = command,
}) {
  // The driver owns the clean-install launch, readiness check, and termination.
  // A preceding `open -W` cannot be a bounded liveness precondition because a
  // healthy GUI app remains open until something explicitly quits it.
  await run(driverPath, [appPath], { cwd: workspace, env: environment });
}

export async function runInstalledArtifactAcceptance({ bundlePath, driverPath, run = command }) {
  requireValue(bundlePath, "bundlePath");
  requireValue(driverPath, "MUXED_DESKTOP_ACCEPTANCE_DRIVER");
  if (!path.isAbsolute(driverPath)) {
    throw new InstalledArtifactAcceptanceError("MUXED_DESKTOP_ACCEPTANCE_DRIVER must be an absolute path");
  }
  const workspace = await mkdtemp(path.join(tmpdir(), "muxed-installed-artifact-"));
  const home = path.join(workspace, "home");
  const dataDirectory = acceptanceDataDirectory(home);
  const resultPath = path.join(workspace, "result.json");
  try {
    const appPath = await installArtifact(bundlePath, workspace);
    await mkdir(path.join(home, "tmp"), { recursive: true });
    const environment = sanitizedDesktopEnvironment({ home, dataDirectory, resultPath });
    await runDriverAfterColdLaunch({
      appPath,
      driverPath,
      environment,
      workspace,
      run,
    });
    assertAcceptanceResult(JSON.parse(await readFile(resultPath, "utf8")));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

async function main() {
  const [bundlePath] = process.argv.slice(2);
  await runInstalledArtifactAcceptance({
    bundlePath,
    driverPath: process.env.MUXED_DESKTOP_ACCEPTANCE_DRIVER,
  });
  console.log("Installed-artifact acceptance passed.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
