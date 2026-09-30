import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildWebHookRunnerCommand } from "../../scripts/web-dev.mjs";

export function prepareDesktopHookRunner({ root, execute = execFileSync, environment = process.env }) {
  const version = execute("rustc", ["-vV"], { encoding: "utf8", env: environment });
  const target = version.match(/^host: (\S+)$/m)?.[1];
  if (!target) throw new Error("Could not determine the Rust host target for ticketry-hook");
  const build = buildWebHookRunnerCommand({ cwd: root });
  const targetDirectory = path.join(root, "studio", "src-tauri", "target");
  execute(build.command, [...build.args, "--target", target, "--target-dir", targetDirectory], {
    cwd: root, env: environment, stdio: "inherit",
  });
  const output = path.join(root, "studio", "src-tauri", "binaries", `ticketry-hook-${target}`);
  mkdirSync(path.dirname(output), { recursive: true });
  copyFileSync(path.join(targetDirectory, target, "debug", path.basename(build.output)), output);
  return output;
}
