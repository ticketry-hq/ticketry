import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve, basename } from 'node:path';
import { markdownLinks, sectionBodies } from './markdown.mjs';
import { entryEditions } from './entryEditions.mjs';
import ts from 'typescript';

const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
const properties = (node) => node && ts.isObjectLiteralExpression(node) ? node.properties : [];
const property = (node, name) => properties(node).find((item) => ts.isPropertyAssignment(item) && (item.name.getText().replace(/^['"]|['"]$/g, '') === name))?.initializer;
/** Name path of an identifier-rooted callee; any other receiver (a regular expression, call or `this`) yields [] so it never matches a test binding. */
const chain = (node) => {
  if (ts.isIdentifier(node)) return [node.text];
  const receiver = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? chain(node.expression) : [];
  if (!receiver.length) return [];
  return [...receiver, ts.isPropertyAccessExpression(node) ? node.name.text : literal(node.argumentExpression) ?? '<computed>'];
};

/** Read suite metadata without executing test code or guessing computed values. */
export function parseFeatureSuite(source, path) {
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = [], cases = [], forbiddenCalls = [], violations = [];
  const testNames = new Set(['test']);
  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
      for (const item of statement.importClause.namedBindings.elements) if ((item.propertyName?.text ?? item.name.text) === 'test') testNames.add(item.name.text);
    }
  }
  const report = (rule, item) => violations.push({ rule, path, message: `${path}: rule ${rule}: ${item}` });
  const declarationNodes = new Set();
  const findDeclarations = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'featureSuite') {
      declarationNodes.add(node);
      const id = literal(node.arguments[0]);
      const options = node.arguments.length >= 3 ? node.arguments[1] : null;
      const isolationValue = property(options, 'isolation'), profileValue = property(options, 'profile');
      const isolation = literal(isolationValue) ?? 'suite', profile = literal(profileValue) ?? 'onboarded';
      const topLevel = ts.isExpressionStatement(node.parent) && ts.isSourceFile(node.parent.parent);
      declarations.push({ id, isolation, profile, topLevel });
      if (!id) report(3, 'computed or missing feature identifier');
      if (options && !ts.isObjectLiteralExpression(options)) report(3, `computed options: ${options.getText(tree)}`);
      if ((isolationValue && !literal(isolationValue)) || !['suite', 'case'].includes(isolation)) report(3, `invalid or computed isolation: ${isolationValue?.getText(tree)}`);
      if ((profileValue && !literal(profileValue)) || !['onboarded', 'first-run'].includes(profile)) report(3, `invalid or computed profile: ${profileValue?.getText(tree)}`);
      for (const item of properties(options)) if (!(ts.isShorthandPropertyAssignment(item) && item.name.text === 'test') && (!ts.isPropertyAssignment(item) || ts.isComputedPropertyName(item.name))) report(3, `computed suite option: ${item.getText(tree)}`);
      const extendedTest = property(options, 'test');
      if (extendedTest && ts.isIdentifier(extendedTest)) testNames.add(extendedTest.text);
    }
    ts.forEachChild(node, findDeclarations);
  };
  findDeclarations(tree);
  const detailTags = (details) => {
    const tag = property(details, 'tag');
    return (tag && ts.isArrayLiteralExpression(tag) ? tag.elements : [tag]).flatMap(value => literal(value)?.match(/@[^\s]+/g) ?? []);
  };
  const visit = (node, insideDeclaration = false, titlePath = [], inheritedTags = [], grepTitlePath = []) => {
    const inside = insideDeclaration || declarationNodes.has(node);
    if (declarationNodes.has(node)) {
      const id = literal(node.arguments[0]);
      if (id) { titlePath = [...titlePath, id]; inheritedTags = [...inheritedTags, `@feature-${id}`]; grepTitlePath = [...grepTitlePath, id, `@feature-${id}`]; }
    }
    if (ts.isCallExpression(node)) {
      const names = chain(node.expression);
      const isTest = testNames.has(names[0]);
      if (isTest && names[1] === 'describe') {
        const title = literal(node.arguments[0]);
        if (title !== null) titlePath = [...titlePath, title];
        inheritedTags = [...inheritedTags, ...detailTags(node.arguments[1])];
        grepTitlePath = [...grepTitlePath, ...(title ? [title] : []), ...detailTags(node.arguments[1])];
      }
      if (isTest && names.some((name) => ['skip', 'fixme', 'only'].includes(name))) forbiddenCalls.push(node.expression.getText(tree));
      const isCase = isTest && (names.length === 1 || (names.length === 2 && ['skip', 'fixme', 'only'].includes(names[1]) && node.arguments.length >= 2 && (ts.isArrowFunction(node.arguments.at(-1)) || ts.isFunctionExpression(node.arguments.at(-1)))));
      if (isCase) {
        const title = literal(node.arguments[0]);
        const details = node.arguments[1];
        const tagNode = property(details, 'tag');
        let literalTags = true;
        const tags = [];
        if (title) tags.push(...(title.match(/@case-[^\s]+/g) ?? []));
        if (tagNode) {
          const nodes = ts.isArrayLiteralExpression(tagNode) ? tagNode.elements : [tagNode];
          for (const value of nodes) { const tag = literal(value); if (tag === null) literalTags = false; else tags.push(...(tag.match(/@case-[^\s]+/g) ?? [])); }
        }
        if (details && !ts.isArrowFunction(details) && !ts.isFunctionExpression(details) && !ts.isObjectLiteralExpression(details)) literalTags = false;
        for (const item of properties(details)) if (!ts.isPropertyAssignment(item) || ts.isComputedPropertyName(item.name)) literalTags = false;
        const ids = tags.map((tag) => tag.slice(6));
        const allTags = [...new Set([...inheritedTags, ...detailTags(details)])];
        const editionTags = [...new Set([...(title?.match(/@edition-[^\s]+/g) ?? []), ...allTags.filter((tag) => tag.startsWith('@edition-'))])];
        cases.push({ title, tags, ids, editionTags, titlePath: [...titlePath, ...(title === null ? [] : [title])], allTags, grepTitlePath: [...grepTitlePath, ...(title === null ? [] : [title]), ...detailTags(details)], literalTitle: title !== null, literalTags, insideDeclaration: inside });
        if (title === null) report(4, `computed case title: ${node.arguments[0]?.getText(tree) ?? '<missing>'}`);
        if (!literalTags) report(4, `computed case tags for ${title ?? '<computed title>'}`);
      }
    }
    ts.forEachChild(node, (child) => visit(child, inside, titlePath, inheritedTags, grepTitlePath));
  };
  visit(tree);
  return { path, declarations, cases, forbiddenCalls, violations };
}

