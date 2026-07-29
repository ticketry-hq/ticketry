const STATES = [
  { name: "Idea", group: "Backlog", color: "#747982" },
  { name: "Refinement", group: "Unstarted", color: "#9b6bd0" },
  { name: "Ready", group: "Unstarted", color: "#2e9bf3" },
  { name: "Implement", group: "Started", color: "#eea62b" },
  { name: "Review", group: "Started", color: "#dc55a7" },
  { name: "Done", group: "Completed", color: "#55b36a" },
  { name: "Cancelled", group: "Cancelled", color: "#8f9bae" },
];

const ISSUE_TYPES = [
  {
    name: "Story",
    eyebrow: "Default task",
    description: "End-to-end product work, refined before implementation.",
    start: "Idea",
    states: ["Idea", "Refinement", "Ready", "Implement", "Review", "Done", "Cancelled"],
    edges: [
      ["Idea", "Refinement"],
      ["Idea", "Cancelled"],
      ["Refinement", "Ready"],
      ["Refinement", "Cancelled"],
      ["Ready", "Implement"],
      ["Ready", "Cancelled"],
      ["Implement", "Review"],
      ["Implement", "Cancelled"],
      ["Review", "Implement"],
      ["Review", "Done"],
      ["Review", "Cancelled"],
    ],
  },
  {
    name: "PathFind",
    eyebrow: "Discovery task",
    description: "A bounded investigation that resolves directly from refinement.",
    start: "Refinement",
    states: ["Refinement", "Done", "Cancelled"],
    edges: [
      ["Refinement", "Done"],
      ["Refinement", "Cancelled"],
    ],
  },
  {
    name: "Implementation",
    eyebrow: "Delivery child",
    description: "A dependency-ordered implementation slice created under a Story.",
    start: "Implement",
    states: ["Ready", "Implement", "Review", "Done", "Cancelled"],
    edges: [
      ["Ready", "Implement"],
      ["Ready", "Cancelled"],
      ["Implement", "Review"],
      ["Implement", "Cancelled"],
      ["Review", "Implement"],
      ["Review", "Done"],
      ["Review", "Cancelled"],
    ],
  },
];

