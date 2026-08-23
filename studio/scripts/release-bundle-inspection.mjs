import { readdir } from "node:fs/promises";
import path from "node:path";

const FORBIDDEN_BASENAMES = [
  /^python(?:\d+(?:\.\d+)*)?$/,
  /^libpython.*\.dylib$/,
  /^muxed-backend(?:-.+)?$/,
  /^django$/,
  /^fastmcp$/,
  /^openapi\.(?:json|ya?ml)$/,
  /^(?:worktracker-)?(?:python|typescript)-sdk$/,
  /^sidecar(?:-launch)?(?:-configuration)?\.(?:json|plist|toml|ya?ml)$/,
];

async function collectBundleEntries(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectBundleEntries(root, absolutePath);
    return [path.relative(root, absolutePath)];
  }));
  return nested.flat();
}

function isForbiddenArtifact(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const lower = normalized.toLowerCase();
  const basename = path.posix.basename(lower);
  if (lower.startsWith("Contents/Resources/ghostty/themes/".toLowerCase())) {
    return false;
  }
  return basename.endsWith(".py")
    || basename.endsWith(".pyc")
    || lower.split("/").includes("__pycache__")
    || FORBIDDEN_BASENAMES.some((pattern) => pattern.test(basename));
}

export async function inspectReleaseBundle(appPath, mainExecutableName) {
  const executableDirectory = path.join(appPath, "Contents", "MacOS");
  const executableEntries = (await readdir(executableDirectory, { withFileTypes: true }))
    .filter((entry) => !entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const expectedExecutables = [mainExecutableName, "ticketry-hook"].sort();
  const unexpectedExecutables = executableEntries.filter(
    (entry) => !expectedExecutables.includes(entry),
  );
  const missingExecutables = expectedExecutables.filter(
    (entry) => !executableEntries.includes(entry),
  );
  const forbiddenArtifacts = (await collectBundleEntries(appPath))
    .filter(isForbiddenArtifact)
    .sort();
  return { forbiddenArtifacts, missingExecutables, unexpectedExecutables };
}
