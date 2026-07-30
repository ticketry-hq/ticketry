import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const catalogRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(catalogRoot, '..');
const outputPath = resolve(catalogRoot, 'components', 'language.generated.json');

const contexts = [
  {
    id: 'work-management',
    name: 'Work Management',
    source: 'backend/worktracker/CONTEXT.md',
  },
  {
    id: 'agent-execution',
    name: 'Agent Execution',
    source: 'backend/apps/execution/CONTEXT.md',
  },
  {
    id: 'agent-sdlc',
    name: 'Agent SDLC',
    source: 'backend/apps/terminals/agents/CONTEXT.md',
  },
  {
    id: 'studio-experience',
    name: 'Studio Experience',
    source: 'studio/CONTEXT.md',
  },
  {
    id: 'desktop-runtime',
    name: 'Desktop Runtime',
    source: 'studio/src-tauri/CONTEXT.md',
  },
];

function parseTerms(markdown) {
  const lines = markdown.split(/\r?\n/);
  const terms = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\*\*(.+?)\*\*(?:\s*\((.+?)\))?:\s*$/);
    if (!match) continue;

    const name = match[1].trim();
    const qualifier = match[2]?.replace(/`/g, '').trim() ?? null;
    const definition = [];
    let avoid = '';
    let cursor = index + 1;

    while (cursor < lines.length) {
      const line = lines[cursor];
      if (/^\*\*(.+?)\*\*/.test(line) || /^#{2,3}\s/.test(line)) break;
      if (line.startsWith('_Avoid_:')) {
        avoid = line.slice('_Avoid_:'.length).trim();
        cursor += 1;
        while (cursor < lines.length && lines[cursor].trim() && !/^\*\*|^#{2,3}\s/.test(lines[cursor])) {
          avoid = `${avoid} ${lines[cursor].trim()}`.trim();
          cursor += 1;
        }
        break;
      }
      if (line.trim()) definition.push(line.trim());
      cursor += 1;
    }

    terms.push({
      id: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
      name,
      qualifier,
      definition: definition.join(' '),
      avoid,
    });
    index = cursor - 1;
  }

  return terms;
}

const groups = contexts.map((context) => {
  const markdown = readFileSync(resolve(repositoryRoot, context.source), 'utf8');
  return {
    ...context,
    terms: parseTerms(markdown),
  };
});

mkdirSync(resolve(catalogRoot, 'components'), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(groups, null, 2)}\n`);

const termCount = groups.reduce((sum, group) => sum + group.terms.length, 0);
console.log(`Synced ${termCount} ubiquitous-language terms from ${groups.length} contexts.`);
