import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { analyzeFeatureResults } from './results.mjs';

const safe = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const slash = (value) => value.replaceAll('\\', '/');
function visualArtifacts(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? visualArtifacts(path) : /\.png$|trace\.zip$/.test(entry.name) ? [{ name: entry.name.endsWith('.png') ? `screenshot: ${entry.name}` : 'trace', path }] : [];
  });
}
function renderSummary({ result, manifest, runDirectory }) {
  const link = (path) => slash(relative(runDirectory, path));
  const lines = ['# Feature browser results', '', `Run: \`${safe(manifest.runId)}\`. Revision: \`${safe(manifest.revision)}\`${manifest.dirty ? ' with local changes' : ''}.`, '', `Started: ${safe(manifest.startedAt)}. Finished: ${safe(manifest.finishedAt)}.`, '', `Edition: **${safe(manifest.edition?.edition ?? 'pocock')}** (${safe(manifest.edition?.source ?? 'default')}).`, '', `Complete map: **${result.verified ? 'verified' : 'not verified'}**. Selected features: **${result.successful ? 'verified' : 'not verified'}**.`, '', `Playwright totals: ${result.totals.passed} passed, ${result.totals.failed} failed, ${result.totals.skipped} skipped, ${result.totals.flaky} flaky (including onboarding).`, '', '[Manifest](manifest.json) · [Registry snapshot](registry.json) · [Machine results](results.json)', '', '| Feature | Verified cases | Outcome |', '| --- | --- | --- |'];
  for (const feature of result.features) lines.push(`| ${safe(feature.id)} | ${feature.passed}/${feature.required} | ${feature.status} |`);
  const gaps = [];
  for (const feature of result.features) {
    if (feature.suite?.exclusion) gaps.push(`${feature.id}: excluded (${feature.suite.exclusion}): ${feature.suite.reason}`);
    if (!feature.coverage?.columns.length) continue;
    lines.push('', `## ${safe(feature.id)} coverage`, '', `| ${feature.coverage.columns.map(safe).join(' | ')} |`, `| ${feature.coverage.columns.map(() => '---').join(' | ')} |`);
    for (const row of feature.coverage.rows) {
      const cells = row.cells.map((cell, index) => {
        if (/^(desktop-only|manual):/.test(cell)) gaps.push(`${feature.id} / ${row.id} / ${feature.coverage.columns[index + 1]}: ${cell}`);
        return safe(cell).replace(/@case-([a-z0-9-]+)/g, (match, id) => `${match} **${result.cases.find((item) => item.featureId === feature.id && item.id === id)?.status ?? 'unrun'}**`);
      });
      lines.push(`| ${safe(row.id)} | ${cells.join(' | ')} |`);
    }
  }
  lines.push('', '## Case evidence', '', '| Feature / Case | Outcome | Evidence |', '| --- | --- | --- |');
  for (const row of result.cases) {
    const evidence = [];
    if (row.invocation) {
      const directory = row.invocation.artifactDirectory;
      for (const [name, file] of [['JSON', 'results.json'], ['HTML', 'html/index.html'], ['command', 'command.json'], ['stdout', 'stdout.log'], ['stderr', 'stderr.log'], ['cleanup', 'cleanup.json']]) {
        const path = resolve(directory, file);
        if (existsSync(path)) evidence.push(`[${name}](${link(path)})`);
      }
      const attachments = [...row.attachments, ...visualArtifacts(directory)];
      const seen = new Set();
      for (const attachment of attachments) {
        if (!attachment.path) continue;
        const path = resolve(directory, attachment.path);
        if (existsSync(path) && !seen.has(path)) { seen.add(path); evidence.push(`[${safe(attachment.name ?? 'artifact')}](${link(path)})`); }
      }
      const providers = resolve(directory, 'provider');
      if (existsSync(providers)) evidence.push(`[provider fixture output](${link(providers)})`);
    }
    lines.push(`| ${safe(row.featureId)} / \`${safe(row.id)}\` | ${row.status} | ${evidence.join(' · ')} |`);
  }
  const skipped = manifest.selection.skippedByEdition ?? { features: [], cases: [] };
  if (skipped.features.length || skipped.cases.length) {
    const feature = (id) => result.features.find((item) => item.id === id);
    lines.push('', '## Skipped by edition', '',
      ...skipped.features.map((id) => `- Feature \`${safe(id)}\` (Editions: ${safe(feature(id)?.editions?.join(', ') ?? 'unknown')})`),
      ...skipped.cases.map((id) => `- Case \`${safe(result.cases.find((row) => row.id === id)?.featureId)}\` / \`${safe(id)}\` (@edition-core)`));
  }
  if (result.problems.length) lines.push('', '## Run problems', '', ...result.problems.map((problem) => `- ${safe(problem)}`));
  lines.push('', '## Not verified by the browser', '', ...(gaps.length ? gaps.map((gap) => `- ${safe(gap)}`) : ['No explicit manual, desktop-only or excluded entries.']), '', 'Filtered selections never verify the complete map. Browser evidence does not establish native rendering or paid-provider behavior.');
  return `${lines.join('\n')}\n`;
}

export function writeFeatureResults({ runDirectory, manifest, registry, repositoryRoot }) {
  const evidenceRoot = resolve(repositoryRoot, '.ticketry-dev/e2e-results');
  const relativeRun = relative(evidenceRoot, resolve(runDirectory));
  if (!relativeRun || relativeRun.startsWith('..') || relativeRun.startsWith('/')) throw new Error('Feature evidence must live under .ticketry-dev/e2e-results/<run-id>');
  const reports = {};
  for (const invocation of manifest.invocations) {
    try { reports[invocation.id] = JSON.parse(readFileSync(resolve(invocation.artifactDirectory, 'results.json'), 'utf8')); }
    catch (error) { reports[invocation.id] = { error: error.message }; }
  }
  const result = analyzeFeatureResults({ manifest, registry, reports });
  mkdirSync(runDirectory, { recursive: true });
  writeFileSync(resolve(runDirectory, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(resolve(runDirectory, 'summary.md'), renderSummary({ result, manifest, runDirectory }));
  writeFileSync(resolve(evidenceRoot, 'latest.md'), `# Latest feature browser run\n\nRun: \`${safe(manifest.runId)}\`.\n\n[Run summary](${slash(relative(evidenceRoot, resolve(runDirectory, 'summary.md')))}) · [Manifest](${slash(relative(evidenceRoot, resolve(runDirectory, 'manifest.json')))})\n`);
  return result;
}
