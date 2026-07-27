import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const backend = resolve(root, "backend");
const destination = resolve(
  root,
  process.env.WORKTRACKER_OPENAPI_DESTINATION || "openapi.json",
);
const localPython =
  process.platform === "win32"
    ? resolve(backend, ".venv", "Scripts", "python.exe")
    : resolve(backend, ".venv", "bin", "python");
const python = process.env.WORKTRACKER_PYTHON || (existsSync(localPython) ? localPython : "python3");
const result = spawnSync(
  python,
  ["-m", "django", "export_openapi", destination],
  {
    cwd: backend,
    env: {
      ...process.env,
      DJANGO_SETTINGS_MODULE: "worktracker.openapi_settings",
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
