import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const decisionPath = new URL(
  "../docs/plans/CODING-1394-renderer-decision.md",
  import.meta.url,
);

test("CODING-1394 records one renderer decision without hiding native UX costs", async () => {
  const decision = await readFile(decisionPath, "utf8");

  assert.match(decision, /Decision: keep `ghostty-wasm` as the default\./);
  assert.match(decision, /consumed activation click/i);
  assert.match(decision, /visible surface/i);
  assert.match(decision, /cannot extend through tmux scrollback/i);
  assert.match(decision, /AppKit-to-Rust tmux scroll path/i);
  assert.match(decision, /mouse-mode\s+attempt.+removed/is);
  assert.match(
    decision,
    /packaged,\s+same-condition native-versus-WASM campaign was not completed/i,
  );
  assert.match(decision, /1 \| 0\.7% \| 134\.86 MiB/);
  assert.match(decision, /20 \| 1\.1% \| 168\.42 MiB/);
  assert.match(decision, /applies the native-derived limit to WASM and xterm/i);
  assert.match(decision, /more than 20 acknowledgements can temporarily mount more/i);
  assert.doesNotMatch(decision, /Propose native-underlay promotion/);
});