const SHARED_PROMPTS = {
  default:
    "Follow AGENTS.md exactly when this prompt is launched from a work item. Highest priority is readability. Do not extend functionality, integrate new interfaces, or touch unrelated modules; keep changes local to the requested file or module, explore the local repo first, and use the current module folder as the working directory. This is the SDLC workflow: `Idea -> Refinement -> Ready -> Implement -> Review -> Done`, with `Cancelled` the terminal off-ramp for dropped work. Advance state only through the coding agent's status tool, and only when the active stage guidance explicitly requests a legal move; completing a phase does not imply automatic promotion. Never leave a ticket in an earlier phase when the active stage guidance requires advancing after its deliverable is complete. Blockedness is expressed only by dependency edges - there is no `Blocked` state. If work is trivial enough to skip ceremony, say so; skipping ceremony requires an explicit audited `force` rather than half-doing a phase.",
  Idea: `This task is in \`Idea\`: The user has typed in a thought with stream of consciousness writing style.
This may or may not contain a coherent idea. Your job is to make sense of it with the codebase context you have.

Refine step:
1. Based on the user's description, explore the codebase and find relevant files and make sense of the ask.
2. Update the title based on your understanding using the MCP server.

After this, we decide, do we have enough to just make the change or if further refinement is required.
Case "small change" && "no refinement needed":
- Use the skill 'to-spec' to write a spec for the ask with the relevant files the next agent should look at.
- Use the skill 'to-tickets' to split the task into tickets.
- Create those tickets as 'Implementation' tickets using the MCP under the main task.
- Move the story over to 'Ready' state for the user to prioritize and execute when required.

Case "large change" || "needs refinement":
- Append the paths to the relevant files to the ticket
- Move it to "Refinement" state.`,
  Refinement: `This task is in \`Refinement\`, where an idea is turned into a committed, dependency-ordered plan through agent-driven discovery.

This is what you need to do in this ticket:
1. Use the /grill-with-docs or the $grill-with-docs skill to finalize requirements.
2. Use the /to-spec or $to-spec and generate spec, add the link to the spec in the story.
3. Use to /to-tickets or $to-tickets skill to generated tickets. Create the tickets as Implementation subtasks.

Move the story to Ready state.
Stop after this, don't implement.`,
  Ready: `This task is in \`Ready\`: refined work queued until implementation capacity is assigned. Do not implement anything - \`Ready\` is a prioritization queue, not an implementation phase. If launched here, use the time to *verify the promise of \`Ready\`* and report: for a **Story**, confirm the spec and HLD exist in its design directory, that Implementation children exist, and that their dependency edges form a DAG, and flag anything missing; for an **Implementation child**, confirm its scope and its \`blocked_by\` edges read correctly. Then report the verification and stop; verification does not itself request or trigger entering \`Implement\`.`,
  Implement: `This task is in \`Implement\`: **What you do depends on this ticket's Type.**

**If this is an Implementation child:** implement only this child's agreed slice, from its spec and the parent's HLD. Keep changes local, avoid unrelated edits, and validate the touched behaviour before finishing. You are running because your dependencies are satisfied - do not start work that a \`blocked_by\` edge still gates. When the slice is complete and validated, move **this child** to \`Review\` so the review step is triggered by the work itself. If you are blocked, say so and leave it in \`Implement\`.

**If this is a Story:** the implementation campaign is running across your Implementation children; your job is coordination and integration, not re-implementing the children. Do not move the story yourself - it advances to \`Review\` on its own once every Implementation child is terminal and at least one is \`Done\`. Surface cross-child integration problems as they appear.
If there are no implementation stories under this, then implement the story itself.

For dependencies, treat 'Review' state as unblocked.`,
  Review: `This task is in \`Review\`. **What you do depends on this ticket's Type.**

**If this is an Implementation child:** run \`code-review\` over this child's changes and report findings plainly. The review deliverable is the findings; completing it does not itself request or trigger a move to \`Done\`.

**If this is a Story:** review the *combined* result of all children together, looking for integration issues that per-child review cannot catch. Turn each actionable finding into a new **Implementation** child through the dedicated \`create_review_finding\` tool - it creates the child directly in \`Ready\`, parented to this Story, carrying a fixed \`Path\` (repo-relative file) / inclusive \`Lines\` (start-end) / optional \`Note\` evidence block, so fixes rejoin the same execution machinery. Do not draw a \`blocked_by\` dependency edge and do not fix findings inline here; returning to \`Implement\` is outside this review deliverable. Final acceptance must be explicitly requested; do not infer it from a clean review. It requires a PR linked to the story. When final acceptance is requested, finalize atomically: commit the worktree changes, open a PR, link it to the story, clean up the worktree, and only then request the \`Review -> Done\` transition; if any step fails, stay in \`Review\` and report the exact error rather than advancing.`,
};

const AGENTS_MD = `# Ticketry desktop application

This repository owns the complete Ticketry desktop application: the React
frontend, Tauri shell, supervised Python backend sidecar, MCP service, and
generated SDKs required by that application.

Use \`npm run desktop:dev\` or \`pnpm run dev\` from the repository root for local
desktop development. Both commands rebuild and launch the sidecar. Keep browser-
only service commands as supporting development tools, not as a separate product.

Keep the Tauri/webview boundary narrow. The native terminal renderer consumes a
pinned libghostty revision through its C API, while tmux remains responsible for
durable sessions. Preserve the existing fallback unless a deliberate migration
removes it.

Development data must remain isolated from live application data. Generated
databases, caches, sidecars, native libraries, and build output must not be
committed.`;

const makePromptMatrix = () =>
  Object.fromEntries(
    ISSUE_TYPES.map(({ name }) => [
      name,
      Object.fromEntries(
        STATES.map(({ name: state }) => [
          state,
          SHARED_PROMPTS[state] ?? SHARED_PROMPTS.default,
        ]),
      ),
    ]),
  );

const INITIAL = {
  schemaVersion: 1,
  agentsMd: AGENTS_MD,
  prompts: makePromptMatrix(),
};

const STORAGE_KEY = "ticketry-final-review-v1";

let model = loadDraft() ?? structuredClone(INITIAL);
let selectedType = "Story";
let selectedState = "Idea";
let view = "prompts";
let toastTimer = null;
let autosaveTimer = null;

function loadDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value?.schemaVersion === 1 ? value : null;
  } catch {
    return null;
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
  let count = model.agentsMd === INITIAL.agentsMd ? 0 : 1;
  for (const type of ISSUE_TYPES) {
    for (const state of STATES) {
      if (
        model.prompts[type.name][state.name] !==
        INITIAL.prompts[type.name][state.name]
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function emptyCells() {
  const cells = [];
  for (const type of ISSUE_TYPES) {
    for (const state of STATES) {
      if (!model.prompts[type.name][state.name].trim()) {
        cells.push(`${type.name} · ${state.name}`);
      }
    }
  }
  return cells;
}

function activeEmptyCells() {
  return emptyCells().filter((cell) => {
    const [type, state] = cell.split(" · ");
    return ISSUE_TYPES.find((candidate) => candidate.name === type).states.includes(
      state,
    );
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
  return STATES.find((state) => state.name === name);
}

function issueType(name) {
  return ISSUE_TYPES.find((type) => type.name === name);
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
        <span class="rail-count">3</span>
      </div>
      <div class="type-list">
        ${ISSUE_TYPES.map(
          (type) => `
            <button
              class="type-card ${type.name === selectedType ? "is-selected" : ""}"
              data-type="${type.name}"
              type="button"
            >
              <span class="type-card-top">
                <strong>${type.name}</strong>
                ${type.name === "Story" ? '<span class="mini-badge">Default</span>' : ""}
              </span>
              <span>${type.eyebrow}</span>
            </button>
          `,
        ).join("")}
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
      if (next === "prompt" && !STATES.some((state) => state.name === selectedState)) {
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
          <span class="rail-count">7</span>
        </div>
        <div class="state-list">
          ${STATES.map(
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
                ${model.prompts[selectedType][candidate.name] !== INITIAL.prompts[selectedType][candidate.name] ? '<span class="edited-dot" title="Edited"></span>' : ""}
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
          <p>${type.description}</p>
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
      INITIAL.prompts[selectedType][selectedState];
    markEdited();
    renderPrompts();
    toast("Prompt restored to the repository default");
  });
  document.querySelector("#copy-to-types").addEventListener("click", () => {
    for (const typeOption of ISSUE_TYPES) {
      model.prompts[typeOption.name][selectedState] = editor.value;
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
  const text = model.agentsMd;
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
    model.agentsMd = editor.value;
    document.querySelector("#agents-lines").textContent = editor.value.split("\n").length;
    document.querySelector("#agents-words").textContent = words(editor.value);
    markEdited();
  });
  document.querySelector("#restore-agents").addEventListener("click", () => {
    model.agentsMd = INITIAL.agentsMd;
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
  const mainStates = type.states.filter((state) => state !== "Cancelled");
  const cancelledSources = type.edges
    .filter(([, to]) => to === "Cancelled")
    .map(([from]) => from);
  document.querySelector("#main").innerHTML = `
    <div class="flow-layout">
      ${renderTypeRail()}
      <section class="flow-canvas">
        <div class="flow-heading">
          <div>
            <span class="kicker">${type.eyebrow}</span>
            <h1>${selectedType} workflow</h1>
            <p>${type.description}</p>
          </div>
          <div class="legend">
            <span><i class="legend-dot start"></i>Start</span>
            <span><i class="legend-dot agent"></i>Agent allowed</span>
            <span><i class="legend-dot terminal"></i>Terminal</span>
          </div>
        </div>
        <div class="flow-board">
          <div class="flow-track">
            ${mainStates
              .map((name, index) => {
                const state = stateMeta(name);
                const reverse =
                  index > 0 &&
                  type.edges.some(
                    ([from, to]) => from === name && to === mainStates[index - 1],
                  );
                return `
                  ${index ? `<div class="connector"><span>${reverse ? "⇄" : "→"}</span><small>${reverse ? "rework" : ""}</small></div>` : ""}
                  <button class="flow-node ${name === type.start ? "is-start" : ""} ${["Done"].includes(name) ? "is-terminal" : ""}" data-flow-state="${name}" type="button">
                    <span class="node-index">${String(index + 1).padStart(2, "0")}</span>
                    <i style="--state-color:${state.color}"></i>
                    <strong>${name}</strong>
                    <small>${state.group}</small>
                    ${model.prompts[selectedType][name] !== INITIAL.prompts[selectedType][name] ? '<span class="node-edited">Edited</span>' : ""}
                  </button>
                `;
              })
              .join("")}
          </div>
          <div class="offramp">
            <div class="offramp-line"></div>
            <div>
              <span class="kicker">Terminal off-ramp</span>
              <p>${cancelledSources.join(", ")} ${cancelledSources.length === 1 ? "can" : "can each"} move here.</p>
            </div>
            <button class="flow-node is-terminal cancelled-node" data-flow-state="Cancelled" type="button">
              <i style="--state-color:${stateMeta("Cancelled").color}"></i>
              <strong>Cancelled</strong>
              <small>Archived and resolved</small>
            </button>
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
  const agentsChanged = model.agentsMd !== INITIAL.agentsMd;
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
        ${summaryCard("Prompt coverage", `${21 - empties.length}/21`, empties.length ? `${empties.length} need attention` : "Every issue type × state has guidance", !empties.length)}
        ${summaryCard("Active flows", `${3 - (activeEmpties.length ? 1 : 0)}/3`, activeEmpties.length ? "A routed prompt is empty" : "All routed states are launch-ready", !activeEmpties.length)}
        ${summaryCard("AGENTS.md", agentsChanged ? "Edited" : "Baseline", `${model.agentsMd.split("\n").length} lines · ${words(model.agentsMd)} words`, Boolean(model.agentsMd.trim()))}
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
            ${STATES.map((state) => `<span role="columnheader">${state.name}</span>`).join("")}
          </div>
          ${ISSUE_TYPES.map(
            (type) => `
              <div class="matrix-row" role="row">
                <span class="matrix-type" role="rowheader"><strong>${type.name}</strong><small>${type.eyebrow}</small></span>
                ${STATES.map((state) => {
                  const value = model.prompts[type.name][state.name];
                  const changed =
                    value !== INITIAL.prompts[type.name][state.name];
                  const active = isActive(type.name, state.name);
                  return `
                    <button
                      class="matrix-cell ${changed ? "is-edited" : ""} ${!value.trim() ? "is-empty" : ""}"
                      data-matrix-type="${type.name}"
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
          ).join("")}
        </div>
      </section>
      <section class="finalize-card ${activeEmpties.length || !model.agentsMd.trim() ? "has-blocker" : ""}">
        <div class="finalize-icon">${activeEmpties.length || !model.agentsMd.trim() ? "!" : "✓"}</div>
        <div>
          <span class="kicker">Finalize checkpoint</span>
          <h2>${activeEmpties.length || !model.agentsMd.trim() ? "Resolve required guidance" : model.finalizedAt ? "Review finalized" : "Ready to finalize"}</h2>
          <p>${
            activeEmpties.length
              ? `Fill ${activeEmpties.length} empty prompt${activeEmpties.length === 1 ? "" : "s"} in active workflow states.`
              : model.finalizedAt
                ? `Saved ${new Date(model.finalizedAt).toLocaleString()}. Further edits will return this review to draft.`
                : "Finalizing writes the approved matrix into Ticketry's production defaults and keeps a review-output.json audit artifact beside this disposable app."
          }</p>
        </div>
        <button class="button button-primary" id="finalize-card-button" type="button" ${activeEmpties.length || !model.agentsMd.trim() ? "disabled" : ""}>
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
  return {
    schemaVersion: 1,
    finalizedAt: finalizedAt ?? null,
    source: {
      agentsMd: "AGENTS.md",
      prompts: "backend/worktracker/launch_seeds.py",
      workflows: "backend/worktracker/workflow_seeds.py",
    },
    agentsMd: model.agentsMd,
    prompts: model.prompts,
    workflows: Object.fromEntries(
      ISSUE_TYPES.map((type) => [
        type.name,
        {
          start: type.start,
          transitions: type.edges,
        },
      ]),
    ),
  };
}

async function finalizeReview() {
  const activeEmpties = activeEmptyCells();
  if (!model.agentsMd.trim() || activeEmpties.length) {
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
    if (!response.ok) throw new Error(result.error ?? "Could not finalize review.");
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
    if (
      imported.schemaVersion !== 1 ||
      typeof imported.agentsMd !== "string" ||
      !imported.prompts
    ) {
      throw new Error("That file is not a Ticketry review export.");
    }
    model = {
      schemaVersion: 1,
      agentsMd: imported.agentsMd,
      prompts: imported.prompts,
    };
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

renderShell();
