import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const baselineFile = "scripts/reuse-gate/duplication/baseline.json";

// A clone's identity survives unrelated edits: the sorted pair of
// repository-relative paths plus a hash of the whitespace-normalised
// duplicated fragment. Line numbers are deliberately not part of it.
export function cloneIdentity({ first, second, fragment }) {
  const files = [first.file, second.file].map((file) => file.replaceAll("\\", "/")).sort();
  const normalised = fragment.replace(/\s+/g, " ").trim();
  const fragmentHash = createHash("sha256").update(normalised).digest("hex").slice(0, 16);
  return { files, fragmentHash };
}

export function identityKey({ files, fragmentHash }) {
  return `${files.join("\n")}\n${fragmentHash}`;
}

/** The committed baseline: one sorted, de-duplicated entry per clone identity. */
export function cloneBaseline(clones) {
  const entries = new Map();
  for (const clone of clones) {
    const identity = cloneIdentity(clone);
    entries.set(identityKey(identity), { ...identity, tokens: clone.tokens, lines: clone.lines });
  }
  return [...entries.keys()].sort().map((key) => entries.get(key));
}

export function readBaseline(root) {
  const file = path.join(root, baselineFile);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

export function writeBaseline(root, entries) {
  fs.mkdirSync(path.dirname(path.join(root, baselineFile)), { recursive: true });
  fs.writeFileSync(path.join(root, baselineFile), `${JSON.stringify(entries, null, 2)}\n`);
}
