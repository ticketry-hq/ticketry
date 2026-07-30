import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import {
  createDmgServer,
  parseArguments,
  privateLanAddresses,
} from "./serve-dmg.mjs";

let baseUrl;
let server;

before(async () => {
  const directory = await mkdtemp(join(tmpdir(), "ticketry-dmg-server-"));
  const dmgPath = join(directory, "Ticketry test.dmg");
  await writeFile(dmgPath, "0123456789");
  const created = createDmgServer(dmgPath);
  server = created.server;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test("serves only the configured DMG path", async () => {
  const response = await fetch(`${baseUrl}/Ticketry%20test.dmg`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/x-apple-diskimage");
  assert.equal(await response.text(), "0123456789");

  const unrelated = await fetch(`${baseUrl}/package.json`);
  assert.equal(unrelated.status, 404);
});

test("supports HEAD and byte range download requests", async () => {
  const head = await fetch(`${baseUrl}/Ticketry%20test.dmg`, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");

  const partial = await fetch(`${baseUrl}/Ticketry%20test.dmg`, {
    headers: { Range: "bytes=2-5" },
  });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await partial.text(), "2345");
});

test("validates arguments and prefers common macOS LAN interfaces", () => {
  assert.deepEqual(parseArguments(["file.dmg", "--host", "192.168.1.2", "--port", "9000"]), {
    dmgPath: join(process.cwd(), "file.dmg"),
    host: "192.168.1.2",
    port: 9000,
  });
  assert.throws(() => parseArguments(["--port", "70000"]), /between 0 and 65535/);

  assert.deepEqual(
    privateLanAddresses({
      utun3: [{ address: "10.0.0.2", family: "IPv4", internal: false }],
      en0: [{ address: "192.168.1.2", family: "IPv4", internal: false }],
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    }),
    [
      { address: "192.168.1.2", name: "en0" },
      { address: "10.0.0.2", name: "utun3" },
    ],
  );
});
