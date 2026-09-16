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

test("an empty prompt outside a workflow does not block finalizing", async () => {
  const dom = installDom();
  // PathFind routes only Spec, Done, and Cancelled, so an empty Ideas prompt is
  // a coverage gap that no launch can reach.
  const fetchedArtifact = structuredClone(trackedArtifact);
  fetchedArtifact.prompts.PathFind.Ideas = "   ";
  let finalizedPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    if (!options.method) {
      return { ok: true, async json() { return { review: fetchedArtifact }; } };
    }
    finalizedPayload = JSON.parse(options.body);
    return { ok: true, async json() { return { ok: true, savedAs: "defaults" }; } };
  };

  await import(`./app.js?inactive-empty-test=${Date.now()}`);

  document.querySelector('[data-view="review"]').click();
  const cards = document.querySelectorAll(".summary-card");
  assert.match(cards[0].querySelector("p").textContent, /1 need attention/);
  assert.equal(
    cards[1].querySelector("p").textContent,
    "All routed states are launch-ready",
  );

  document.querySelector("#finalize-review").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(finalizedPayload, "an unroutable empty cell must not block finalize");
  assert.equal(
    document.querySelector(".finalize-card h2").textContent,
    "Review finalized",
  );

  dom.window.close();
});

test("an empty prompt inside a workflow blocks finalizing", async () => {
  const dom = installDom();
  // Spec is routed for PathFind, so the same emptiness is launch-blocking.
  const fetchedArtifact = structuredClone(trackedArtifact);
  fetchedArtifact.prompts.PathFind.Spec = "   ";
  let finalizedPayload = null;
  globalThis.fetch = async (url, options = {}) => {
    if (!options.method) {
      return { ok: true, async json() { return { review: fetchedArtifact }; } };
    }
    finalizedPayload = JSON.parse(options.body);
    return { ok: true, async json() { return { ok: true, savedAs: "defaults" }; } };
  };

  await import(`./app.js?active-empty-test=${Date.now()}`);

  document.querySelector('[data-view="review"]').click();
  const cards = document.querySelectorAll(".summary-card");
  assert.equal(
    cards[1].querySelector("p").textContent,
    "A routed prompt is empty",
  );

  document.querySelector("#finalize-review").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(finalizedPayload, null);
  assert.equal(
    document.querySelector("#toast").textContent,
    "Complete required guidance before finalizing",
  );
  assert.equal(document.querySelector("#toast").dataset.tone, "danger");

  dom.window.close();
});
