import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const self = path.relative(root, new URL(import.meta.url).pathname);

const skippedDirs = new Set([
  ".git",
  ".pytest_cache",
  ".venv",
  "__pycache__",
  "node_modules",
  "spec",
]);

const textExtensions = new Set([
  ".cfg",
  ".ini",
  ".js",
  ".json",
  ".mjs",
  ".py",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const findings = [];

function addFinding(file, message) {
  findings.push(`${file}: ${message}`);
}

function shouldRead(file) {
  const ext = path.extname(file);
  return textExtensions.has(ext);
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute);

    if (entry.isDirectory()) {
      if (skippedDirs.has(entry.name)) continue;
      if (entry.name === "worktracker_gateway") {
        addFinding(relative, "worktracker_gateway must not be created as a durable package");
      }
      walk(absolute);
      continue;
    }

    if (!entry.isFile() || relative === self || !shouldRead(relative)) continue;

    const text = fs.readFileSync(absolute, "utf8");
    const lines = text.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (/\b(from|import)\s+worktracker_gateway\b/.test(line)) {
        addFinding(`${relative}:${index + 1}`, "worktracker_gateway imports are forbidden");
      }
      if (/\bINSTALLED_APPS\b/.test(line) && /\bworktracker_gateway\b/.test(line)) {
        addFinding(`${relative}:${index + 1}`, "worktracker_gateway must not be a Django app");
      }
      if (/worktracker_gateway\*/.test(line)) {
        addFinding(`${relative}:${index + 1}`, "package discovery must not include worktracker_gateway*");
      }
      if (/backend[/\\]worktracker_gateway/.test(line)) {
        addFinding(`${relative}:${index + 1}`, "backend/worktracker_gateway must not be introduced");
      }
    });
  }
}

walk(root);

if (findings.length > 0) {
  console.error("Boundary check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log("Boundary check passed: no worktracker_gateway package/app/import surface found.");
