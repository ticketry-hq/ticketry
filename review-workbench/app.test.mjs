import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("edits prompts, navigates the workflow, and finalizes the matrix", async () => {
  const dom = new JSDOM('<div id="app"></div>', {
    url: "http://127.0.0.1:4174/",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Event = dom.window.Event;
  let finalizedPayload = null;
  globalThis.fetch = async (_url, options) => {
    finalizedPayload = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          savedAs: "review-workbench/review-output.json",
        };
      },
    };
  };

  await import(`./app.js?test=${Date.now()}`);

  assert.equal(document.querySelector("h1").textContent, "Agent prompt");
  assert.equal(document.querySelectorAll("[data-state]").length, 7);
  assert.match(
    document.querySelector("#prompt-editor").value,
    /This task is in `Idea`/,
  );

  const editor = document.querySelector("#prompt-editor");
  editor.value = `${editor.value}\n\nFinal-review note.`;
  editor.dispatchEvent(new Event("input", { bubbles: true }));

  document.querySelector('[data-type="PathFind"]').click();
  document.querySelector('[data-view="flow"]').click();
  assert.equal(document.querySelector(".flow-heading h1").textContent, "PathFind workflow");
  assert.match(document.querySelector(".edge-section h2").textContent, /2 transitions/);

  document.querySelector('[data-view="review"]').click();
  assert.match(
    document.querySelector(".summary-card:last-child > strong").textContent,
    /1/,
  );

  document.querySelector("#finalize-review").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(finalizedPayload.schemaVersion, 1);
  assert.match(finalizedPayload.prompts.Story.Idea, /Final-review note/);
  assert.ok(finalizedPayload.finalizedAt);
  assert.equal(document.querySelector(".finalize-card h2").textContent, "Review finalized");

  dom.window.close();
});
