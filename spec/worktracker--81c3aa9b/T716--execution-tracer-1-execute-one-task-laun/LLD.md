<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>T716 · Execution Tracer 1 — LLD</title>
<style>
  :root {
    --bg: #f6f7f9;
    --panel: #ffffff;
    --ink: #1d2433;
    --muted: #5b6478;
    --line: #e3e7ee;
    --accent: #3556d4;
    --accent-soft: #e8edfb;
    --green: #1d7a4f;
    --green-soft: #e3f3ea;
    --amber: #9a6700;
    --amber-soft: #fbf0d8;
    --red: #b03030;
    --red-soft: #fbe7e7;
    --violet: #6b3fb8;
    --violet-soft: #f0e9fb;
    --mono: "SF Mono", ui-monospace, Menlo, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  header { background: var(--panel); padding: 26px 40px 16px; border-bottom: 1px solid var(--line); }
  .crumb { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .07em; text-transform: uppercase; }
  h1 { margin: 6px 0 4px; font-size: 23px; line-height: 1.2; }
  .sub { max-width: 940px; color: var(--muted); font-size: 14px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .chip { border-radius: 20px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 800; padding: 4px 10px; }
  .chip.green { background: var(--green-soft); color: var(--green); }
  .chip.amber { background: var(--amber-soft); color: var(--amber); }
  .chip.violet { background: var(--violet-soft); color: var(--violet); }
  nav { position: sticky; top: 0; z-index: 20; display: flex; gap: 2px; overflow-x: auto; background: var(--panel); border-bottom: 1px solid var(--line); padding: 0 40px; }
  nav a { color: var(--muted); text-decoration: none; white-space: nowrap; padding: 10px 14px 8px; border-bottom: 2px solid transparent; font-size: 13px; font-weight: 800; }
  nav a.active, nav a:hover { color: var(--accent); border-bottom-color: var(--accent); }
  main { max-width: 1180px; margin: 0 auto; padding: 34px 40px 70px; }
  section { margin-bottom: 56px; scroll-margin-top: 58px; }
  h2 { margin: 0 0 4px; font-size: 18px; }
  .lede { margin: 0 0 18px; max-width: 860px; color: var(--muted); font-size: 14px; }
  .m { font-family: var(--mono); font-size: 12.5px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; }
  .card h3 { margin: 0 0 10px; font-size: 15px; }
  .list { list-style: none; margin: 0; padding: 0; }
  .list li { position: relative; padding: 6px 0 6px 20px; border-bottom: 1px dashed var(--line); font-size: 13.5px; }
  .list li:last-child { border-bottom: 0; }
  .list li:before { content: "•"; position: absolute; left: 3px; color: var(--accent); font-weight: 900; }
  .list li.no:before { content: "×"; color: var(--red); }
  .diagram { display: grid; grid-template-columns: 1fr 320px; gap: 18px; align-items: stretch; }
  svg { width: 100%; height: auto; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
  svg text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 13px; fill: var(--ink); }
  .node { cursor: pointer; }
  .node rect, .node ellipse { fill: #fff; stroke: var(--accent); stroke-width: 2; }
  .node.deferred rect { stroke-dasharray: 6 5; stroke: var(--amber); }
  .node.selected rect, .node.selected ellipse { fill: var(--accent-soft); stroke-width: 3; }
  .edge { stroke: #7f8aa3; stroke-width: 1.8; fill: none; marker-end: url(#arrow); }
  .edge.deferred { stroke-dasharray: 6 5; stroke: var(--amber); }
  .side h3 { margin: 0 0 6px; color: var(--accent); font-size: 15px; }
  .side .tag { display: inline-block; margin-bottom: 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); padding: 2px 8px; font-size: 11px; font-weight: 800; }
  .side ul { margin: 8px 0 0; padding: 0; list-style: none; }
  .side li { position: relative; padding: 4px 0 4px 18px; font-size: 13px; }
  .side li:before { content: "✓"; position: absolute; left: 0; color: var(--green); font-weight: 900; }
  .side li.no:before { content: "×"; color: var(--red); }
  table { width: 100%; border-collapse: collapse; overflow: hidden; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: top; font-size: 13px; }
  th { background: #fbfcfe; color: var(--muted); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
  tr:last-child td { border-bottom: 0; }
  tr[data-node] { cursor: pointer; }
  tr.hl td { background: var(--accent-soft); }
  .pill { display: inline-block; border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 800; }
  .pill.new { background: var(--green-soft); color: var(--green); }
  .pill.mod { background: var(--amber-soft); color: var(--amber); }
  .pill.ro { background: var(--accent-soft); color: var(--accent); }
  .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .step { background: var(--panel); border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: 8px; padding: 13px 14px; min-height: 126px; }
  .step .n { color: var(--accent); font-size: 18px; font-weight: 900; }
  .step b { display: block; margin: 2px 0 4px; font-size: 13.5px; }
  .step span { color: var(--muted); font-size: 12.5px; }
  details { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; }
  details + details { margin-top: 10px; }
  summary { cursor: pointer; font-weight: 800; color: var(--accent); }
  .accept { background: var(--green-soft); border: 1px solid #cfe5d8; border-radius: 8px; padding: 18px 20px; font-size: 14px; }
  .accept b { color: var(--green); }
  @media (max-width: 900px) {
    header, nav, main { padding-left: 18px; padding-right: 18px; }
    .grid2, .diagram, .steps { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<header>
  <div class="crumb">Coding · WorkTracker module · Ticket #716 · LLD</div>
  <h1>Execution Tracer 1 — Execute One Task</h1>
  <div class="sub">Low-level plan for a server-side tracer that launches one implementation run through the future <span class="m">spawn_run</span> boundary, observes <span class="m">issue_state_changed</span>, and flips process-local run state from running to done when the same task reaches completed.</div>
  <div class="chips">
    <span class="chip">Phase: Todo → LLD review</span>
    <span class="chip green">No implementation in this phase</span>
    <span class="chip amber">Requires #706 and #715 before coding</span>
    <span class="chip violet">No DB table · no endpoint · no UI</span>
  </div>
</header>
<nav id="nav">
  <a href="#scope" class="active">Scope</a>
  <a href="#diagram">Execution Loop</a>
  <a href="#map">Change Map</a>
  <a href="#contracts">Contracts</a>
  <a href="#steps">Steps</a>
  <a href="#tests">Harness</a>
  <a href="#risks">Edges</a>
  <a href="#accept">Acceptance</a>
</nav>
<main>
  <section id="scope">
    <h2>Scope lock</h2>
    <div class="lede">This ticket proves the smallest useful loop: internal trigger, one task, one implement run, completion by the canonical state-change seam.</div>
    <div class="grid2">
      <div class="card">
        <h3>Build</h3>
        <ul class="list">
          <li>Server-side execution driver under <span class="m">../server/apps</span>.</li>
          <li>Pure reducer for one task and one <span class="m">implement</span> phase.</li>
          <li>Process-local registry keyed by task id.</li>
          <li>Signal receiver for <span class="m">worktracker.signals.issue_state_changed</span>.</li>
          <li>Tests that mock launch and emit the signal directly.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Do not build</h3>
        <ul class="list">
          <li class="no">No durable execution table, migration, or restart recovery.</li>
          <li class="no">No graph traversal, dependency release, parallelism, or retries.</li>
          <li class="no">No public HTTP route, MCP tool, Studio control, or CLI trigger.</li>
          <li class="no">No implementation of #706, #715, #717, #718, #719, #720, or #721.</li>
          <li class="no">No synchronous WorkTracker state mutation from the receiver.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="diagram">
    <h2>Execution loop</h2>
    <div class="lede">Click a node to see its responsibilities and explicit non-responsibilities. Dashed boxes are prerequisite or deferred seams.</div>
    <div class="diagram">
      <svg viewBox="0 0 820 470" role="img" aria-label="Execution tracer component diagram">
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#7f8aa3"></path>
          </marker>
        </defs>
        <path class="edge" d="M135 105 C210 105 215 105 285 105"></path>
        <path class="edge" d="M465 105 C535 105 545 105 610 105"></path>
        <path class="edge" d="M410 148 C410 205 410 212 410 262"></path>
        <path class="edge deferred" d="M610 135 C560 190 525 225 470 268"></path>
        <path class="edge" d="M410 332 C410 382 410 388 410 418"></path>
        <path class="edge" d="M250 305 C195 305 175 305 130 305"></path>
        <g class="node" data-node="caller" transform="translate(40 70)">
          <ellipse cx="70" cy="35" rx="70" ry="35"></ellipse>
          <text x="70" y="40" text-anchor="middle">Internal caller</text>
        </g>
        <g class="node" data-node="driver" transform="translate(285 62)">
          <rect width="180" height="86" rx="8"></rect>
          <text x="90" y="35" text-anchor="middle">Execution driver</text>
          <text x="90" y="56" text-anchor="middle" fill="#5b6478">load · launch · store</text>
        </g>
        <g class="node deferred" data-node="spawn" transform="translate(610 70)">
          <rect width="150" height="70" rx="8"></rect>
          <text x="75" y="31" text-anchor="middle">spawn_run</text>
          <text x="75" y="51" text-anchor="middle" fill="#5b6478">#715 seam</text>
        </g>
        <g class="node" data-node="reducer" transform="translate(295 262)">
          <rect width="230" height="70" rx="8"></rect>
          <text x="115" y="31" text-anchor="middle">Pure reducer</text>
          <text x="115" y="51" text-anchor="middle" fill="#5b6478">state + event → next + actions</text>
        </g>
        <g class="node" data-node="registry" transform="translate(22 272)">
          <rect width="170" height="66" rx="8"></rect>
          <text x="85" y="30" text-anchor="middle">Local registry</text>
          <text x="85" y="49" text-anchor="middle" fill="#5b6478">process memory</text>
        </g>
        <g class="node" data-node="signal" transform="translate(287 418)">
          <rect width="246" height="44" rx="8"></rect>
          <text x="123" y="28" text-anchor="middle">issue_state_changed receiver</text>
        </g>
      </svg>
      <div class="panel side" id="nodeInfo">
        <h3>Execution driver</h3>
        <span class="tag">selected</span>
        <ul>
          <li>Loads and validates the target task.</li>
          <li>Feeds events into the reducer and applies launch actions.</li>
          <li>Stores running, failed, and done states in process memory.</li>
          <li class="no">Does not own agent defaulting or durable orchestration history.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="map">
    <h2>File change map</h2>
    <div class="lede">The implementation belongs in the coding-app backend. Generic WorkTracker remains a dependency, not the owner of the tracer.</div>
    <table>
      <thead><tr><th>File</th><th>Kind</th><th>Exact delta</th></tr></thead>
      <tbody>
        <tr data-node="driver"><td><span class="m">../server/apps/execution/__init__.py</span></td><td><span class="pill new">new</span></td><td>Package marker if the namespace does not already exist.</td></tr>
        <tr data-node="driver"><td><span class="m">../server/apps/execution/apps.py</span></td><td><span class="pill new">new</span></td><td>AppConfig imports the receiver at startup only.</td></tr>
        <tr data-node="reducer"><td><span class="m">../server/apps/execution/state.py</span></td><td><span class="pill new">new</span></td><td>Engine state, event, and data-only action definitions for one task.</td></tr>
        <tr data-node="reducer"><td><span class="m">../server/apps/execution/reducer.py</span></td><td><span class="pill new">new</span></td><td>Pure transition logic for execute requested, run started, run failed, and completion observed.</td></tr>
        <tr data-node="driver"><td><span class="m">../server/apps/execution/driver.py</span></td><td><span class="pill new">new</span></td><td>Internal execute callable, WorkTracker task lookup, registry update, and spawn action application.</td></tr>
        <tr data-node="signal"><td><span class="m">../server/apps/execution/signals.py</span></td><td><span class="pill new">new</span></td><td>Receiver filters active task completions into the driver and reducer.</td></tr>
        <tr data-node="driver"><td><span class="m">../server/studio_server/settings.py</span></td><td><span class="pill mod">modify</span></td><td>Add the execution app after runs, terminals, and worktracker.</td></tr>
        <tr data-node="reducer"><td><span class="m">../server/apps/execution/tests/</span></td><td><span class="pill new">new</span></td><td>Reducer, driver, receiver, and optional app-wiring tests.</td></tr>
        <tr data-node="spawn"><td><span class="m">../server/apps/terminals/spawn_run.py</span></td><td><span class="pill ro">read-only</span></td><td>Prerequisite from #715. This ticket calls it; it does not create it.</td></tr>
        <tr data-node="signal"><td><span class="m">worktracker/worktracker/signals.py</span></td><td><span class="pill ro">read-only</span></td><td>Prerequisite from #706. This ticket observes it; it does not alter it.</td></tr>
      </tbody>
    </table>
  </section>

  <section id="contracts">
    <h2>Decision contracts</h2>
    <div class="lede">These are the choices implementation should follow without reopening scope.</div>
    <table>
      <thead><tr><th>Contract</th><th>Decision</th><th>Reason</th></tr></thead>
      <tbody>
        <tr data-node="driver"><td>Driver home</td><td><span class="m">../server/apps/execution</span></td><td>It must call server launch code and observe server-side run models already loaded with WorkTracker.</td></tr>
        <tr data-node="caller"><td>Entrypoint</td><td>Internal callable only, accepting task id and agent.</td><td>The caller owns agent policy; this slice exposes no public trigger surface.</td></tr>
        <tr data-node="reducer"><td>Reducer</td><td>Pure, synchronous, I/O-free.</td><td>Keeps transition behavior testable without Django, tmux, WorkTracker, or agent processes.</td></tr>
        <tr data-node="registry"><td>Run state</td><td>Process-local registry.</td><td>The accepted slice requires a thin tracer loop, not restart durability.</td></tr>
        <tr data-node="signal"><td>Completion</td><td>Matching task id plus <span class="m">to_group=completed</span>.</td><td>Completion is tied to the canonical WorkTracker state-change seam.</td></tr>
        <tr data-node="spawn"><td>Launch</td><td>Call #715 <span class="m">spawn_run</span> with implement recipe facts.</td><td>#714 remains the lower-level shared launch primitive; #716 should not bypass #715.</td></tr>
        <tr data-node="driver"><td>#700 record</td><td>Add the accepted driver-home and launch-bridge decision to #700 design notes when implementing.</td><td>The parent graph-executor design must preserve the same architecture decision.</td></tr>
      </tbody>
    </table>
  </section>

  <section id="steps">
    <h2>Decision-complete steps</h2>
    <div class="lede">Build order for the implementation phase after prerequisites are green.</div>
    <div class="steps">
      <div class="step"><div class="n">1</div><b>Add execution app skeleton</b><span>Create the server namespace, AppConfig receiver import, and settings registration.</span></div>
      <div class="step"><div class="n">2</div><b>Define state vocabulary</b><span>One task, phase implement, statuses idle, running, done, failed, plus run id and error.</span></div>
      <div class="step"><div class="n">3</div><b>Implement reducer</b><span>Map execute, launch success, launch failure, and completed state events to state changes and data actions.</span></div>
      <div class="step"><div class="n">4</div><b>Implement driver</b><span>Validate task, derive launch facts, initialize registry before launch, call spawn_run, and store result.</span></div>
      <div class="step"><div class="n">5</div><b>Connect receiver</b><span>Filter by active task id and completed group, then flip running to done through the reducer.</span></div>
      <div class="step"><div class="n">6</div><b>Narrow failures</b><span>Record launch failures, swallow receiver errors, and defer retries, cancellation, stalls, and idempotency.</span></div>
      <div class="step"><div class="n">7</div><b>Test harness</b><span>Use reducer unit tests, mocked spawn_run driver tests, and direct signal emission receiver tests.</span></div>
      <div class="step"><div class="n">8</div><b>Parent note</b><span>Record the accepted orchestrator-home decision in #700 design context during implementation.</span></div>
    </div>
  </section>

  <section id="tests">
    <h2>Implementation harness</h2>
    <div class="lede">Validation proves the loop without starting a real agent, tmux session, or graph executor.</div>
    <div class="grid2">
      <div class="card">
        <h3>Reducer tests</h3>
        <ul class="list">
          <li>Execute requested produces one launch action from idle.</li>
          <li>Run started records agent run id and marks running.</li>
          <li>Run failed records error and marks failed.</li>
          <li>Matching completed event marks running state done.</li>
          <li>Unrelated issue ids and non-completed groups are ignored.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Django boundary tests</h3>
        <ul class="list">
          <li>Driver loads a task and calls mocked <span class="m">spawn_run</span> exactly once.</li>
          <li>Driver initializes state before launch and returns running state after success.</li>
          <li>Launch failure stores failed state and leaves no running active execution.</li>
          <li>Receiver flips a seeded running task to done on direct seam emission.</li>
          <li>Receiver ignores unknown tasks and swallows unexpected errors.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="risks">
    <h2>Failure matrix</h2>
    <div class="lede">Everything not required by the tracer is deliberately bounded or deferred.</div>
    <details open><summary>Launch-time cases</summary>
      <table>
        <tbody>
          <tr><td>Missing or non-task issue</td><td>No launch. Driver returns or raises the existing internal validation style.</td></tr>
          <tr><td>Caller omits agent</td><td>Programmer error. No default is supplied by execution.</td></tr>
          <tr><td>Missing launch facts</td><td>No launch. Failure is recorded before reaching <span class="m">spawn_run</span>.</td></tr>
          <tr><td><span class="m">spawn_run</span> raises</td><td>State becomes failed with error text. Retries are out of scope.</td></tr>
        </tbody>
      </table>
    </details>
    <details><summary>Observation cases</summary>
      <table>
        <tbody>
          <tr><td>Unrelated task completes</td><td>Active state is unchanged.</td></tr>
          <tr><td>Same task moves to backlog, unstarted, started, or cancelled</td><td>State remains running.</td></tr>
          <tr><td>Same task moves to completed</td><td>State becomes done.</td></tr>
          <tr><td>Completion arrives after done</td><td>State remains done.</td></tr>
        </tbody>
      </table>
    </details>
    <details><summary>Deferred cases</summary>
      <table>
        <tbody>
          <tr><td>Server restart while running</td><td>Process-local state is lost. Recovery is out of scope.</td></tr>
          <tr><td>Agent exits without marking completed</td><td>State remains running. Process-exit observation is out of scope.</td></tr>
          <tr><td>Duplicate execute for same task</td><td>Idempotency policy is deferred to later tracer work unless implementation finds an existing local guard.</td></tr>
        </tbody>
      </table>
    </details>
  </section>

  <section id="accept">
    <h2>Acceptance signal</h2>
    <div class="accept"><b>Ready for implementation when accepted:</b> #716 adds only a server-side, process-local one-task tracer. The internal execute callable launches one implement run through #715 <span class="m">spawn_run</span>, records the returned run id, observes <span class="m">issue_state_changed</span>, and flips running to done only when that same task enters completed. No durable orchestration table, graph traversal, retries, cancellation, public trigger, or UI work is included.</div>
  </section>
</main>
<script>
  const data = {
    caller: {
      title: "Internal caller",
      tag: "entrypoint",
      yes: ["Passes task id and agent explicitly.", "Accepts recipe implement as fixed policy for this slice."],
      no: ["Does not receive an HTTP, MCP, Studio, or CLI surface in #716."]
    },
    driver: {
      title: "Execution driver",
      tag: "server app",
      yes: ["Loads and validates the WorkTracker task.", "Initializes registry before launch.", "Calls spawn_run and stores the returned run id.", "Returns current engine state."],
      no: ["Does not poll AgentRun or infer completion from process exit.", "Does not own agent defaulting."]
    },
    spawn: {
      title: "spawn_run",
      tag: "prerequisite seam",
      yes: ["Provides the programmatic launch surface from #715.", "Owns command construction and lower-level launch use."],
      no: ["Not implemented by #716.", "Not bypassed by calling _launch directly."]
    },
    reducer: {
      title: "Pure reducer",
      tag: "transition core",
      yes: ["Receives state plus event.", "Returns next state plus data-only actions.", "Handles execute requested, run started, run failed, and issue state changed."],
      no: ["No database, signal, tmux, async scheduling, logging side effects, or WorkTracker writes."]
    },
    registry: {
      title: "Local registry",
      tag: "process memory",
      yes: ["Stores active one-task execution state keyed by task id.", "Keeps run id and error text with the state."],
      no: ["No migration, restart recovery, or durable history."]
    },
    signal: {
      title: "issue_state_changed receiver",
      tag: "completion observer",
      yes: ["Filters by active task id.", "Treats only to_group completed as done.", "Swallows unexpected errors so WorkTracker saves are not broken."],
      no: ["Never synchronously mutates Issue.state.", "Does not integrate worktrees or release dependency chains."]
    }
  };
  const info = document.getElementById("nodeInfo");
  function selectNode(key) {
    const item = data[key] || data.driver;
    document.querySelectorAll(".node").forEach(n => n.classList.toggle("selected", n.dataset.node === key));
    document.querySelectorAll("tr[data-node]").forEach(r => r.classList.toggle("hl", r.dataset.node === key));
    info.innerHTML = `<h3>${item.title}</h3><span class="tag">${item.tag}</span><ul>${item.yes.map(x => `<li>${x}</li>`).join("")}${item.no.map(x => `<li class="no">${x}</li>`).join("")}</ul>`;
  }
  document.querySelectorAll("[data-node]").forEach(el => el.addEventListener("click", () => selectNode(el.dataset.node)));
  const links = [...document.querySelectorAll("nav a")];
  const sections = links.map(a => document.querySelector(a.getAttribute("href")));
  function onScroll() {
    let active = 0;
    sections.forEach((s, i) => { if (s.getBoundingClientRect().top <= 90) active = i; });
    links.forEach((a, i) => a.classList.toggle("active", i === active));
  }
  document.addEventListener("scroll", onScroll, { passive: true });
  selectNode("driver");
</script>
</body>
</html>
