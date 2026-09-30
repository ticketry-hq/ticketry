import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateTypedDocuments } from "./typed-document-generation.mjs";

test("authored operations generate standard typed documents without changing their source", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ticketry-typed-documents-"));
  const schemaPath = join(scratch, "schema.graphql");
  const sourcePath = join(scratch, "probe.graphql");
  const outputPath = join(scratch, "documents.ts");
  const source = "query Probe { probe { id name } }\n";

  try {
    await writeFile(
      schemaPath,
      "type Probe { id: ID!, name: String! }\ntype Query { probe: Probe! }\n",
      "utf8",
    );
    await writeFile(sourcePath, source, "utf8");

    await generateTypedDocuments({ schemaPath, sourcePath, outputPath });

    const generated = await readFile(outputPath, "utf8");
    assert.match(
      generated,
      /TypedDocumentNode as DocumentNode.*@graphql-typed-document-node\/core/,
    );
    assert.match(generated, /DocumentNode<ProbeQuery, ProbeQueryVariables>/);
    assert.match(generated, /["']kind["']:\s*["']Field["']/);
    assert.match(generated, /["']value["']:\s*["']__typename["']/);
    assert.doesNotMatch(generated, /source:\s*["']/);
    assert.equal(await readFile(sourcePath, "utf8"), source);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("generation rejects a document that has drifted from the schema", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ticketry-typed-documents-"));
  const schemaPath = join(scratch, "schema.graphql");
  const sourcePath = join(scratch, "probe.graphql");
  const outputPath = join(scratch, "documents.ts");

  try {
    await writeFile(
      schemaPath,
      "type Probe { id: ID! }\ntype Query { probe: Probe! }\n",
      "utf8",
    );
    await writeFile(sourcePath, "query Probe { probe { missing } }\n", "utf8");

    await assert.rejects(
      generateTypedDocuments({ schemaPath, sourcePath, outputPath }),
      /Cannot query field "missing" on type "Probe"/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("generated operation types follow schema nullability", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "ticketry-typed-documents-"));
  const schemaPath = join(scratch, "schema.graphql");
  const sourcePath = join(scratch, "probe.graphql");
  const outputPath = join(scratch, "documents.ts");

  try {
    await writeFile(
      schemaPath,
      "type Probe { name: String }\ntype Query { probe: Probe }\n",
      "utf8",
    );
    await writeFile(sourcePath, "query Probe { probe { name } }\n", "utf8");

    await generateTypedDocuments({ schemaPath, sourcePath, outputPath });

    const generated = await readFile(outputPath, "utf8");
    assert.match(
      generated,
      /ProbeQuery = \{ probe: \{ name: string \| null \} \| null \}/,
    );
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
