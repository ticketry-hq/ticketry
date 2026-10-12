import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { linkPath, markdownLinks, sectionBodies, validStructure } from "./markdown";
import { citedPaths, codeAreas, filesUnder, tableRows } from "./repository";
import { entryEditions } from "./entryEditions.mjs";

export interface FeatureMapViolation { code: string; path: string; message: string }

export function checkFeatureMap(mapDirectory: string, repositoryRoot: string): FeatureMapViolation[] {
  const violations: FeatureMapViolation[] = [];
  const identifiers = new Set<string>();
  const mappedAreas = new Set<string>();
  const citedSpecs = new Set<string>();
  const paths = (body: string, source = body) => citedPaths(body, mapDirectory, repositoryRoot, source);
  const indexPath = resolve(mapDirectory, "README.md");
  if (!existsSync(indexPath)) return [{ code: "index", path: "README.md", message: "Missing map index" }];
  const index = readFileSync(indexPath, "utf8");
  const files = readdirSync(mapDirectory).filter((file) => file.endsWith(".md") && file !== "README.md");
  const links = markdownLinks(index).map((link) => link.split("#")[0].replace(/^\.\//, ""));
  for (const file of ["README.md", ...files]) {
    for (const link of markdownLinks(readFileSync(resolve(mapDirectory, file), "utf8"))) {
      const path = linkPath(link);
      if (path === null || (path && !existsSync(resolve(mapDirectory, path)))) violations.push({ code: "link", path: file, message: `Broken relative link: ${link}` });
    }
  }
  for (const file of files) {
    const source = readFileSync(resolve(mapDirectory, file), "utf8");
    const suitePaths = [...(sectionBodies(source).get("End-to-end suite") ?? "").matchAll(/^Suite:[ \t]*(studio\/e2e\/features\/[^\s`]+\.spec\.ts)[ \t]*$/gm)]
      .map((match) => match[1]);
    for (const path of [...paths(source), ...suitePaths].filter((path) => /\.spec\.[cm]?[jt]sx?$/.test(path))) {
      citedSpecs.add(path);
      if (!existsSync(resolve(repositoryRoot, path))) violations.push({ code: "browser", path, message: `Missing browser spec cited in ${file}` });
    }
    // Dependency file pointers do not claim coverage of their whole feature.
    for (const path of paths(sectionBodies(source).get("Relevant code") ?? "", source)) mappedAreas.add(path);
    for (const section of ["Relevant code", "Verifying it"]) {
      for (const path of paths(sectionBodies(source).get(section) ?? "", source)) {
        if (!existsSync(resolve(repositoryRoot, path))) violations.push({ code: "path", path, message: `Missing repository path cited in ${file}` });
      }
    }
    if (!validStructure(source)) {
      violations.push({ code: "structure", path: file, message: "Expected H1, valid Surfaces, and seven nonempty sections in order" });
    }
    for (const problem of entryEditions(source).problems) violations.push({ code: "editions", path: file, message: problem });
    const bullets = (sectionBodies(source).get("Sub-features") ?? "").split("\n").filter((line) => /^\s*[-*+] /.test(line));
    if (bullets.length === 0) violations.push({ code: "identifier", path: file, message: "Sub-features must contain identifier bullets" });
    for (const bullet of bullets) {
      const id = bullet.match(/^\s*[-*+]\s+(?:`([a-z0-9]+(?:-[a-z0-9]+)*)`|([a-z0-9]+(?:-[a-z0-9]+)*))(?=\s|:)/)?.slice(1).find(Boolean);
      if (!id || identifiers.has(id)) violations.push({ code: "identifier", path: file, message: `Invalid or duplicate identifier: ${id ?? bullet}` });
      if (id) identifiers.add(id);
    }
    if (links.filter((link) => link === file).length !== 1) {
      violations.push({ code: "index", path: file, message: "Entry must appear exactly once in index" });
    }
  }
  for (const link of links.filter((link) => !link.includes("/") && link.endsWith(".md"))) {
    if (!files.includes(link)) violations.push({ code: "index", path: link, message: "Index entry does not exist" });
  }
  const excluded = tableRows(sectionBodies(index).get("Exclusions") ?? "");
  for (const spec of filesUnder(resolve(repositoryRoot, "studio/e2e")).filter((path) => /\.spec\.[cm]?[jt]sx?$/.test(path))) {
    const path = relative(repositoryRoot, spec).replace(/\\/g, "/");
    if (!citedSpecs.has(path)) violations.push({ code: "browser", path, message: "Browser spec is not referenced" });
  }
  for (const area of codeAreas(repositoryRoot)) {
    if (!mappedAreas.has(area) && !excluded.some(([path, reason]) => path === area && !!reason)) {
      violations.push({ code: "coverage", path: area, message: "Code area is neither mapped nor excluded with a reason" });
    }
  }
  return violations;
}
