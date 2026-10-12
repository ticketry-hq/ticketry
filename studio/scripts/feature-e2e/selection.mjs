const commaIds = (value, kind) => value.split(',').map(value => {
  const id = value.trim();
  if (!id) throw new Error(`Empty ${kind} identifier`);
  return id;
});

const inEdition = (feature, edition) => !feature.editions || feature.editions.includes(edition);
const coreOnly = (item) => (item.editionTags ?? []).includes('@edition-core');
const caseInEdition = (item, edition) => edition === 'core' || !coreOnly(item);

/**
 * Select from the derived registry; original feature records remain
 * authoritative. Features whose `Editions:` exclude the built edition, and
 * `@edition-core` cases outside core, are reported in `skippedByEdition`.
 */
export function selectFeatures(registry, args = [], { edition = 'pocock' } = {}) {
  const featureIds = [], caseIds = [], greps = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--') && !['--feature', '--case', '--grep'].includes(arg)) throw new Error(`Unknown option: ${arg}`);
    let value = arg;
    if (arg.startsWith('--')) {
      value = args[++index];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    }
    if (arg === '--grep') {
      if (!value) throw new Error('Empty grep');
      try { greps.push(new RegExp(value)); } catch (error) { throw new Error(`Invalid grep: ${error.message}`); }
    } else {
      const target = arg === '--case' ? caseIds : featureIds;
      target.push(...commaIds(value, arg === '--case' ? 'case' : 'feature'));
    }
  }
  const seenFeatures = new Set(), seenCases = new Set();
  for (const feature of registry.features) {
    if (seenFeatures.has(feature.id)) throw new Error(`Duplicate feature identifier: ${feature.id}`);
    seenFeatures.add(feature.id);
    for (const item of feature.cases) for (const id of item.ids) {
      if (seenCases.has(id)) throw new Error(`Duplicate case identifier: ${id}`);
      seenCases.add(id);
    }
  }
  for (const id of featureIds) {
    const feature = registry.features.find(feature => feature.id === id);
    if (!feature) throw new Error(`Unknown feature: ${id}`);
    if (feature.suite?.exclusion) throw new Error(`Excluded feature: ${id} (${feature.suite.reason ?? feature.suite.exclusion})`);
  }
  for (const id of caseIds) {
    if (!registry.features.some(feature => feature.cases.some(item => item.ids.includes(id)))) throw new Error(`Unknown case: ${id}`);
  }
  const rerun = (editions) => `rerun with TICKETRY_EDITION=${editions.find(value => value !== edition) ?? editions[0]}`;
  for (const id of featureIds) {
    const feature = registry.features.find(feature => feature.id === id);
    if (!inEdition(feature, edition)) throw new Error(`Feature ${id} is not in the ${edition} edition (Editions: ${feature.editions.join(', ')}); ${rerun(feature.editions)}`);
  }
  for (const feature of registry.features) for (const item of feature.cases) {
    const id = item.ids.find(value => caseIds.includes(value));
    if (!id) continue;
    if (!inEdition(feature, edition)) throw new Error(`Case ${id} belongs to feature ${feature.id}, which is not in the ${edition} edition (Editions: ${feature.editions.join(', ')}); ${rerun(feature.editions)}`);
    if (!caseInEdition(item, edition)) throw new Error(`Case ${id} is tagged @edition-core and does not run in the ${edition} edition; rerun with TICKETRY_EDITION=core`);
  }
  const requested = registry.features.filter(feature => !feature.suite?.exclusion && (!featureIds.length || featureIds.includes(feature.id)));
  const skippedByEdition = {
    features: requested.filter(feature => !inEdition(feature, edition)).map(feature => feature.id),
    cases: requested.filter(feature => inEdition(feature, edition)).flatMap(feature => feature.cases.filter(item => !caseInEdition(item, edition)).flatMap(item => item.ids)),
  };
  let features = requested.filter(feature => inEdition(feature, edition));
  for (const feature of features) if (!feature.suitePath) throw new Error(`Missing suite for feature: ${feature.id}`);
  for (const feature of features) {
    const invalid = feature.cases.filter(item => item.ids.length !== 1).map(item =>
      `case ${item.title === null ? '<computed title>' : `'${item.title}'`} requires exactly one @case- tag; found ${item.tags.join(', ') || 'none'}`);
    if (invalid.length) throw new Error(`Invalid case metadata in ${feature.suitePath}: ${invalid.join('; ')}`);
  }
  const identities = new Map(features.flatMap(feature => feature.cases.map(item => [item.ids[0],
    `${feature.profile === 'first-run' ? 'first-run' : 'chromium'} ${feature.suitePath.replace(/^studio\/e2e\//, '')} ${(item.grepTitlePath ?? [feature.id, `@feature-${feature.id}`, item.title, ...item.tags]).join(' ')}`,
  ])));
  const cases = features.flatMap(feature => feature.cases.filter(item => caseInEdition(item, edition)).map(item => ({
    id: item.ids[0], tag: item.tags[0], title: item.title, featureId: feature.id,
    file: feature.suitePath, project: feature.profile === 'first-run' ? 'first-run' : 'chromium',
  }))).filter(item => !caseIds.length || caseIds.includes(item.id)).filter(item => greps.every(grep => grep.test(identities.get(item.id))));
  if (!cases.length) throw new Error(`Empty selection: no feature cases match in the ${edition} edition`);
  for (const id of featureIds) {
    if (!cases.some(item => item.featureId === id)) throw new Error(`No matching cases for selected feature: ${id}`);
  }
  features = features.filter(feature => cases.some(item => item.featureId === feature.id));
  return { features, cases, complete: !args.length, filtered: !!args.length, edition, skippedByEdition };
}

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Each plan entry owns exactly one disposable profile and Playwright process. */
export function planInvocations(selection) {
  return selection.features.flatMap(feature => {
    const cases = selection.cases.filter(item => item.featureId === feature.id);
    const groups = feature.isolation === 'case' ? cases.map(item => [item]) : [cases];
    return groups.map(group => ({
      id: feature.isolation === 'case' ? `${feature.id}--${group[0].id}` : feature.id,
      featureId: feature.id, caseIds: group.map(item => item.id), file: feature.suitePath,
      project: group[0].project,
      grep: `(?:^|\\s)(?:${group.map(item => escapeRegex(item.tag)).join('|')})(?=\\s|$)`,
    }));
  });
}
