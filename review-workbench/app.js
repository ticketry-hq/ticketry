const STORAGE_KEY = "ticketry-final-review-v1";

let baseline;
let model;
let selectedType;
let selectedState;
let view = "prompts";
let toastTimer = null;
let autosaveTimer = null;

function loadDraft(artifact) {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (
      value?.schemaVersion !== artifact.schemaVersion ||
      typeof value.guidance !== "string" ||
      !value.prompts
    ) {
      return structuredClone(artifact);
    }
    for (const typeName of artifact.issueTypes) {
      for (const { name: stateName } of artifact.states) {
        if (typeof value.prompts?.[typeName]?.[stateName] !== "string") {
          return structuredClone(artifact);
        }
      }
    }
    const draft = structuredClone(artifact);
    draft.guidance = value.guidance;
    draft.prompts = structuredClone(value.prompts);
    if (value.finalizedAt) draft.finalizedAt = value.finalizedAt;
    else delete draft.finalizedAt;
    return draft;
  } catch {
    return structuredClone(artifact);
  }
}

function markEdited() {
  delete model.finalizedAt;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    updateHeaderStatus();
  }, 180);
}

function saveDraft(message = "Draft saved on this device") {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
  updateHeaderStatus();
  toast(message);
}

function changedCells() {
  let count = model.guidance === baseline.guidance ? 0 : 1;
  for (const typeName of model.issueTypes) {
    for (const state of model.states) {
      if (
        model.prompts[typeName][state.name] !==
        baseline.prompts[typeName][state.name]
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function emptyCells() {
  const cells = [];
  for (const typeName of model.issueTypes) {
    for (const state of model.states) {
      if (!model.prompts[typeName][state.name].trim()) {
        cells.push(`${typeName} · ${state.name}`);
      }
    }
  }
  return cells;
}

function activeEmptyCells() {
  return emptyCells().filter((cell) => {
    const [type, state] = cell.split(" · ");
    return issueType(type).states.includes(state);
  });
}

function words(value) {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stateMeta(name) {
  return model.states.find((state) => state.name === name);
}

function issueType(name) {
  const workflow = model.workflows[name];
  return {
    name,
    start: workflow.start,
    states: workflow.states,
    edges: workflow.transitions,
  };
}

function isActive(typeName, stateName) {
  return issueType(typeName).states.includes(stateName);
}

function transitionContext(typeName, stateName) {
  const type = issueType(typeName);
  return {
    incoming: type.edges
      .filter(([, to]) => to === stateName)
      .map(([from]) => from),
    outgoing: type.edges
      .filter(([from]) => from === stateName)
      .map(([, to]) => to),
  };
}

function toast(message, tone = "success") {
  const element = document.querySelector("#toast");
  if (!element) return;
  element.textContent = message;
  element.dataset.tone = tone;
  element.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("is-visible"), 2800);
}

function renderShell() {
  document.querySelector("#app").innerHTML = `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="Ticketry final review">
          <span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>
          <span>Ticketry</span>
          <span class="brand-divider"></span>
          <span class="brand-context">Final review</span>
        </a>
        <nav class="primary-nav" aria-label="Review sections">
          ${navButton("prompts", "Prompts")}
          ${navButton("agents", "AGENTS.md")}
          ${navButton("flow", "Flow map")}
          ${navButton("review", "Final review")}
        </nav>
        <div class="top-actions">
          <span class="draft-status" id="draft-status"></span>
          <button class="button button-quiet" id="save-draft" type="button">
            Save draft
          </button>
          <button class="button button-primary" id="finalize-top" type="button">
            Finalize review
          </button>
        </div>
      </header>
      <main id="main"></main>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
    </div>
  `;
  bindShell();
  renderView();
}

function navButton(id, label) {
  return `<button class="nav-button ${view === id ? "is-active" : ""}" data-view="${id}" type="button">${label}</button>`;
}

function bindShell() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      view = button.dataset.view;
      renderShell();
    });
  });
  document.querySelector("#save-draft").addEventListener("click", () => saveDraft());
  document.querySelector("#finalize-top").addEventListener("click", finalizeReview);
  updateHeaderStatus();
}

