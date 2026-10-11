import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { linkPath, markdownLinks } from "./markdown";

export function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function codeAreas(root: string): string[] {
  const features = join(root, "studio/src/features");
  const domains = existsSync(features) ? readdirSync(features, { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => `studio/src/features/${entry.name}`) : [];
  return [...domains, ...["onboarding", "navigation", "shell", "startup", "modal"].map((area) => `studio/src/app/${area}`)]
    .filter((area) => filesUnder(join(root, area)).length > 0);
}

export function citedPaths(body: string, mapDirectory?: string, repositoryRoot?: string, referenceSource = body): string[] {
  const inline = [...body.matchAll(/`([^`\n]+)`/g)].map((match) => match[1])
    .filter((value) => /^(?:studio|docs|scripts|spec|\.agents|\.claude|\.codex|\.cursor)\//.test(value) || /^[\w.-]+\.(?:md|json|ts|tsx|mjs|sh)$/.test(value))
    .map((value) => value.replace(/\/$/, "").replace(/:\d+(?:-\d+)?$/, ""));
  const links = mapDirectory && repositoryRoot ? markdownLinks(body, referenceSource)
    .map(linkPath).filter((path): path is string => !!path)
    .map((path) => relative(repositoryRoot, resolve(mapDirectory, path)).replace(/\\/g, "/")) : [];
  return [...inline, ...links];
}

export function tableRows(body: string): string[][] {
  return body.split("\n").filter((line) => line.trim().startsWith("|"))
    .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim().replace(/^`|`$/g, "")))
    .filter((cells) => /^(?:studio|docs|scripts|\.agents|\.claude|\.codex|\.cursor)\//.test(cells[0] ?? ""));
}
