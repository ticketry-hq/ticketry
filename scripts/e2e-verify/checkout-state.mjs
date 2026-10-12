import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertSourceContained } from './checkout-paths.mjs';
const execute = promisify(execFile);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function git(repoDir, args) {
  const { stdout } = await execute('git', ['-C', repoDir, ...args], {
    encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  return stdout;
}
const paths = bytes => bytes.toString('utf8').split('\0').filter(Boolean);
export async function checkoutState(repoDir) {
  const gitDir = (await git(repoDir, ['rev-parse', '--absolute-git-dir'])).toString().trim();
  const commonDir = path.resolve(repoDir, (await git(repoDir, ['rev-parse', '--git-common-dir'])).toString().trim());
  const head = (await git(repoDir, ['rev-parse', '--verify', 'HEAD'])).toString().trim();
  const index = await git(repoDir, ['ls-files', '--stage', '-v', '-z']);
  const staged = await git(repoDir, ['diff', '--cached', '--binary', '--no-ext-diff', '--no-textconv']);
  const stash = await git(repoDir, ['stash', 'list', '--format=%gd']);
  const tracked = paths(await git(repoDir, ['ls-files', '--cached', '-z']));
  const untracked = paths(await git(repoDir, ['ls-files', '--others', '--exclude-standard', '-z']));
  const dirty = [...new Set([...paths(await git(repoDir, ['diff', '--cached', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv'])), ...paths(await git(repoDir, ['diff', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv'])), ...untracked])].sort();
  const files = Object.create(null);
  for (const name of [...new Set([...tracked, ...untracked])].sort()) {
    try {
      const full = path.join(repoDir, name);
      await assertSourceContained(repoDir, name);
      const stat = await lstat(full);
      const kind = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : 'directory';
      const bytes = kind === 'symlink' ? Buffer.from(await readlink(full)) : kind === 'file' ? await readFile(full) : Buffer.from('directory');
      files[name] = { hash: hash(bytes), kind, mode: stat.mode & 0o777 };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return { gitDirectories: [await realpath(gitDir), await realpath(commonDir), path.join(repoDir, '.git')], head, indexHash: hash(Buffer.concat([index, staged])), stashCount: stash.toString().split('\n').filter(Boolean).length, dirtyPaths: dirty, files };
}
