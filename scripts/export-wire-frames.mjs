import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Regenerate the committed terminal and Chat WS wire-frame JSON Schemas. The
// frames are declared in Ticketry's Django backend, so these management
// commands remain the structural source of truth for the Studio artifacts.
const root = resolve(import.meta.dirname, "..");
const serverDir = resolve(root, "backend");
const localServerPython =
  process.platform === "win32"
    ? resolve(serverDir, ".venv", "Scripts", "python.exe")
    : resolve(serverDir, ".venv", "bin", "python");
const python =
  process.env.MUXED_SERVER_PYTHON ||
  (existsSync(localServerPython) ? localServerPython : null);

if (!python) {
  console.error(
    `Cannot export WS wire frames: ticketry backend checkout not found ` +
      `(looked for ${localServerPython}). Set MUXED_SERVER_PYTHON.`,
  );
  process.exit(1);
}

for (const command of ["export_wire_frames", "export_chat_wire_frames"]) {
  const result = spawnSync(python, ["manage.py", command], {
    cwd: serverDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
