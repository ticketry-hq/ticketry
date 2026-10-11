import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveFeatureRegistry } from '../src/test/feature-map/featureSuites.mjs';
import { checkFeatureSuites } from '../src/test/feature-map/checkFeatureSuites.mjs';
import { runFeatureCommand } from './feature-e2e-command.mjs';
import { selectFeatures, planInvocations } from './feature-e2e/selection.mjs';
import { selectFrontendPort, invocationEnvironment, runInvocation, stopProcessGroup } from './feature-e2e/invocation.mjs';
import { snapshotProvenance, sourceHashes } from './feature-e2e/provenance.mjs';
import { createPlaywrightProfile, cleanupPlaywrightProfile } from './playwright-profile.mjs';
import { writeFeatureResults } from './feature-e2e/report.mjs';
import { buildStackBinaries, startStackServer } from './feature-e2e/stackServer.mjs';
import { coldStartFeatures, createWarmPool, warmLookahead } from './feature-e2e/warmPool.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function buildPlaywrightCommand(invocation) {
  return ['bun', 'run', '--cwd', 'studio', 'test:e2e', invocation.file.replace(/^studio\//, ''),
    '--project', invocation.project, '--grep', invocation.grep, '--trace', 'on', '--retries', '0'];
}

export async function runFeatureE2e(args = process.argv.slice(2)) {
  const map = join(root, 'docs/feature-map'), e2e = join(root, 'studio/e2e');
  const registry = deriveFeatureRegistry(map, e2e, root);
  const violations = checkFeatureSuites(map, e2e, root);
  if (args.includes('--list') || args.includes('--check')) return runFeatureCommand(args, { registry, violations });
  const selection = selectFeatures(registry, args);
  const plans = planInvocations(selection);
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
  const runDirectory = join(root, '.ticketry-dev/e2e-results', runId);
  mkdirSync(runDirectory, { recursive: true });
  const provenance = snapshotProvenance(root, runDirectory);
  const manifest = { version: 1, runId, startedAt: new Date().toISOString(), finishedAt: null,
    revision: provenance.revision, dirty: provenance.dirty,
    workingTreePatch: 'working-tree.patch', sourceHashSnapshot: 'source-sha256.json', registrySnapshot: 'registry.json',
    command: ['bun', 'run', '--cwd', 'studio', 'test:e2e:features', ...args],
    selection: { featureIds: selection.features.map(f => f.id), caseIds: selection.cases.map(c => c.id), complete: selection.complete },
    violations, invocations: [], interrupted: false, sourceChanged: false };
  writeFileSync(join(runDirectory, 'registry.json'), JSON.stringify(registry, null, 2) + '\n');
  const save = () => writeFileSync(join(runDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  save();
  let activeChild = null, stoppingChild = null, stopTimer;
  const stop = () => {
    manifest.interrupted = true;
    if (!activeChild) return;
    const child = activeChild;
    stoppingChild = child;
    stopProcessGroup(child);
    stopTimer = setTimeout(() => stopProcessGroup(child, 'SIGKILL'), 10_000);
    stopTimer.unref();
  };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  // Build the adapter once; every server then starts its binary instead of
  // running Cargo, so a concurrent edit cannot stall a case mid-run.
  const binaries = buildStackBinaries();
  const setups = new Map();
  /** Each plan entry owns one artifact directory, profile and port pair. */
  const setupFor = (index) => {
    if (!setups.has(index)) setups.set(index, (async () => {
      const plan = plans[index];
      const artifactDirectory = join(runDirectory, plan.id);
      mkdirSync(artifactDirectory);
      const frontendPort = await selectFrontendPort();
      const profile = createPlaywrightProfile();
      const { env, owned } = await invocationEnvironment(profile, artifactDirectory, frontendPort);
      env.TICKETRY_E2E_EXTERNAL_SERVER = owned.TICKETRY_E2E_EXTERNAL_SERVER = '1';
      return { artifactDirectory, frontendPort, profile, env, owned };
    })());
    return setups.get(index);
  };
  const pool = createWarmPool({
    count: plans.length,
    lookahead: warmLookahead(),
    isCold: (index) => coldStartFeatures.has(plans[index].featureId),
    start: async (index) => startStackServer({
      owner: `run ${runId} ${plans[index].id}`, setup: await setupFor(index), binaries,
      shouldStop: () => manifest.interrupted,
    }),
  });
  try {
    for (const [index, plan] of plans.entries()) {
      if (manifest.interrupted) break;
      const invocation = { ...plan, startedAt: new Date().toISOString(), exitCode: null, cleanup: null };
      manifest.invocations.push(invocation); save();
      let server;
      try {
        const setup = await setupFor(index);
        Object.assign(invocation, { artifactDirectory: setup.artifactDirectory, profilePath: setup.profile.dataDirectory });
        server = await pool.take(index);
        invocation.server = { log: 'web-server.log', warmed: pool.warmed(index) };
        if (manifest.interrupted) break;
        invocation.environment = setup.owned;
        invocation.command = buildPlaywrightCommand(plan);
        writeFileSync(join(setup.artifactDirectory, 'command.json'), JSON.stringify(invocation.command, null, 2) + '\n');
        writeFileSync(join(setup.artifactDirectory, 'command.log'), invocation.command.join(' ') + '\n');
        save();
        console.log(`Feature ${plan.featureId}: ${setup.artifactDirectory}`);
        Object.assign(invocation, await runInvocation(invocation.command, setup.env, setup.artifactDirectory, child => { activeChild = child; }));
      } catch (error) { invocation.exitCode = 1; invocation.error = error.message; }
      finally {
        if (manifest.interrupted && stoppingChild) stopProcessGroup(stoppingChild, 'SIGKILL');
        stoppingChild = null;
        clearTimeout(stopTimer);
        try { await server?.stop(); }
        catch (error) { invocation.exitCode = 1; invocation.error = error.message; }
        const setup = await setupFor(index).catch(() => null);
        if (setup) {
          try { if (existsSync(setup.profile.providerDirectory)) cpSync(setup.profile.providerDirectory, join(setup.artifactDirectory, 'provider'), { recursive: true }); }
          catch (error) { invocation.exitCode = 1; invocation.error = error.message; }
          invocation.cleanup = cleanupPlaywrightProfile(setup.profile);
          writeFileSync(join(setup.artifactDirectory, 'cleanup.json'), JSON.stringify(invocation.cleanup, null, 2) + '\n');
        }
        invocation.finishedAt = new Date().toISOString(); save();
      }
    }
  } finally {
    // Servers warmed for invocations that never ran leave no profile or evidence behind.
    for (const index of await pool.close()) {
      const setup = await setupFor(index).catch(() => null);
      if (!setup) continue;
      cleanupPlaywrightProfile(setup.profile);
      rmSync(setup.artifactDirectory, { recursive: true, force: true });
    }
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); clearTimeout(stopTimer);
    manifest.finishedAt = new Date().toISOString();
    manifest.sourceChanged = JSON.stringify(provenance.sourceHashes) !== JSON.stringify(sourceHashes(root)); save();
  }
  const result = writeFeatureResults({ runDirectory, manifest, registry, repositoryRoot: root });
  console.log(`Feature evidence: ${join(runDirectory, 'summary.md')}`);
  return manifest.interrupted || manifest.sourceChanged || violations.length || result.problems.length
    || result.features.some(f => manifest.selection.featureIds.includes(f.id) && f.status !== 'verified') ? 1 : 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runFeatureE2e().then(code => { process.exitCode = code; }).catch(error => { console.error(error.stack ?? error.message); process.exitCode = 1; });
}