function updateHeaderStatus() {
  const element = document.querySelector("#draft-status");
  if (!element) return;
  const changes = changedCells();
  element.innerHTML = model.finalizedAt
    ? `<span class="status-dot status-final"></span>Finalized`
    : `<span class="status-dot"></span>${changes} ${changes === 1 ? "change" : "changes"}`;
}

function renderView() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === view);
  });
  if (view === "prompts") renderPrompts();
  if (view === "agents") renderAgents();
  if (view === "flow") renderFlow();
  if (view === "review") renderReview();
}

function renderTypeRail() {
  return `
    <aside class="rail">
      <div class="rail-heading">
        <span class="kicker">Issue types</span>
        <span class="rail-count">${model.issueTypes.length}</span>
      </div>
      <div class="type-list">
        ${model.issueTypes
          .map(
            (typeName, index) => `
            <button
              class="type-card ${typeName === selectedType ? "is-selected" : ""}"
              data-type="${typeName}"
              type="button"
            >
              <span class="type-card-top">
                <strong>${typeName}</strong>
                ${index === 0 ? '<span class="mini-badge">Default</span>' : ""}
              </span>
              <span>Tracked issue type</span>
            </button>
          `,
          )
          .join("")}
      </div>
      <div class="rail-note">
        <span class="rail-note-icon">M</span>
        <p><strong>Module</strong> is a container type and has no agent-launch workflow.</p>
      </div>
    </aside>
  `;
}

function bindTypeRail(next) {
  document.querySelectorAll("[data-type]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedType = button.dataset.type;
      if (
        next === "prompt" &&
        !model.states.some((state) => state.name === selectedState)
      ) {
        selectedState = issueType(selectedType).start;
      }
      renderView();
    });
  });
}

