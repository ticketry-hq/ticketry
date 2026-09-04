import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const sourceRoot = join(root, "studio", "src");
const entry = join(sourceRoot, "main.tsx");
const extensions = [".ts", ".tsx"];
const forbidden = [
  ["generated OpenAPI SDK", /@worktracker\/typescript-sdk/],
  ["retired REST client", /shared\/api\/client/],
  ["retired authenticated HTTP helper", /authenticatedHostFetch/],
  ["REST runtime fallback", /\brest\s*:/],
  ["retired status or terminal socket", /(?:\/ws\/(?:status|terminal)|new\s+WebSocket\s*\()/],
  ["retired backend URL", /(?:\/api\/work-tracker|VITE_(?:WT|AGENT)_API)/],
];

function localModule(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  const candidates = extname(base)
    ? [base]
    : [...extensions.map((extension) => `${base}${extension}`), ...extensions.map((extension) => join(base, `index${extension}`))];
  return candidates.find(existsSync) ?? null;
}

function imports(source) {
  return [...source.matchAll(/(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gs)]
    .filter((match) => !/^(?:import|export)\s+type\b/.test(match[0]))
    .map((match) => match[1]);
}

const visited = new Set();
const pending = [entry];
const parent = new Map();
const findings = [];
const retiredPaths = [
  "backend/manage.py",
  "backend/pyproject.toml",
  "backend/studio_server",
  "backend/sidecar_packaging",
  "surfaces/worktracker-agent",
  "surfaces/worktracker-sdk",
  "surfaces/worktracker-typescript-sdk",
  "openapi.json",
  "openapitools.json",
  "scripts/export-openapi.mjs",
  "scripts/generate-python-sdk.mjs",
  "scripts/generate-typescript-sdk.mjs",
  "studio/src-tauri/src/sidecar_supervision",
  "studio/src-tauri/src/desktop/backend_launch.rs",
  "studio/src-tauri/src/desktop/sidecar_probe.rs",
];
for (const relative of retiredPaths) {
  if (existsSync(join(root, relative))) {
    findings.push(`${relative}: retired runtime or generated contract still exists`);
  }
}
while (pending.length) {
  const file = pending.pop();
  if (!file || visited.has(file)) continue;
  visited.add(file);
  const source = readFileSync(file, "utf8");
  for (const [label, pattern] of forbidden) {
    source.split("\n").forEach((line, index) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("//") && !trimmed.startsWith("*") && pattern.test(line)) {
        findings.push(`${file.slice(root.length + 1)}:${index + 1}: ${label}`);
      }
      pattern.lastIndex = 0;
    });
  }
  for (const specifier of imports(source)) {
    const target = localModule(file, specifier);
    if (target) {
      if (!parent.has(target)) parent.set(target, file);
      pending.push(target);
    }
  }
}

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (/backend|python|uvicorn/i.test(packageJson.scripts.web ?? "")) {
  findings.push("package.json: browser development starts a retired product backend");
}
const proxy = readFileSync(join(root, "studio", "vite.proxy.ts"), "utf8");
if (/^[^/\n]*["']\/api/m.test(proxy) || /\bws\s*:/m.test(proxy)) {
  findings.push("studio/vite.proxy.ts: development proxy exposes retired REST or WebSocket routing");
}
const mcpRuntime = readFileSync(
  join(
    root,
    "studio",
    "src-tauri",
    "crates",
    "app",
    "ticketry-desktop",
    "src",
    "desktop",
    "mcp_runtime.rs",
  ),
  "utf8",
);
if (!mcpRuntime.includes("if cfg!(debug_assertions)") || !mcpRuntime.includes("Ok(0)")) {
  findings.push("studio/src-tauri/crates/app/ticketry-desktop/src/desktop/mcp_runtime.rs: production MCP must request an OS-assigned port");
}
const shippingFiles = [
  "package.json",
  ".github/workflows/ci.yml",
  "studio/release/manifest.v1.json",
  "studio/scripts/desktop-dev.mjs",
  "studio/scripts/desktop-smoke.mjs",
  "studio/scripts/release-build.mjs",
  "studio/src-tauri/tauri.conf.json",
  "scripts/web-dev.mjs",
];
const retiredShippingReference = /(?:muxed-backend|build-sidecar|sidecar_version|openapi:export|python-sdk|MUXED_(?:DESKTOP_)?BACKEND_PORT|\/api\/work-tracker)/i;
for (const relative of shippingFiles) {
  const source = readFileSync(join(root, relative), "utf8");
  if (retiredShippingReference.test(source)) {
    findings.push(`${relative}: shipping command or manifest references the retired runtime`);
  }
}

if (findings.length) {
  const explain = (finding) => {
    const relative = finding.split(":")[0];
    let file = join(root, relative);
    const chain = [];
    while (parent.has(file)) {
      file = parent.get(file);
      chain.unshift(file.slice(root.length + 1));
    }
    return chain.length ? `${finding} (via ${chain.join(" -> ")})` : finding;
  };
  console.error("Shipping caller gate failed:\n" + findings.map(explain).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Shipping caller gate passed across ${visited.size} reachable Studio modules.`);
}
