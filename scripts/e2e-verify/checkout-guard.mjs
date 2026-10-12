import { constants, copyFile, readlink, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { checkoutState } from './checkout-state.mjs';
import { validateWriteSets, safeBackupDirectory, canonicalRunDirectory } from './checkout-paths.mjs';

const assigned = (name, sets) => sets.some(set => set.endsWith('/') ? name.startsWith(set) : name === set);

/** Snapshot before agents run. Write sets contain exact paths or directory prefixes ending in '/'. */
export async function snapshotCheckout({ repoDir, runDir, writeSets }) {
  validateWriteSets(writeSets);
  repoDir = await realpath(repoDir);
  const state = await checkoutState(repoDir);
  runDir = await canonicalRunDirectory(runDir, repoDir, state.gitDirectories);
  const backups = Object.create(null);
  for (const name of state.dirtyPaths.filter(name => assigned(name, writeSets) && state.files[name])) {
    const directory = await safeBackupDirectory(runDir, path.posix.dirname(name) === '.' ? '' : path.posix.dirname(name));
    const destination = path.join(directory, path.basename(name));
    if (state.files[name].kind === 'symlink') await symlink(await readlink(path.join(repoDir, name)), destination);
    else if (state.files[name].kind === 'file') await copyFile(path.join(repoDir, name), destination, constants.COPYFILE_EXCL);
    else throw new Error(`Cannot back up non-file checkout path: ${name}`);
    backups[name] = destination;
  }
  return { ...state, repoDir: await realpath(repoDir), runDir: path.resolve(runDir), writeSets, backups };
}

/** Compare against original content; never repair or revert the developer's checkout. */
export async function checkCheckout(snapshot, { writeSets = snapshot.writeSets } = {}) {
  validateWriteSets(writeSets);
  const current = await checkoutState(snapshot.repoDir);
  const changedFiles = [];
  for (const name of [...new Set([...Object.keys(snapshot.files), ...Object.keys(current.files)])].sort()) {
    const before = Object.hasOwn(snapshot.files, name) ? snapshot.files[name] : undefined;
    const after = Object.hasOwn(current.files, name) ? current.files[name] : undefined;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changedFiles.push({ path: name, change: !before ? 'created' : !after ? 'deleted' : 'modified', preexisting: snapshot.dirtyPaths.includes(name), backupPath: Object.hasOwn(snapshot.backups, name) ? snapshot.backups[name] : null });
  }
  const fatal = [];
  for (const key of ['head', 'indexHash', 'stashCount']) {
    if (snapshot[key] !== current[key]) fatal.push({ kind: key, message: `${key} changed during the sweep` });
  }
  const runRelative = path.relative(snapshot.repoDir, snapshot.runDir).split(path.sep).join('/') + '/';
  const violations = [];
  for (const file of changedFiles) {
    if (!assigned(file.path, [...writeSets, runRelative])) violations.push({ kind: 'write-set', path: file.path, message: `${file.path} changed outside assigned write sets from the sweep or a concurrent edit` });
    if (file.change === 'deleted' && file.preexisting) violations.push({ kind: 'preexisting-deletion', path: file.path, backupPath: file.backupPath, message: `${file.path} had pre-existing uncommitted changes and was deleted; backup: ${file.backupPath ?? 'not assigned a write set; no backup'}` });
  }
  return { fatal, violations, changedFiles };
}
