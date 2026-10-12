import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink, readlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { snapshotCheckout, checkCheckout } from './checkout-guard.mjs';

function git(repo, ...args) { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }); }
async function fixture(t) {
  const repo = await mkdtemp(path.join(tmpdir(), 'checkout-guard-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  await writeFile(path.join(repo, 'owned.md'), 'committed\n');
  await writeFile(path.join(repo, '.gitignore'), '.run/\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-qm', 'initial');
  return { repoDir: repo, runDir: path.join(repo, '.run'), writeSets: ['owned.md'] };
}

test('pre-dirty edits are backed up byte-identically and reported without changing the checkout', async t => {
  const options = await fixture(t);
  const original = Buffer.from([0, 255, 12, 48]);
  await writeFile(path.join(options.repoDir, 'owned.md'), original);
  const before = git(options.repoDir, 'status', '--porcelain');
  const snapshot = await snapshotCheckout(options);
  assert.equal(git(options.repoDir, 'status', '--porcelain'), before);
  assert.deepEqual(await readFile(snapshot.backups['owned.md']), original);
  await writeFile(path.join(options.repoDir, 'owned.md'), 'sweep edit');
  const result = await checkCheckout(JSON.parse(JSON.stringify(snapshot)));
  assert.deepEqual(result.fatal, []);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.changedFiles, [{ path: 'owned.md', change: 'modified', preexisting: true, backupPath: snapshot.backups['owned.md'] }]);
  assert.equal(await readFile(path.join(options.repoDir, 'owned.md'), 'utf8'), 'sweep edit');
});

test('invalid write sets refuse traversal before creating backups', async t => {
  const options = await fixture(t);
  await assert.rejects(snapshotCheckout({ ...options, writeSets: ['../outside/'] }), /relative|traversal/);
});

test('staged edits are pre-existing even when working bytes match HEAD', async t => {
  const options = await fixture(t);
  await writeFile(path.join(options.repoDir, 'owned.md'), 'staged');
  git(options.repoDir, 'add', 'owned.md');
  await writeFile(path.join(options.repoDir, 'owned.md'), 'committed\n');
  const snapshot = await snapshotCheckout(options);
  assert.deepEqual(snapshot.dirtyPaths, ['owned.md']);
  assert.equal(await readFile(snapshot.backups['owned.md'], 'utf8'), 'committed\n');
});

test('JSON snapshots classify new prototype-like paths as created', async t => {
  const options = await fixture(t);
  const snapshot = JSON.parse(JSON.stringify(await snapshotCheckout(options)));
  await writeFile(path.join(options.repoDir, 'constructor'), 'new');
  const result = await checkCheckout(snapshot);
  assert.equal(result.changedFiles[0].change, 'created');
  assert.equal(result.changedFiles[0].backupPath, null);
});

test('run directories cannot grant the whole checkout or write git metadata', async t => {
  const options = await fixture(t);
  for (const runDir of [options.repoDir, path.join(options.repoDir, '.git', 'run')]) {
    await assert.rejects(snapshotCheckout({ ...options, runDir }), /run directory/i);
  }
});

for (const [mutation, expected] of [
  ['commit', 'head'], ['stage', 'indexHash'], ['stash', 'stashCount'],
]) {
  test(`${mutation} is fatal and check never reverses it`, async t => {
    const options = await fixture(t);
    const snapshot = await snapshotCheckout(options);
    await writeFile(path.join(options.repoDir, 'owned.md'), 'changed');
    if (mutation === 'commit') { git(options.repoDir, 'add', '.'); git(options.repoDir, 'commit', '-qm', 'sweep'); }
    if (mutation === 'stage') git(options.repoDir, 'add', 'owned.md');
    if (mutation === 'stash') git(options.repoDir, 'stash', 'push', '-qm', 'sweep');
    const before = git(options.repoDir, 'status', '--porcelain=v1');
    const result = await checkCheckout(snapshot);
    assert.ok(result.fatal.some(entry => entry.kind === expected));
    assert.equal(git(options.repoDir, 'status', '--porcelain=v1'), before);
  });
}

test('out-of-set creation and dirty restoration are changes from the sweep or a concurrent edit', async t => {
  const options = await fixture(t);
  await writeFile(path.join(options.repoDir, 'owned.md'), 'developer edit');
  const snapshot = await snapshotCheckout(options);
  await writeFile(path.join(options.repoDir, 'owned.md'), 'committed\n');
  await writeFile(path.join(options.repoDir, 'owned.md.extra'), 'outside');
  const result = await checkCheckout(snapshot);
  assert.deepEqual(result.changedFiles.map(file => [file.path, file.change, file.preexisting]), [['owned.md', 'modified', true], ['owned.md.extra', 'created', false]]);
  assert.equal(result.violations[0].kind, 'write-set');
  assert.match(result.violations[0].message, /from the sweep or a concurrent edit/);
  assert.deepEqual((await checkCheckout(snapshot, { writeSets: ['owned.md', 'owned.md.extra'] })).violations, []);
});

test('deleting a pre-dirty file names its byte-identical backup', async t => {
  const options = await fixture(t);
  await writeFile(path.join(options.repoDir, 'owned.md'), 'developer edit');
  const snapshot = await snapshotCheckout(options);
  await rm(path.join(options.repoDir, 'owned.md'));
  const result = await checkCheckout(snapshot);
  assert.equal(result.changedFiles[0].change, 'deleted');
  assert.equal(result.violations[0].kind, 'preexisting-deletion');
  assert.equal(result.violations[0].backupPath, snapshot.backups['owned.md']);
  assert.ok(result.violations[0].message.includes(snapshot.backups['owned.md']));
  assert.equal(await readFile(snapshot.backups['owned.md'], 'utf8'), 'developer edit');
  await assert.rejects(readFile(path.join(options.repoDir, 'owned.md')), { code: 'ENOENT' });
});

test('index flags changed without staged content are fatal', async t => {
  const options = await fixture(t);
  const snapshot = await snapshotCheckout(options);
  git(options.repoDir, 'update-index', '--assume-unchanged', 'owned.md');
  assert.ok((await checkCheckout(snapshot)).fatal.some(entry => entry.kind === 'indexHash'));
});

test('backup symlink escape and reused destinations never overwrite existing bytes', async t => {
  const options = await fixture(t);
  await writeFile(path.join(options.repoDir, 'owned.md'), 'developer edit');
  await mkdir(options.runDir);
  const outside = path.join(options.repoDir, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'owned.md'), 'keep me');
  await symlink(outside, path.join(options.runDir, 'preexisting'));
  await assert.rejects(snapshotCheckout(options), /Unsafe backup directory/);
  assert.equal(await readFile(path.join(outside, 'owned.md'), 'utf8'), 'keep me');
  await rm(path.join(options.runDir, 'preexisting'));
  const snapshot = await snapshotCheckout(options);
  await assert.rejects(snapshotCheckout(options), { code: 'EEXIST' });
  assert.equal(await readFile(snapshot.backups['owned.md'], 'utf8'), 'developer edit');
});

test('directory write sets cover descendants and symlink backups preserve links without reading targets', async t => {
  const options = await fixture(t);
  await mkdir(path.join(options.repoDir, 'docs'));
  await symlink('../owned.md', path.join(options.repoDir, 'docs', 'link'));
  options.writeSets = ['docs/'];
  const snapshot = await snapshotCheckout(options);
  assert.equal(await readlink(snapshot.backups['docs/link']), '../owned.md');
  await writeFile(path.join(options.repoDir, 'docs', 'new.md'), 'new');
  const result = await checkCheckout(snapshot);
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.changedFiles.map(file => [file.path, file.change]), [['docs/new.md', 'created']]);
});

test('executable mode changes are reported without changing HEAD or index', async t => {
  const options = await fixture(t);
  const snapshot = await snapshotCheckout(options);
  await chmod(path.join(options.repoDir, 'owned.md'), 0o755);
  const result = await checkCheckout(snapshot);
  assert.equal(result.changedFiles[0].change, 'modified');
  assert.deepEqual(result.fatal, []);
});