function renderPrompts() {
  const type = issueType(selectedType);
  const state = stateMeta(selectedState);
  const active = isActive(selectedType, selectedState);
  const context = transitionContext(selectedType, selectedState);
  const prompt = model.prompts[selectedType][selectedState];
  document.querySelector("#main").innerHTML = `
    <div class="workspace">
      ${renderTypeRail()}
      <aside class="state-panel">
        <div class="panel-heading">
          <span class="kicker">States</span>
          <span class="rail-count">${model.states.length}</span>
        </div>
        <div class="state-list">
          ${model.states.map(
            (candidate) => `
              <button
                class="state-button ${candidate.name === selectedState ? "is-selected" : ""}"
                data-state="${candidate.name}"
                type="button"
              >
                <span class="state-dot" style="--state-color:${candidate.color}"></span>
                <span>
                  <strong>${candidate.name}</strong>
                  <small>${isActive(selectedType, candidate.name) ? candidate.group : "Outside active flow"}</small>
                </span>
                ${model.prompts[selectedType][candidate.name] !== baseline.prompts[selectedType][candidate.name] ? '<span class="edited-dot" title="Edited"></span>' : ""}
              </button>
            `,
          ).join("")}
        </div>
      </aside>
      <section class="editor-pane">
        <div class="editor-heading">
          <div>
            <div class="breadcrumb">${selectedType}<span>/</span>${selectedState}</div>
            <h1>Agent prompt</h1>
            <p>The instruction injected when a ${selectedType} launches in ${selectedState}.</p>
          </div>
          <div class="editor-badges">
            <span class="state-pill"><i style="--state-color:${state.color}"></i>${state.group}</span>
            <span class="state-pill ${active ? "pill-active" : ""}">${active ? "In active flow" : "Inactive for this type"}</span>
          </div>
        </div>
        <div class="editor-toolbar">
          <span id="prompt-count">${words(prompt)} words · ${prompt.length} characters</span>
          <div>
            <button class="text-button" id="copy-to-types" type="button">Copy to other types</button>
            <button class="text-button" id="restore-prompt" type="button">Restore default</button>
          </div>
        </div>
        <label class="sr-only" for="prompt-editor">${selectedType} ${selectedState} prompt</label>
        <textarea id="prompt-editor" class="prompt-editor" spellcheck="true">${escapeHtml(prompt)}</textarea>
        <footer class="editor-footer">
          <span><kbd>⌘</kbd><kbd>S</kbd> save draft</span>
          <span>Drafts also save as you type</span>
        </footer>
      </section>
      <aside class="context-panel">
        <div>
          <span class="kicker">Flow context</span>
          <h2>${selectedState}</h2>
          <p>This context comes from the ${selectedType} workflow in the tracked defaults artifact.</p>
        </div>
        <div class="context-block">
          <span class="context-label">Arrives from</span>
          ${context.incoming.length ? context.incoming.map(flowChip).join("") : '<span class="context-empty">Start state</span>'}
        </div>
        <div class="context-block">
          <span class="context-label">Can move to</span>
          ${context.outgoing.length ? context.outgoing.map(flowChip).join("") : '<span class="context-empty">Terminal state</span>'}
        </div>
        ${
          !active
            ? `<div class="callout"><strong>Seeded, but not routed</strong><p>Ticketry currently stores a launch prompt for every canonical state. This one is retained even though ${selectedType} cannot enter ${selectedState} through its default workflow.</p></div>`
            : ""
        }
        <button class="button button-secondary full-button" id="view-in-flow" type="button">View in flow map</button>
      </aside>
    </div>
  `;
  bindTypeRail("prompt");
  document.querySelectorAll("[data-state]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedState = button.dataset.state;
      renderPrompts();
    });
  });
  const editor = document.querySelector("#prompt-editor");
  editor.addEventListener("input", () => {
    model.prompts[selectedType][selectedState] = editor.value;
    document.querySelector("#prompt-count").textContent =
      `${words(editor.value)} words · ${editor.value.length} characters`;
    markEdited();
  });
  document.querySelector("#restore-prompt").addEventListener("click", () => {
    model.prompts[selectedType][selectedState] =
      baseline.prompts[selectedType][selectedState];
    markEdited();
    renderPrompts();
    toast("Prompt restored to the repository default");
  });
  document.querySelector("#copy-to-types").addEventListener("click", () => {
    for (const typeName of model.issueTypes) {
      model.prompts[typeName][selectedState] = editor.value;
    }
    markEdited();
    renderPrompts();
    toast(`${selectedState} prompt copied to all issue types`);
  });
  document.querySelector("#view-in-flow").addEventListener("click", () => {
    view = "flow";
    renderShell();
  });
}

function flowChip(name) {
  const state = stateMeta(name);
  return `<button class="flow-chip" data-jump-state="${name}" type="button"><i style="--state-color:${state.color}"></i>${name}</button>`;
}

function renderAgents() {
  const text = model.guidance;
  document.querySelector("#main").innerHTML = `
    <div class="document-layout">
      <aside class="document-aside">
        <span class="kicker">Repository guidance</span>
        <h1>AGENTS.md</h1>
        <p>These instructions apply before any issue-type or state-specific prompt.</p>
        <div class="document-meta">
          <div><strong id="agents-lines">${text.split("\n").length}</strong><span>Lines</span></div>
          <div><strong id="agents-words">${words(text)}</strong><span>Words</span></div>
        </div>
        <div class="callout">
          <strong>Precedence</strong>
          <p>Keep repository-wide constraints here. Put stage behavior in the prompt matrix so agents receive it only in the relevant state.</p>
        </div>
      </aside>
      <section class="document-editor-wrap">
        <div class="document-toolbar">
          <div>
            <span class="file-mark">M↓</span>
            <span>AGENTS.md</span>
          </div>
          <button class="text-button" id="restore-agents" type="button">Restore repository version</button>
        </div>
        <label class="sr-only" for="agents-editor">AGENTS.md content</label>
        <textarea id="agents-editor" class="document-editor" spellcheck="true">${escapeHtml(text)}</textarea>
      </section>
      <aside class="review-notes">
        <span class="kicker">Review checklist</span>
        ${checkRow("App boundary", text.includes("Tauri") && text.includes("sidecar"))}
        ${checkRow("Desktop dev command", text.includes("desktop:dev"))}
        ${checkRow("Native terminal contract", text.includes("libghostty") && text.includes("tmux"))}
        ${checkRow("Data isolation", text.toLowerCase().includes("development data"))}
        <p class="review-hint">Checks are lightweight reminders, not policy validation.</p>
      </aside>
    </div>
  `;
  const editor = document.querySelector("#agents-editor");
  editor.addEventListener("input", () => {
    model.guidance = editor.value;
    document.querySelector("#agents-lines").textContent = editor.value.split("\n").length;
    document.querySelector("#agents-words").textContent = words(editor.value);
    markEdited();
  });
  document.querySelector("#restore-agents").addEventListener("click", () => {
    model.guidance = baseline.guidance;
    markEdited();
    renderAgents();
    toast("AGENTS.md restored to the repository version");
  });
}

