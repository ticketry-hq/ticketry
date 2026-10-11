import { createInterface } from "node:readline";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Codex owns this external protocol; no Ticketry state is fabricated here.
export async function runProviderTitles() {
  const names = new Map();
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line);
    if (message.id === undefined) continue;
    let result = {};
    if (message.method === "thread/name/set") names.set(message.params.threadId, message.params.name);
    if (message.method === "thread/read") {
      let control = {};
      if (process.env.TICKETRY_E2E_PROVIDER_DIR) {
        try { control = JSON.parse(await readFile(join(process.env.TICKETRY_E2E_PROVIDER_DIR, "title-control.json"), "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      result = { thread: { name: names.get(message.params.threadId)
        ?? (Object.hasOwn(control, "title") ? control.title : "Fixture conversation title") } };
    }
    console.log(JSON.stringify({ id: message.id, result }));
  }
}
