// Presentation only: registry and violations are derived by the shared contract modules.
export function runFeatureCommand(args, { registry, violations, write = console.log }) {
  if (args.includes('--check')) {
    for (const violation of violations) write(violation.message);
    if (!violations.length) write('Feature-suite contract: no violations');
    return violations.length ? 1 : 0;
  }
  if (args.includes('--list')) {
    const features = registry.features.map(({ id, suitePath, isolation, profile, cases }) => ({
      id, suitePath, isolation, profile, cases: cases.flatMap(item => item.ids),
    }));
    if (args.includes('--json')) write(JSON.stringify(features, null, 2));
    else for (const feature of features) {
      write(`${feature.id}\t${feature.suitePath ?? 'excluded'}\t${feature.isolation}\t${feature.profile}\t${feature.cases.join(',')}`);
    }
    return 0;
  }
  write('Usage: test:e2e:features --check | --list [--json]');
  return 2;
}