const rows = (body) => body.split('\n').filter((line) => line.trim().startsWith('|')).map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim().replace(/^`|`$/g, ''))).filter((row) => !row.every((cell) => /^:?-+:?$/.test(cell)));
const files = (directory) => !existsSync(directory) ? [] : readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]);

/** Derive the two-sided registry from map prose and TypeScript suite sources. */
export function deriveFeatureRegistry(mapDirectory, e2eDirectory, repositoryRoot) {
  const repoPath = (path) => relative(repositoryRoot, path).replace(/\\/g, '/');
  const indexPath = resolve(mapDirectory, 'README.md');
  const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  const browserSpecs = files(e2eDirectory).filter((path) => path.endsWith('.spec.ts')).map(repoPath);
  const suites = browserSpecs.filter((path) => path.startsWith(`${repoPath(resolve(e2eDirectory, 'features'))}/`)).map((path) => parseFeatureSuite(readFileSync(resolve(repositoryRoot, path), 'utf8'), path));
  const allEntries = files(mapDirectory).filter((path) => path.endsWith('.md') && basename(path) !== 'README.md');
  const links = markdownLinks(index).map((link) => resolve(mapDirectory, link.split('#')[0]));
  allEntries.sort((a, b) => { const rank = (path) => links.indexOf(path) < 0 ? Infinity : links.indexOf(path); return rank(a) - rank(b) || a.localeCompare(b); });
  const features = allEntries.map((entryPath) => {
    const source = readFileSync(entryPath, 'utf8'), bodies = sectionBodies(source);
    const suiteLines = [...source.matchAll(/^Suite:[ \t]*([^\n]*)$/gm)].map((match) => match[1].trim().replace(/^`|`$/g, ''));
    const line = suiteLines[0] ?? '';
    const excluded = line.match(/^excluded \((manual|desktop-only)\):\s*(.*)$/);
    const suite = !line ? null : excluded ? { path: null, exclusion: excluded[1], reason: excluded[2].trim() } : { path: line, exclusion: null, reason: null };
    const table = rows(bodies.get('End-to-end suite') ?? '');
    const coverage = { columns: table[0] ?? [], rows: table.slice(1).map(([id, ...cells]) => ({ id, cells })) };
    const subFeatures = [...(bodies.get('Sub-features') ?? '').matchAll(/^\s*[-*+]\s+(?:`([a-z0-9]+(?:-[a-z0-9]+)*)`|([a-z0-9]+(?:-[a-z0-9]+)*))(?=\s|:)/gm)].map((match) => match[1] ?? match[2]);
    const coreSubFeatures = [...(bodies.get('Sub-features') ?? '').matchAll(/^\s*[-*+]\s+(?:`([a-z0-9]+(?:-[a-z0-9]+)*)`|([a-z0-9]+(?:-[a-z0-9]+)*))\s+\(core\)/gm)].map((match) => match[1] ?? match[2]);
    const { editions, problems: editionProblems } = entryEditions(source);
    const parsed = suites.find((item) => item.path === suite?.path);
    const declaration = parsed?.declarations[0];
    const cellCitations = coverage.rows.flatMap((row) => row.cells.map((cell, index) => ({ subFeature: row.id, dimension: coverage.columns[index + 1], ids: /^@case-[a-z0-9]+(?:-[a-z0-9]+)*(?:[\s,]+@case-[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(cell) ? [...cell.matchAll(/@case-([a-z0-9]+(?:-[a-z0-9]+)*)/g)].map((match) => match[1]) : [] })));
    return { id: basename(entryPath, '.md'), path: repoPath(entryPath), editions, editionProblems, coreSubFeatures, suiteLines, suite, suitePath: suite?.path ?? null, subFeatures, coverage, isolation: declaration?.isolation ?? 'suite', profile: declaration?.profile ?? 'onboarded', cases: parsed?.cases ?? [], cellCitations };
  });
  const nonFeatureSpecs = rows(sectionBodies(index).get('Non-feature browser specs') ?? '').slice(1).map(([path, reason = '']) => ({ path, reason }));
  return { features, suites, nonFeatureSpecs, browserSpecs };
}
