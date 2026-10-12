import path from 'node:path';
import { lstat, mkdir, realpath } from 'node:fs/promises';

export function validateWriteSets(writeSets) {
  if (!Array.isArray(writeSets)) throw new Error('writeSets must be an array of relative paths');
  for (const name of writeSets) {
    if (typeof name !== 'string' || !name || path.isAbsolute(name) || name.includes('\\') || name.includes('\0') || name.split('/').some(part => part === '..' || part === '.' || part === '.git') || name.includes('//')) {
      throw new Error(`Invalid relative write-set path (traversal forbidden): ${name}`);
    }
  }
}

export async function safeBackupDirectory(runDir, relativeDirectory) {
  // Resolve the caller's existing ancestors, then reject symlinks within the run directory.
  const root = path.resolve(runDir);
  async function ensure(directory) {
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe backup directory: ${directory}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await ensure(path.dirname(directory));
      await mkdir(directory);
    }
  }
  await ensure(root);
  let current = await realpath(root);
  for (const part of ['preexisting', ...relativeDirectory.split('/').filter(Boolean)]) {
    current = path.join(current, part);
    await ensure(current);
  }
  return current;
}

export async function assertSourceContained(repoDir, name) {
  const parent = await realpath(path.dirname(path.join(repoDir, name)));
  const relative = path.relative(repoDir, parent);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Checkout path escapes repository through a symlink: ${name}`);
}

export async function canonicalRunDirectory(runDir, repoDir, gitDirectories) {
  async function resolveExisting(directory) {
    try {
      const stat = await lstat(directory);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe run directory: ${directory}`);
      return await realpath(directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return path.join(await resolveExisting(path.dirname(directory)), path.basename(directory));
    }
  }
  const resolved = await resolveExisting(path.resolve(runDir));
  const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
  if (resolved === repoDir || gitDirectories.some(directory => inside(directory, resolved))) throw new Error(`Invalid run directory: ${resolved}`);
  return resolved;
}
