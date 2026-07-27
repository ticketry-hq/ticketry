<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>T719 · Planning Tracer 4 — LLD</title>
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
  .crumb { color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
  h1 { margin: 6px 0 4px; font-size: 23px; line-height: 1.2; }
  .sub { max-width: 980px; color: var(--muted); font-size: 14px; }
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
  .lede { margin: 0 0 18px; max-width: 900px; color: var(--muted); font-size: 14px; }
  .m { font-family: var(--mono); font-size: 12.5px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card, .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; }
  .card h3 { margin: 0 0 10px; font-size: 15px; }
  .list { list-style: none; margin: 0; padding: 0; }
  .list li { position: relative; padding: 6px 0 6px 20px; border-bottom: 1px dashed var(--line); font-size: 13.5px; }
  .list li:last-child { border-bottom: 0; }
  .list li:before { content: "•"; position: absolute; left: 3px; color: var(--accent); font-weight: 900; }
  .list li.no:before { content: "x"; color: var(--red); }
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
  .side li.no:before { content: "x"; color: var(--red); }
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
  .pill.def { background: var(--red-soft); color: var(--red); }
  .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .step { background: var(--panel); border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: 8px; padding: 13px 14px; min-height: 132px; }
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
  <div class="crumb">Coding · WorkTracker module · Ticket #719 · LLD</div>
  <h1>Planning Tracer 4 — Refine One Idea</h1>
  <div class="sub">Low-level plan to extend the #716 execution tracer with a second phase: launch one human-interactive refine run for a Backlog task, then mark the local refine state done only when the same task is observed moving from Backlog to Todo.</div>
  <div class="chips">
    <span class="chip">Phase: Todo to LLD review</span>
    <span class="chip green">No implementation in this phase</span>
    <span class="chip amber">Extends #716 reducer and driver</span>
    <span class="chip violet">No DB table · no endpoint · no new UI in #719</span>
  </div>
</header>
<nav id="nav">
  <a href="#scope" class="active">Scope</a>
  <a href="#diagram">Execution Loop</a>
  <a href="#visibility">Visibility</a>
  <a href="#map">Change Map</a>
  <a href="#contracts">Contracts</a>
  <a href="#steps">Steps</a>
  <a href="#tests">Harness</a>
  <a href="#edges">Edges</a>
  <a href="#accept">Acceptance</a>
</nav>
<main>
  <section id="scope">
    <h2>Scope lock</h2>
    <div class="lede">This slice proves one planning phase only. The engine starts refinement and observes the canonical state-change seam; it does not inspect artifacts or start the next phase.</div>
    <div class="grid2">
      <div class="card">
        <h3>Build</h3>
        <ul class="list">
          <li>Add <span class="m">refine</span> beside <span class="m">implement</span> in the existing execution state vocabulary.</li>
          <li>Generalize reducer completion through a per-phase contract table.</li>
          <li>Launch the <span class="m">refine</span> recipe only for a task currently in the <span class="m">backlog</span> group.</li>
          <li>Build the refine launch prompt from task context and the existing Backlog-agent launch flow.</li>
          <li>Observe <span class="m">issue_state_changed</span> with strict <span class="m">from_group=backlog</span> and <span class="m">to_group=unstarted</span>.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Do not build</h3>
        <ul class="list">
          <li class="no">No split decision, recursion, graph traversal, or phase-two cascade.</li>
          <li class="no">No durable execution table, restart recovery, timeout, or orphan handling.</li>
          <li class="no">No engine mutation of <span class="m">Issue.state</span>; agent or human moves Backlog to Todo.</li>
          <li class="no">No HLD existence check before completion counts.</li>
          <li class="no">No new public HTTP route, MCP tool, Studio action, CLI, UI surface, or agent default policy in #719. CODIN-746 later adds the explicit drawer button bridge without changing this primitive.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="diagram">
    <h2>Execution loop</h2>
    <div class="lede">Click a node to see responsibilities. Dashed boxes are seams or future phases that this slice observes but does not own.</div>
    <div class="diagram">
      <svg viewBox="0 0 850 500" role="img" aria-label="Refine tracer component diagram">
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L9,3 z" fill="#7f8aa3"></path>
          </marker>
        </defs>
        <path class="edge" d="M135 100 C215 100 225 100 295 100"></path>
        <path class="edge" d="M475 100 C560 100 570 100 640 100"></path>
        <path class="edge" d="M390 145 C390 205 390 220 390 270"></path>
        <path class="edge" d="M390 350 C390 405 390 415 390 448"></path>
        <path class="edge" d="M270 310 C210 310 190 310 135 310"></path>
        <path class="edge deferred" d="M690 138 C660 222 580 285 510 307"></path>
        <path class="edge deferred" d="M604 448 C670 448 690 420 700 360"></path>
        <g class="node" data-node="caller" transform="translate(38 64)">
          <ellipse cx="72" cy="36" rx="72" ry="36"></ellipse>
          <text x="72" y="41" text-anchor="middle">Internal caller</text>
        </g>
        <g class="node" data-node="driver" transform="translate(295 58)">
          <rect width="180" height="86" rx="8"></rect>
          <text x="90" y="34" text-anchor="middle">Execution driver</text>
          <text x="90" y="55" text-anchor="middle" fill="#5b6478">phase · gate · launch</text>
        </g>
        <g class="node deferred" data-node="spawn" transform="translate(640 66)">
          <rect width="160" height="72" rx="8"></rect>
          <text x="80" y="31" text-anchor="middle">spawn_run</text>
          <text x="80" y="52" text-anchor="middle" fill="#5b6478">existing launch seam</text>
        </g>
        <g class="node" data-node="reducer" transform="translate(270 270)">
          <rect width="240" height="80" rx="8"></rect>
          <text x="120" y="31" text-anchor="middle">Phase reducer</text>
          <text x="120" y="52" text-anchor="middle" fill="#5b6478">implement + refine</text>
        </g>
        <g class="node" data-node="registry" transform="translate(24 278)">
          <rect width="168" height="66" rx="8"></rect>
          <text x="84" y="30" text-anchor="middle">Local registry</text>
          <text x="84" y="49" text-anchor="middle" fill="#5b6478">keyed by task id</text>
        </g>
        <g class="node deferred" data-node="agent" transform="translate(628 286)">
          <rect width="150" height="74" rx="8"></rect>
          <text x="75" y="31" text-anchor="middle">Grill agent</text>
          <text x="75" y="52" text-anchor="middle" fill="#5b6478">or human move</text>
        </g>
        <g class="node" data-node="signal" transform="translate(270 428)">
          <rect width="244" height="48" rx="8"></rect>
          <text x="122" y="30" text-anchor="middle">issue_state_changed</text>
        </g>
        <g class="node deferred" data-node="next" transform="translate(618 428)">
          <rect width="170" height="48" rx="8"></rect>
          <text x="85" y="30" text-anchor="middle">#720 / #721</text>
        </g>
      </svg>
      <div class="panel side" id="nodeInfo">
        <h3>Execution driver</h3>
        <span class="tag">selected</span>
        <ul>
          <li>Accepts explicit task id, agent, and phase.</li>
          <li>Validates refine starts only from Backlog.</li>
          <li>Applies launch actions through <span class="m">spawn_run</span>.</li>
          <li class="no">Does not expose a user trigger or choose a default agent.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="visibility">
    <h2>Visibility contract</h2>
    <div class="lede">This slice does not add a new UI, but the operator should still know where to look when refinement is launched.</div>
    <div class="grid2">
      <div class="card">
        <h3>Where the grill appears</h3>
        <ul class="list">
          <li>The grill run uses the existing Backlog-item agent launch flow: the same operator path as starting an agent run from a Backlog task.</li>
          <li>The human answers in the existing agent terminal/tmux session attached to that task's run.</li>
          <li>The run remains visible through the current Coding app run and terminal surfaces that already attach to launched task runs.</li>
          <li>The task board shows the user-visible completion signal when the task moves from Backlog to Todo.</li>
        </ul>
      </div>
      <div class="card">
        <h3>What this slice does not add</h3>
        <ul class="list">
          <li class="no">No new Backlog button, command palette action, or dedicated refinement panel.</li>
          <li class="no">No engine-specific progress dashboard beyond the existing run record and terminal attach flow.</li>
          <li class="no">No UI affordance for split, cascade, or HLD artifact validation; those belong to later planning tracer slices.</li>
          <li class="no">No special waiting state in the UI; a grill waiting on the human is still a running agent run.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="map">
    <h2>File change map</h2>
    <div class="lede">The local repo already contains #707 <span class="m">spawn_run</span> and the #716 <span class="m">apps/execution</span> package. This ticket modifies those seams rather than recreating them.</div>
    <table>
      <thead><tr><th>File</th><th>Kind</th><th>Exact delta</th></tr></thead>
      <tbody>
        <tr data-node="reducer"><td><span class="m">../server/apps/execution/state.py</span></td><td><span class="pill mod">modify</span></td><td>Extend phase and recipe vocabulary to include <span class="m">refine</span>; carry <span class="m">from_group</span> on state-change events.</td></tr>
        <tr data-node="reducer"><td><span class="m">../server/apps/execution/reducer.py</span></td><td><span class="pill mod">modify</span></td><td>Replace implement-only completion logic with a per-phase contract table for recipe and completion gate.</td></tr>
        <tr data-node="driver"><td><span class="m">../server/apps/execution/driver.py</span></td><td><span class="pill mod">modify</span></td><td>Allow internal callers to select <span class="m">refine</span>; validate current task group is <span class="m">backlog</span>; pass recipe prompt into launch.</td></tr>
        <tr data-node="signal"><td><span class="m">../server/apps/execution/signals.py</span></td><td><span class="pill mod">modify</span></td><td>Forward both <span class="m">from_group</span> and <span class="m">to_group</span> into the driver observer.</td></tr>
        <tr data-node="driver"><td><span class="m">../server/apps/execution/recipes.py</span></td><td><span class="pill new">new</span></td><td>Centralize recipe facts: implement remains unchanged; refine builds the stopgap grill prompt from task context.</td></tr>
        <tr data-node="reducer"><td><span class="m">../server/apps/execution/tests/test_reducer.py</span></td><td><span class="pill mod">modify</span></td><td>Add reducer coverage for refine launch, run-started, run-failed, strict completion, ignored events, and done idempotence.</td></tr>
        <tr data-node="driver"><td><span class="m">../server/apps/execution/tests/test_driver.py</span></td><td><span class="pill mod">modify</span></td><td>Assert Backlog launch gate, non-Backlog rejection, recipe prompt threading, and process-local state update.</td></tr>
        <tr data-node="signal"><td><span class="m">../server/apps/execution/tests/test_signals.py</span></td><td><span class="pill mod">modify</span></td><td>Assert the receiver preserves <span class="m">from_group</span> so the refine gate can distinguish Backlog-to-Todo from reopen-to-Todo.</td></tr>
        <tr data-node="spawn"><td><span class="m">../server/apps/terminals/launch.py</span></td><td><span class="pill ro">read-only</span></td><td>Existing <span class="m">spawn_run</span> launch boundary. This slice calls it; it does not change launch plumbing.</td></tr>
        <tr data-node="signal"><td><span class="m">worktracker/worktracker/signals.py</span></td><td><span class="pill ro">read-only</span></td><td>Existing #706 seam with <span class="m">from_group</span> and <span class="m">to_group</span>. This slice observes it; it does not alter WorkTracker state.</td></tr>
      </tbody>
    </table>
  </section>

  <section id="contracts">
    <h2>Decision contracts</h2>
    <div class="lede">Implementation follows these choices without reopening scope.</div>
    <table>
      <thead><tr><th>Contract</th><th>Decision</th><th>Reason</th></tr></thead>
      <tbody>
        <tr data-node="driver"><td>Driver home</td><td><span class="m">../server/apps/execution</span></td><td>Same Django process as WorkTracker, <span class="m">spawn_run</span>, <span class="m">AgentRun</span>, and tmux session creation.</td></tr>
        <tr data-node="caller"><td>Entrypoint</td><td>Internal callable accepts task id, agent, and selected phase.</td><td>This slice adds no public trigger surface and owns no agent defaulting policy.</td></tr>
        <tr data-node="reducer"><td>Reducer shape</td><td>One pure reducer with a phase contract table.</td><td>Refine and implement coexist additively; no forked reducer branch.</td></tr>
        <tr data-node="driver"><td>Refine recipe</td><td>Stopgap grill prompt using the existing Backlog-agent launch flow.</td><td>The recipe can evolve without binding the engine to a literal skill command contract.</td></tr>
        <tr data-node="driver"><td>Launch gate</td><td>Refine launches only when the target task is in <span class="m">backlog</span>.</td><td>Already-defined work should not be sent through refinement again in this slice.</td></tr>
        <tr data-node="signal"><td>Completion gate</td><td>Matching task id plus <span class="m">from_group=backlog</span> and <span class="m">to_group=unstarted</span>.</td><td>A reopen or unrelated state move must not complete refinement.</td></tr>
        <tr data-node="registry"><td>Run state</td><td>Process-local statuses remain <span class="m">idle</span>, <span class="m">running</span>, <span class="m">done</span>, <span class="m">failed</span>.</td><td>A human-paced grill can remain running indefinitely; no stall semantics.</td></tr>
        <tr data-node="next"><td>Stop point</td><td>After done, stop. No HLD validation or auto-cascade.</td><td>#720 and #721 own artifact consumption, split decision, recursion, and trigger surface.</td></tr>
      </tbody>
    </table>
  </section>

  <section id="steps">
    <h2>Decision-complete steps</h2>
    <div class="lede">Build order for the implementation phase after this LLD is accepted.</div>
    <div class="steps">
      <div class="step"><div class="n">1</div><b>Extend state vocabulary</b><span>Add refine as a supported phase and carry source and destination groups through seam events.</span></div>
      <div class="step"><div class="n">2</div><b>Introduce phase contracts</b><span>Move recipe name and completion predicate into a table that preserves implement behavior and adds refine.</span></div>
      <div class="step"><div class="n">3</div><b>Add recipe facts</b><span>Create a recipe helper that returns the existing implement behavior and a refine prompt with task id, key, title, description, and project.</span></div>
      <div class="step"><div class="n">4</div><b>Gate refine launch</b><span>In the driver, resolve the task's current state group and reject refine unless it is Backlog.</span></div>
      <div class="step"><div class="n">5</div><b>Thread launch payload</b><span>Call <span class="m">spawn_run</span> with recipe <span class="m">refine</span> and the grill prompt while preserving explicit agent selection.</span></div>
      <div class="step"><div class="n">6</div><b>Observe strict completion</b><span>Forward <span class="m">from_group</span> and <span class="m">to_group</span> from the receiver; mark done only for active Backlog-to-Todo events.</span></div>
      <div class="step"><div class="n">7</div><b>Keep done stable</b><span>Make duplicate or late matching completion events leave state done; ignore all non-matching events.</span></div>
      <div class="step"><div class="n">8</div><b>Lock tests</b><span>Focus reducer tests on pure input-output behavior and driver tests on gates and port calls, with no real agent or tmux.</span></div>
    </div>
  </section>

  <section id="tests">
    <h2>Implementation harness</h2>
    <div class="lede">The reducer remains the main test seam. Driver and receiver tests only prove boundary adaptation.</div>
    <div class="grid2">
      <div class="card">
        <h3>Reducer tests</h3>
        <ul class="list">
          <li>Execute refine from idle produces exactly one launch action with recipe <span class="m">refine</span>.</li>
          <li>Run started records agent run id and marks status <span class="m">running</span>.</li>
          <li>Run failed records error text and marks status <span class="m">failed</span>.</li>
          <li>Matching <span class="m">backlog</span> to <span class="m">unstarted</span> event for the active task marks refine <span class="m">done</span>.</li>
          <li>Completion after <span class="m">done</span> leaves the state unchanged.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Negative tests</h3>
        <ul class="list">
          <li>Unrelated task id is ignored.</li>
          <li>Destination group other than <span class="m">unstarted</span> is ignored for refine.</li>
          <li><span class="m">to_group=unstarted</span> with <span class="m">from_group</span> not Backlog is ignored.</li>
          <li>Non-Backlog refine launch does not call <span class="m">spawn_run</span>.</li>
          <li>Receiver does not mutate WorkTracker state or launch a follow-up phase.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="edges">
    <h2>Failure and edge matrix</h2>
    <div class="lede">These outcomes are intentionally narrow for tracer value.</div>
    <table>
      <thead><tr><th>Situation</th><th>Expected behavior</th><th>Owner</th></tr></thead>
      <tbody>
        <tr><td>Task is not in Backlog at refine launch</td><td>Reject in #716's existing validation style; no launch action reaches <span class="m">spawn_run</span>.</td><td>#719</td></tr>
        <tr><td><span class="m">spawn_run</span> raises</td><td>Reducer records <span class="m">failed</span> with error text.</td><td>#719</td></tr>
        <tr><td>Agent waits on human input</td><td>Registry remains <span class="m">running</span>; no timeout or awaiting-input state.</td><td>Deferred</td></tr>
        <tr><td>Human moves task Backlog to Todo</td><td>Actor-agnostic seam event completes refine.</td><td>#719</td></tr>
        <tr><td>Agent writes no HLD but task reaches Todo</td><td>Refine still completes; HLD artifact checking is deferred to the consumer boundary.</td><td>#720</td></tr>
        <tr><td>Server restarts during the grill</td><td>Process-local registry is lost; durable <span class="m">AgentRun</span> and tmux are outside this engine state.</td><td>Deferred</td></tr>
        <tr><td>Task reaches Todo after registry loss</td><td>No local reaction occurs in this slice; downstream chaining is not present yet.</td><td>#721</td></tr>
      </tbody>
    </table>
  </section>

  <section id="accept">
    <h2>Acceptance signal</h2>
    <div class="lede">The LLD is ready for implementation when these statements are acceptable.</div>
    <div class="accept">
      <b>Green signal:</b> the accepted implementation will launch one refine recipe for one Backlog task, record the run in process-local state, mark it failed on launch failure, mark it done only on the active task's observed Backlog-to-Todo transition, and stop without graph traversal, artifact validation, or phase-two cascade.
    </div>
  </section>
</main>
<script>
const nodeInfo = {
  caller: {
    h: "Internal caller",
    items: [
      ["Passes task id, agent, and phase explicitly."],
      ["May choose codex or another agent at its own call site."],
      ["Does not get a new public API, MCP tool, Studio action, or CLI in this slice.", true]
    ]
  },
  driver: {
    h: "Execution driver",
    items: [
      ["Accepts explicit task id, agent, and phase."],
      ["Validates refine starts only from Backlog."],
      ["Applies launch actions through spawn_run."],
      ["Does not expose a user trigger or choose a default agent.", true]
    ]
  },
  spawn: {
    h: "spawn_run",
    items: [
      ["Starts the coding-agent tmux run and returns the run id."],
      ["Receives the refine prompt as initial launch context."],
      ["Is reused as a port; launch plumbing is not changed here.", true]
    ]
  },
  reducer: {
    h: "Phase reducer",
    items: [
      ["Keeps decide(state, event) pure, synchronous, and I/O-free."],
      ["Uses per-phase completion gates for implement and refine."],
      ["Does not inspect Django models, tmux sessions, or HLD files.", true]
    ]
  },
  registry: {
    h: "Local registry",
    items: [
      ["Stores one active engine state per task id."],
      ["Carries running, done, failed, run id, and error."],
      ["Does not survive process restart.", true]
    ]
  },
  agent: {
    h: "Grill agent",
    items: [
      ["Runs the stopgap relentless-questioning refine prompt."],
      ["Can write the intended visual HLD and move the task to Todo."],
      ["Is not required for completion if a human performs the move.", true]
    ]
  },
  signal: {
    h: "issue_state_changed",
    items: [
      ["Provides issue id, project id, old and new state ids, from group, and to group."],
      ["Completes refine only for the active task moving Backlog to Todo."],
      ["Must not synchronously mutate Issue.state from the receiver.", true]
    ]
  },
  next: {
    h: "#720 / #721",
    items: [
      ["Own artifact consumption, split decision, recursion, and full cascade."],
      ["May later depend on refine done as a phase boundary."],
      ["Are not triggered from #719.", true]
    ]
  }
};
function renderNode(id) {
  const info = nodeInfo[id];
  if (!info) return;
  document.querySelectorAll(".node").forEach(n => n.classList.toggle("selected", n.dataset.node === id));
  document.querySelectorAll("tr[data-node]").forEach(r => r.classList.toggle("hl", r.dataset.node === id));
  const lis = info.items.map(([text, no]) => `<li class="${no ? "no" : ""}">${text}</li>`).join("");
  document.getElementById("nodeInfo").innerHTML = `<h3>${info.h}</h3><span class="tag">selected</span><ul>${lis}</ul>`;
}
document.querySelectorAll(".node").forEach(n => n.addEventListener("click", () => renderNode(n.dataset.node)));
document.querySelectorAll("tr[data-node]").forEach(r => r.addEventListener("click", () => renderNode(r.dataset.node)));
const navLinks = [...document.querySelectorAll("nav a")];
const sections = navLinks.map(a => document.querySelector(a.getAttribute("href")));
addEventListener("scroll", () => {
  let active = 0;
  sections.forEach((s, i) => { if (s.getBoundingClientRect().top < 92) active = i; });
  navLinks.forEach((a, i) => a.classList.toggle("active", i === active));
}, { passive: true });
renderNode("driver");
</script>
</body>
</html>
