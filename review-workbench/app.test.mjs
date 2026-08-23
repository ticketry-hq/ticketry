import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

import { validateFinalizedDefaults } from "./reviewed_defaults_validator.mjs";

const trackedArtifact = JSON.parse(
  await readFile(
    new URL("../studio/src-tauri/resources/work-management/reviewed_defaults.json", import.meta.url),
    "utf8",
  ),
);

function installDom() {
  const dom = new JSDOM('<div id="app"></div>', {
    url: "http://127.0.0.1:4174/",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.Event = dom.window.Event;
  return dom;
}

test("renders prompts, guidance, vocabulary, and workflow from the fetched artifact", async () => {
  const dom = installDom();
  const fetchedArtifact = structuredClone(trackedArtifact);
  fetchedArtifact.guidance = "# Guidance loaded from the tracked artifact";
  fetchedArtifact.issueTypes = ["PathFind", "Story", "Implementation"];
  fetchedArtifact.prompts.PathFind.Done =
    "Prompt loaded only from the fetched artifact.";
  fetchedArtifact.workflows.PathFind = {
    start: "Done",
    states: ["Done", "Spec"],
    transitions: [["Done", "Spec"]],
  };
  const doneState = fetchedArtifact.states.find(({ name }) => name === "Done");
  doneState.group = "artifact-terminal-group";
  doneState.color = "#123456";
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/finalized");
    assert.equal(options.method, undefined);
    return {
      ok: true,
      async json() {
        return { review: fetchedArtifact };
      },
    };
  };

  await import(`./app.js?render-test=${Date.now()}`);

  assert.equal(
    document.querySelector("[data-type]").dataset.type,
    fetchedArtifact.issueTypes[0],
  );
  assert.equal(
    document.querySelector("#prompt-editor").value,
    fetchedArtifact.prompts.PathFind.Done,
  );
  const doneButton = document.querySelector('[data-state="Done"]');
  assert.equal(
    doneButton.querySelector("small").textContent,
    "artifact-terminal-group",
  );
  assert.match(doneButton.querySelector(".state-dot").getAttribute("style"), /#123456/);

  document.querySelector('[data-view="agents"]').click();
  assert.equal(
    document.querySelector("#agents-editor").value,
    fetchedArtifact.guidance,
  );

  document.querySelector('[data-view="flow"]').click();
  assert.equal(document.querySelectorAll("[data-flow-state]").length, 2);
  assert.equal(
    document.querySelector(".flow-node.is-start strong").textContent,
    "Done",
  );
  assert.match(document.querySelector(".edge-section h2").textContent, /1 transition/);
  assert.equal(document.querySelectorAll("[data-edge-state]").length, 1);
  assert.equal(
    document.querySelector('.flow-node[data-flow-state="Done"] small').textContent,
    "artifact-terminal-group",
  );

  dom.window.close();
});

test("edits and republishes the fetched artifact", async () => {
  const dom = installDom();
  let finalizedPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    if (!options.method) {
      assert.equal(url, "/api/finalized");
      return {
        ok: true,
        async json() {
          return { review: trackedArtifact };
        },
      };
    }
    assert.equal(url, "/api/finalized");
    assert.equal(options.method, "POST");
    finalizedPayload = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return {
          ok: true,
          savedAs: "Ticketry production defaults",
        };
      },
    };
  };

  await import(`./app.js?finalize-test=${Date.now()}`);

  assert.equal(document.querySelector("h1").textContent, "Agent prompt");
  assert.equal(document.querySelectorAll("[data-state]").length, 8);
  document.querySelector('[data-state="Grill"]').click();
  assert.match(
    document.querySelector("#prompt-editor").value,
    /This task is in `Grill`/,
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
  assert.equal(finalizedPayload.schemaVersion, 2);
  assert.match(finalizedPayload.guidance, /^# Ticketry desktop application/);
  assert.deepEqual(finalizedPayload.issueTypes, [
    "Story",
    "PathFind",
    "Implementation",
  ]);
  assert.deepEqual(finalizedPayload.states, trackedArtifact.states);
  assert.deepEqual(finalizedPayload.workflows, trackedArtifact.workflows);
  assert.deepEqual(
    finalizedPayload.requiredSkills,
    trackedArtifact.requiredSkills,
  );
  assert.deepEqual(finalizedPayload.sourceOfTruth, trackedArtifact.sourceOfTruth);
  assert.deepEqual(validateFinalizedDefaults(finalizedPayload), []);
  assert.match(finalizedPayload.prompts.Story.Grill, /Final-review note/);
  assert.ok(finalizedPayload.finalizedAt);
  assert.equal(document.querySelector(".finalize-card h2").textContent, "Review finalized");

  dom.window.close();
});