function checkRow(label, passed) {
  return `<div class="check-row ${passed ? "is-passed" : ""}"><span>${passed ? "✓" : "!"}</span><strong>${label}</strong></div>`;
}

function renderFlow() {
  const type = issueType(selectedType);
  const terminalStates = new Set(
    type.states.filter(
      (stateName) => !type.edges.some(([from]) => from === stateName),
    ),
  );
  document.querySelector("#main").innerHTML = `
    <div class="flow-layout">
      ${renderTypeRail()}
      <section class="flow-canvas">
        <div class="flow-heading">
          <div>
            <span class="kicker">Tracked issue type</span>
            <h1>${selectedType} workflow</h1>
            <p>The node set, start marker, and transitions below come from the tracked defaults artifact.</p>
          </div>
          <div class="legend">
            <span><i class="legend-dot start"></i>Start</span>
            <span><i class="legend-dot agent"></i>Agent allowed</span>
            <span><i class="legend-dot terminal"></i>Terminal</span>
          </div>
        </div>
        <div class="flow-board">
          <div class="flow-track">
            ${type.states
              .map((name, index) => {
                const state = stateMeta(name);
                const reverse =
                  index > 0 &&
                  type.edges.some(
                    ([from, to]) =>
                      from === name && to === type.states[index - 1],
                  );
                return `
                  ${index ? `<div class="connector"><span>${reverse ? "⇄" : "→"}</span><small>${reverse ? "rework" : ""}</small></div>` : ""}
                  <button class="flow-node ${name === type.start ? "is-start" : ""} ${terminalStates.has(name) ? "is-terminal" : ""}" data-flow-state="${name}" type="button">
                    <span class="node-index">${String(index + 1).padStart(2, "0")}</span>
                    <i style="--state-color:${state.color}"></i>
                    <strong>${name}</strong>
                    <small>${state.group}</small>
                    ${model.prompts[selectedType][name] !== baseline.prompts[selectedType][name] ? '<span class="node-edited">Edited</span>' : ""}
                  </button>
                `;
              })
              .join("")}
          </div>
        </div>
        <div class="edge-section">
          <div class="section-title">
            <div><span class="kicker">Published graph</span><h2>${type.edges.length} transitions</h2></div>
            <span class="section-note">All seeded edges allow agent transitions</span>
          </div>
          <div class="edge-grid">
            ${type.edges
              .map(
                ([from, to]) => `
                  <button class="edge-row" data-edge-state="${from}" type="button">
                    <span><i style="--state-color:${stateMeta(from).color}"></i>${from}</span>
                    <b>→</b>
                    <span><i style="--state-color:${stateMeta(to).color}"></i>${to}</span>
                    <em>Agent allowed</em>
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>
      </section>
    </div>
  `;
  bindTypeRail("flow");
  document.querySelectorAll("[data-flow-state], [data-edge-state]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedState = button.dataset.flowState ?? button.dataset.edgeState;
      view = "prompts";
      renderShell();
    });
  });
}

function renderReview() {
  const empties = emptyCells();
  const activeEmpties = activeEmptyCells();
  const changes = changedCells();
  const agentsChanged = model.guidance !== baseline.guidance;
  const totalCells = model.issueTypes.length * model.states.length;
  const readyFlows = model.issueTypes.filter((typeName) =>
    issueType(typeName).states.every(
      (stateName) => model.prompts[typeName][stateName].trim(),
    ),
  ).length;
  document.querySelector("#main").innerHTML = `
    <div class="review-page">
      <header class="review-heading">
        <div>
          <span class="kicker">Release defaults</span>
          <h1>Final review</h1>
          <p>One pass across the complete prompt matrix, repository guidance, and published workflows.</p>
        </div>
        <div class="review-actions">
          <button class="button button-secondary" id="import-review" type="button">Import JSON</button>
          <button class="button button-secondary" id="export-review" type="button">Export draft</button>
          <input id="import-file" type="file" accept="application/json" hidden />
          <button class="button button-primary button-large" id="finalize-review" type="button">Finalize review</button>
        </div>
      </header>
      <section class="summary-grid">
        ${summaryCard("Prompt coverage", `${totalCells - empties.length}/${totalCells}`, empties.length ? `${empties.length} need attention` : "Every issue type × state has guidance", !empties.length)}
        ${summaryCard("Active flows", `${readyFlows}/${model.issueTypes.length}`, activeEmpties.length ? "A routed prompt is empty" : "All routed states are launch-ready", !activeEmpties.length)}
        ${summaryCard("AGENTS.md", agentsChanged ? "Edited" : "Baseline", `${model.guidance.split("\n").length} lines · ${words(model.guidance)} words`, Boolean(model.guidance.trim()))}
        ${summaryCard("Review delta", String(changes), changes === 1 ? "Edited surface" : "Edited surfaces", true)}
      </section>
      <section class="matrix-card">
        <div class="section-title">
          <div><span class="kicker">Prompt matrix</span><h2>Coverage and changes</h2></div>
          <span class="section-note">Click any cell to inspect its prompt</span>
        </div>
        <div class="matrix" role="table" aria-label="Prompt coverage">
          <div class="matrix-row matrix-header" role="row">
            <span role="columnheader">Issue type</span>
            ${model.states.map((state) => `<span role="columnheader">${state.name}</span>`).join("")}
          </div>
          ${model.issueTypes
            .map(
              (typeName) => `
              <div class="matrix-row" role="row">
                <span class="matrix-type" role="rowheader"><strong>${typeName}</strong><small>Tracked issue type</small></span>
                ${model.states.map((state) => {
                  const value = model.prompts[typeName][state.name];
                  const changed =
                    value !== baseline.prompts[typeName][state.name];
                  const active = isActive(typeName, state.name);
                  return `
                    <button
                      class="matrix-cell ${changed ? "is-edited" : ""} ${!value.trim() ? "is-empty" : ""}"
                      data-matrix-type="${typeName}"
                      data-matrix-state="${state.name}"
                      type="button"
                      role="cell"
                    >
                      <span>${value.trim() ? "✓" : "!"}</span>
                      <small>${changed ? "Edited" : active ? "Ready" : "Seeded"}</small>
                    </button>
                  `;
                }).join("")}
              </div>
            `,
            )
            .join("")}
        </div>
      </section>
      <section class="finalize-card ${activeEmpties.length || !model.guidance.trim() ? "has-blocker" : ""}">
        <div class="finalize-icon">${activeEmpties.length || !model.guidance.trim() ? "!" : "✓"}</div>
        <div>
          <span class="kicker">Finalize checkpoint</span>
          <h2>${activeEmpties.length || !model.guidance.trim() ? "Resolve required guidance" : model.finalizedAt ? "Review finalized" : "Ready to finalize"}</h2>
          <p>${
            activeEmpties.length
              ? `Fill ${activeEmpties.length} empty prompt${activeEmpties.length === 1 ? "" : "s"} in active workflow states.`
              : model.finalizedAt
                ? `Saved ${new Date(model.finalizedAt).toLocaleString()}. Further edits will return this review to draft.`
                : "Finalizing writes the approved artifact into Ticketry's production defaults and derives AGENTS.md from its guidance."
          }</p>
        </div>
        <button class="button button-primary" id="finalize-card-button" type="button" ${activeEmpties.length || !model.guidance.trim() ? "disabled" : ""}>
          ${model.finalizedAt ? "Finalize again" : "Finalize review"}
        </button>
      </section>
    </div>
  `;
  document.querySelectorAll("[data-matrix-type]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedType = button.dataset.matrixType;
      selectedState = button.dataset.matrixState;
      view = "prompts";
      renderShell();
    });
  });
  document.querySelector("#finalize-review").addEventListener("click", finalizeReview);
  document
    .querySelector("#finalize-card-button")
    .addEventListener("click", finalizeReview);
  document.querySelector("#export-review").addEventListener("click", exportDraft);
  const fileInput = document.querySelector("#import-file");
  document.querySelector("#import-review").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", importDraft);
}

function summaryCard(label, value, detail, positive) {
  return `
    <div class="summary-card">
      <div class="summary-top"><span>${label}</span><i class="${positive ? "is-positive" : ""}">${positive ? "✓" : "!"}</i></div>
      <strong>${value}</strong>
      <p>${detail}</p>
    </div>
  `;
}

function payload(finalizedAt = model.finalizedAt) {
  const artifact = structuredClone(model);
  artifact.finalizedAt = finalizedAt ?? null;
  return artifact;
}

async function finalizeReview() {
  const activeEmpties = activeEmptyCells();
  if (!model.guidance.trim() || activeEmpties.length) {
    view = "review";
    renderShell();
    toast("Complete required guidance before finalizing", "danger");
    return;
  }
  const finalizedAt = new Date().toISOString();
  const next = payload(finalizedAt);
  try {
    const response = await fetch("/api/finalized", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        result.errors?.join("\n") ??
          result.error ??
          "Could not finalize review.",
      );
    }
    model.finalizedAt = finalizedAt;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    view = "review";
    renderShell();
    toast(`Finalized · ${result.savedAs}`);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "danger");
  }
}

function exportDraft() {
  const blob = new Blob([`${JSON.stringify(payload(), null, 2)}\n`], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "ticketry-defaults-review.json";
  link.click();
  URL.revokeObjectURL(link.href);
  toast("Draft exported");
}

async function importDraft(event) {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    const importedGuidance =
      imported.schemaVersion === 2 ? imported.guidance : imported.agentsMd;
    if (
      ![1, 2].includes(imported.schemaVersion) ||
      typeof importedGuidance !== "string" ||
      !imported.prompts
    ) {
      throw new Error("That file is not a Ticketry review export.");
    }
    model = structuredClone(baseline);
    model.guidance = importedGuidance;
    model.prompts = structuredClone(imported.prompts);
    delete model.finalizedAt;
    saveDraft("Review imported");
    renderReview();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), "danger");
  } finally {
    event.target.value = "";
  }
}

window.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveDraft();
  }
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void finalizeReview();
  }
});

async function initialize() {
  document.querySelector("#app").innerHTML =
    '<main class="review-page"><span class="kicker">Release defaults</span><h1>Loading tracked artifact…</h1></main>';
  try {
    const response = await fetch("/api/finalized", {
      headers: { accept: "application/json" },
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error ?? "Could not load the tracked defaults artifact.");
    }
    if (!result.review) {
      throw new Error("The tracked defaults artifact is missing.");
    }
    baseline = structuredClone(result.review);
    model = loadDraft(result.review);
    selectedType = model.issueTypes[0];
    selectedState = issueType(selectedType).start;
    renderShell();
  } catch (error) {
    document.querySelector("#app").innerHTML = `
      <main class="review-page">
        <span class="kicker">Release defaults</span>
        <h1>Could not load the tracked artifact</h1>
        <p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p>
      </main>
    `;
  }
}

await initialize();
