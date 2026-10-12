import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const checker = fileURLToPath(new URL("./check_html_lld.py", import.meta.url));
const template = fs.readFileSync(new URL("../assets/lld-template.html", import.meta.url), "utf8");

const filledReuseRows = `<tbody>
            <tr data-reuse="reused"><th scope="row">Reused</th><td>Dark drafting palette and file-change workspace</td><td><code>.agents/skills/lld-html-authoring/assets/lld-template.html</code></td><td>The template already owns the LLD layout.</td></tr>
            <tr data-reuse="generated"><th scope="row">Generated or configured</th><td colspan="3">none — no generator or configuration applies to an HTML checker.</td></tr>
            <tr data-reuse="new"><th scope="row">New</th><td>Reuse record validation</td><td><code>.agents/skills/lld-html-authoring/scripts/check_html_lld.py</code></td><td>No existing check reads LLD sections.</td></tr>
          </tbody>`;

// What an author does to the template: replace every sample and turn the template marker off.
function fillTemplate(html) {
  return html
    .replace('data-template="true"', 'data-template="false"')
    .replaceAll("Replace this example with", "Checker:")
    .replaceAll("src/example/", "src/checker/")
    .replaceAll("T000", "T2767")
    .replace(/(<section[^>]*id="reuse-record"[\s\S]*?)<tbody>[\s\S]*?<\/tbody>/, `$1${filledReuseRows}`);
}

function runChecker(html) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lld-checker-"));
  const file = path.join(directory, "LLD.html");
  fs.writeFileSync(file, html);
  return spawnSync("python3", [checker, file], { encoding: "utf8" });
}

function assertFails(result, pattern) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, pattern);
}

const valid = fillTemplate(template);

test("a filled-in template passes every check, including the reuse record", () => {
  const result = runChecker(valid);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /HTML LLD valid/);
});

test("an LLD without the reuse record section fails", () => {
  const html = valid.replace(/<section[^>]*id="reuse-record"[\s\S]*?<\/section>/, "");
  assertFails(runChecker(html), /error: .*reuse record.*id="reuse-record"/i);
});

test("an LLD whose reuse record keeps template sample text fails", () => {
  const sampleRow = template.match(/<tr data-reuse="reused">[\s\S]*?<\/tr>/)[0];
  const html = valid.replace(/<tr data-reuse="reused">[\s\S]*?<\/tr>/, sampleRow);
  assertFails(runChecker(html), /error: reuse record .*sample/i);
});

test("a category with neither a row nor an explicit none reason fails", () => {
  const html = valid.replace(/<tr data-reuse="generated">[\s\S]*?<\/tr>/, "");
  assertFails(runChecker(html), /error: reuse record .*generated/i);
});

test("a none answer without a reason fails", () => {
  const html = valid.replace(/none — no generator[^<]*/, "none — ");
  assertFails(runChecker(html), /error: reuse record .*generated/i);
});

test("a Reused row without a repository-relative citation fails", () => {
  const html = valid.replace(
    /(<tr data-reuse="reused">[\s\S]*?)<code>[^<]*<\/code>/,
    "$1the existing template",
  );
  assertFails(runChecker(html), /error: reuse record .*reused.*citation/i);
});

test("a Generated row citing an absolute path or URL fails", () => {
  const html = valid.replace(
    /<tr data-reuse="generated">[\s\S]*?<\/tr>/,
    '<tr data-reuse="generated"><th scope="row">Generated or configured</th><td>Schema</td><td><code>https://example.com/schema.graphql</code></td><td>Generated.</td></tr>',
  );
  assertFails(runChecker(html), /error: reuse record .*generated.*citation/i);
});

test("a row with empty cells fails", () => {
  const html = valid.replace(
    /<tr data-reuse="new">[\s\S]*?<\/tr>/,
    '<tr data-reuse="new"><th>New</th><td></td><td></td><td></td></tr>',
  );
  assertFails(runChecker(html), /error: reuse record .*new/i);
});

test("a coded none answer without a reason fails", () => {
  const html = valid.replace(
    /<tr data-reuse="new">[\s\S]*?<\/tr>/,
    '<tr data-reuse="new"><th scope="row">New</th><td colspan="3"><code>none</code></td></tr>',
  );
  assertFails(runChecker(html), /error: reuse record .*new.*none without a reason/i);
});

test("a coded none answer with a reason passes without a citation", () => {
  const html = valid.replace(
    /<tr data-reuse="generated">[\s\S]*?<\/tr>/,
    '<tr data-reuse="generated"><th scope="row">Generated or configured</th><td colspan="3"><code>none — no applicable generator</code></td></tr>',
  );
  const result = runChecker(html);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /HTML LLD valid/);
});
