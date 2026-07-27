import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Regenerate the committed terminal WS wire-frame JSON Schema (#692). The frames
// are declared in ticketry's Django backend, so this runs that project's
// management command; its default
// destination is the committed studio artifact.
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

const result = spawnSync(python, ["manage.py", "export_wire_frames"], {
  cwd: serverDir,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
