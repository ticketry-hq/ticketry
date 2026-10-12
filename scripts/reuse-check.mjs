// `npm run reuse:check`: loads the repository inputs, runs the reuse rules,
// prints findings (as GitHub annotations under Actions) and exits non-zero
// only when a finding blocks. Rules live in scripts/reuse-gate/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readBaseline } from "./reuse-gate/duplication/baseline.mjs";
import { scanClones } from "./reuse-gate/duplication/jscpd-scan.mjs";
import { ignoredPaths } from "./reuse-gate/duplication/scan-config.mjs";
import { reuseFindings } from "./reuse-gate/findings.mjs";
import { providerCatalogModuleExceptions } from "./reuse-gate/provider-catalog-exceptions.mjs";
import { providerCatalogMigrationsFolder } from "./reuse-gate/rules/provider-catalog-modules.mjs";

const guidanceFiles = ["AGENTS.md", "CLAUDE.md"];
const featureMapDirectory = "docs/feature-map";
const featureMapIndex = `${featureMapDirectory}/README.md`;
const capabilityGuide = `${featureMapDirectory}/how-to-add-a-capability.md`;

export function repositoryRoot(argv) {
  const flag = argv.indexOf("--root");
  if (flag !== -1 && argv[flag + 1]) return path.resolve(argv[flag + 1]);
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

// Repository-relative path → Markdown text, "" for any other existing entry, null when absent.
function repositoryReader(root) {
  return (file) => {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute)) return null;
    if (fs.statSync(absolute).isFile() && /\.md$/i.test(file)) return fs.readFileSync(absolute, "utf8");
    return "";
  };
}

function markdownDocuments(root, directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return markdownDocuments(root, file);
      return /\.md$/i.test(entry.name)
        ? [{ file, source: fs.readFileSync(path.join(root, file), "utf8") }]
        : [];
    });
}

function rustFiles(root, directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return rustFiles(root, file);
      return /\.rs$/.test(entry.name) ? [file] : [];
    });
}

export function loadReuseInputs(root) {
  const readRepositoryFile = repositoryReader(root);
  return {
    guidance: guidanceFiles.map((file) => ({ file, source: readRepositoryFile(file) ?? "" })),
    featureMapDocuments: markdownDocuments(root, featureMapDirectory),
    featureMapIndex,
    capabilityGuide,
    providerCatalogMigrationFiles: rustFiles(root, providerCatalogMigrationsFolder),
    providerCatalogModuleExceptions,
    readRepositoryFile,
    duplication: { clones: scanClones(root), baseline: readBaseline(root), ignore: ignoredPaths },
  };
}

function report(level, { id, file, line, message }) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const location = line ? `file=${file},line=${line}` : `file=${file}`;
    console.log(`::${level} ${location}::${id}: ${message}`);
  } else {
    console.log(`${level === "error" ? "BLOCKING" : "advisory"} ${file}${line ? `:${line}` : ""} ${id}: ${message}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { blocking, advisory } = reuseFindings(loadReuseInputs(repositoryRoot(process.argv)));
  blocking.forEach((finding) => report("error", finding));
  advisory.forEach((finding) => report("warning", finding));
  console.log(`reuse:check: ${blocking.length} blocking, ${advisory.length} advisory`);
  if (blocking.length > 0) process.exitCode = 1;
}
