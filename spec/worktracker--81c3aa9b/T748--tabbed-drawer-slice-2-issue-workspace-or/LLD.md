<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CODIN-748 · Issue Workspace Orchestration Seam · LLD</title>
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
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--ink);
    font: 15px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    padding-bottom: 72px;
  }
  header {
    background: var(--panel);
    padding: 26px 40px 16px;
    border-bottom: 1px solid var(--line);
  }
  .crumb { color: var(--muted); font-size: 12px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  h1 { font-size: 23px; margin: 6px 0 4px; letter-spacing: 0; }
  .sub { color: var(--muted); max-width: 930px; font-size: 14px; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin: 13px 0 14px; }
  .chip { border-radius: 20px; padding: 3px 10px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 700; }
  .chip.green { background: var(--green-soft); color: var(--green); }
  .chip.amber { background: var(--amber-soft); color: var(--amber); }
  .chip.violet { background: var(--violet-soft); color: var(--violet); }
  nav { position: sticky; top: 0; z-index: 20; display: flex; gap: 2px; overflow-x: auto; background: var(--panel); border-bottom: 1px solid var(--line); padding: 0 40px; }
  nav a { padding: 9px 14px; border-bottom: 2px solid transparent; color: var(--muted); text-decoration: none; white-space: nowrap; font-size: 13px; font-weight: 700; }
  nav a.active, nav a:hover { color: var(--accent); border-bottom-color: var(--accent); }
  main { max-width: 1180px; margin: 0 auto; padding: 34px 40px; }
  section { margin-bottom: 54px; scroll-margin-top: 58px; }
  h2 { font-size: 18px; margin-bottom: 4px; letter-spacing: 0; }
  .lede { color: var(--muted); font-size: 14px; margin-bottom: 18px; max-width: 880px; }
  .m { font-family: var(--mono); font-size: 12.5px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 18px 20px; }
  .card h3 { font-size: 15px; margin-bottom: 8px; }
  .card ul { list-style: none; }
  .card li { position: relative; padding: 4px 0 4px 18px; font-size: 13.5px; }
  .card li:before { content: ">"; position: absolute; left: 0; color: var(--accent); font-weight: 800; }
  .diagram { display: grid; grid-template-columns: 1fr 330px; gap: 18px; align-items: stretch; }
  .svgbox, .side, table, .steps, .accept { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
  .svgbox { padding: 16px; overflow-x: auto; }
  .node { cursor: pointer; }
  .node rect, .node ellipse { transition: stroke-width .12s, filter .12s; }
  .node.sel rect, .node.sel ellipse { stroke-width: 3; filter: drop-shadow(0 2px 3px rgba(53,86,212,.2)); }
  .side { padding: 18px 20px; font-size: 13px; }
  .side h3 { font-size: 15px; color: var(--accent); margin-bottom: 6px; }
  .side .tag { display: inline-block; margin-bottom: 10px; border-radius: 12px; padding: 2px 8px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 800; letter-spacing: .04em; }
  .side .k { margin: 11px 0 3px; color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
  .side li { margin-left: 17px; padding: 2px 0; }
  .side .no li { color: var(--red); }
  table { width: 100%; border-collapse: collapse; overflow: hidden; }
  th, td { border-bottom: 1px solid var(--line); padding: 10px 13px; text-align: left; vertical-align: top; font-size: 13px; }
  th { background: #fbfcfe; color: var(--muted); font-size: 12px; letter-spacing: .05em; text-transform: uppercase; }
  tr:last-child td { border-bottom: none; }
  tr[data-node] { cursor: pointer; }
  tr.hl td { background: var(--accent-soft); }
  .pill { display: inline-block; border-radius: 12px; padding: 2px 8px; font-size: 11px; font-weight: 800; }
  .pill.new { background: var(--green-soft); color: var(--green); }
  .pill.mod { background: var(--amber-soft); color: var(--amber); }
  .pill.ro { background: var(--accent-soft); color: var(--accent); }
  .pill.none { background: var(--red-soft); color: var(--red); }
  .seq { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
  .step { background: var(--panel); border: 1px solid var(--line); border-top: 3px solid var(--accent); border-radius: 8px; padding: 13px 14px; font-size: 12.5px; color: var(--muted); }
  .step .n { color: var(--accent); font-weight: 900; font-size: 18px; }
  .step b { display: block; color: var(--ink); margin: 1px 0 4px; font-size: 13px; }
  .status { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  .status .card { border-top: 3px solid var(--violet); }
  .accept { padding: 20px 24px; background: var(--green-soft); border-color: #cfe5d8; font-size: 14px; }
  .accept b { color: var(--green); }
  @media (max-width: 900px) {
    header, main { padding-left: 18px; padding-right: 18px; }
    nav { padding: 0 18px; }
    .grid2, .diagram, .seq, .status { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<header>
  <div class="crumb">Coding · WorkTracker · CODIN-748 · LLD</div>
  <h1>Tabbed Drawer Slice 2: Issue Workspace Orchestration Seam</h1>
  <div class="sub">Create the drawer-facing boundary that starts from an issue id or key and returns context, profile readiness, docs, terminal sessions, launch context, and restorable tab state without repointing the background Studio or Coding selection.</div>
  <div class="chips">
    <span class="chip">Phase: LLD draft</span>
    <span class="chip green">Frontend orchestration only</span>
    <span class="chip violet">No backend model or migration</span>
    <span class="chip amber">No doc or terminal rendering</span>
  </div>
</header>
<nav id="nav">
  <a href="#shape" class="active">Shape</a>
  <a href="#contract">Contract</a>
  <a href="#map">Change Map</a>
  <a href="#sequence">Hydration</a>
  <a href="#decisions">Decisions</a>
  <a href="#states">States</a>
  <a href="#tests">Tests</a>
  <a href="#order">Steps</a>
  <a href="#accept">Acceptance</a>
</nav>
<main>
  <section id="shape">
    <h2>System shape</h2>
    <div class="lede">Click a node to see what it owns. Dashed components are seam-only surfaces for later drawer slices.</div>
    <div class="diagram">
      <div class="svgbox">
        <svg viewBox="0 0 900 450" width="100%" height="430" role="img" aria-label="Issue drawer orchestration boundary diagram">
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#5b6478"></path>
            </marker>
          </defs>
          <g class="node" data-node="drawer">
            <ellipse cx="84" cy="96" rx="62" ry="34" fill="#e8edfb" stroke="#3556d4" stroke-width="2"></ellipse>
            <text x="84" y="92" text-anchor="middle" font-size="13" font-weight="700" fill="#1d2433">Drawer UI</text>
            <text x="84" y="110" text-anchor="middle" font-size="11" fill="#5b6478">issue key only</text>
          </g>
          <g class="node" data-node="hook">
            <rect x="210" y="54" width="190" height="84" rx="8" fill="#ffffff" stroke="#3556d4" stroke-width="2"></rect>
            <text x="305" y="88" text-anchor="middle" font-size="13" font-weight="700">useIssueDrawerWorkspace</text>
            <text x="305" y="108" text-anchor="middle" font-size="11" fill="#5b6478">drawer seam and view model</text>
          </g>
          <g class="node" data-node="store">
            <rect x="472" y="38" width="210" height="116" rx="8" fill="#ffffff" stroke="#6b3fb8" stroke-width="2"></rect>
            <text x="577" y="70" text-anchor="middle" font-size="13" font-weight="700">drawerWorkspaceStore</text>
            <text x="577" y="90" text-anchor="middle" font-size="11" fill="#5b6478">issue-key orchestration</text>
            <text x="577" y="110" text-anchor="middle" font-size="11" fill="#5b6478">resource status per family</text>
            <text x="577" y="130" text-anchor="middle" font-size="11" fill="#5b6478">session-only tab restore</text>
          </g>
          <g class="node" data-node="issue">
            <rect x="212" y="228" width="182" height="74" rx="8" fill="#ffffff" stroke="#1d7a4f" stroke-width="2"></rect>
            <text x="303" y="258" text-anchor="middle" font-size="13" font-weight="700">WorkTracker reads</text>
            <text x="303" y="278" text-anchor="middle" font-size="11" fill="#5b6478">issue detail + scope context</text>
          </g>
          <g class="node" data-node="codingApi">
            <rect x="474" y="226" width="208" height="78" rx="8" fill="#ffffff" stroke="#1d7a4f" stroke-width="2"></rect>
            <text x="578" y="256" text-anchor="middle" font-size="13" font-weight="700">Coding host APIs</text>
            <text x="578" y="276" text-anchor="middle" font-size="11" fill="#5b6478">config, docs, terminals</text>
          </g>
          <g class="node" data-node="reuse">
            <rect x="728" y="54" width="142" height="86" rx="8" fill="#ffffff" stroke="#9a6700" stroke-width="2"></rect>
            <text x="799" y="84" text-anchor="middle" font-size="13" font-weight="700">Reuse stores</text>
            <text x="799" y="104" text-anchor="middle" font-size="11" fill="#5b6478">workspaceStore</text>
            <text x="799" y="122" text-anchor="middle" font-size="11" fill="#5b6478">terminalStore</text>
          </g>
          <g class="node" data-node="later">
            <rect x="730" y="226" width="142" height="78" rx="8" fill="#f0e9fb" stroke="#6b3fb8" stroke-width="2" stroke-dasharray="7 5"></rect>
            <text x="801" y="256" text-anchor="middle" font-size="13" font-weight="700">Later tabs</text>
            <text x="801" y="276" text-anchor="middle" font-size="11" fill="#5b6478">Docs + Terminal UI</text>
          </g>
          <path d="M145 96 H210" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="176" y="84" text-anchor="middle" font-size="11" fill="#5b6478">key/id</text>
          <path d="M400 96 H472" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <path d="M315 138 V228" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <path d="M578 154 V226" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <path d="M682 96 H728" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <path d="M682 264 H730" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <path d="M394 265 H474" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="434" y="252" text-anchor="middle" font-size="11" fill="#5b6478">resolved context</text>
          <rect x="24" y="358" width="846" height="50" rx="8" fill="#fbe7e7" stroke="#b03030"></rect>
          <text x="447" y="380" text-anchor="middle" font-size="13" font-weight="700" fill="#b03030">Forbidden side effect</text>
          <text x="447" y="399" text-anchor="middle" font-size="12" fill="#b03030">Drawer hydration must not call studioStore.selectProject or coding/tasksStore selectProject, selectModule, or selectTask.</text>
        </svg>
      </div>
      <aside class="side" id="nodeInfo">
        <h3>Select a node</h3>
        <span class="tag">Interactive map</span>
        <p>Click any diagram node for responsibilities and non-responsibilities.</p>
      </aside>
    </div>
  </section>

  <section id="contract">
    <h2>Boundary contract</h2>
    <div class="lede">The drawer consumes one hook/store API. Project, module, profile, docs, terminal sessions, and launch context stay behind the boundary.</div>
    <div class="grid2">
      <div class="card">
        <h3>Input</h3>
        <ul>
          <li>Only the drawer route issue id or key.</li>
          <li>Optional abort/refresh trigger owned by the hook.</li>
          <li>No project id, module id, profile id, worktree path, or selected Coding task prop.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Output view model</h3>
        <ul>
          <li>Canonical task, project, and best-known module context.</li>
          <li>Profile/API readiness with not-ready and error cases.</li>
          <li>Docs and terminal summaries with independent statuses.</li>
          <li>Issue-scoped launch context for later terminal slices.</li>
          <li>Effective active tab with Details fallback.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="map">
    <h2>Change map</h2>
    <div class="lede">This slice adds an orchestration harness and narrowly extracts read-only helpers. It does not render document iframes or xterm.</div>
    <table>
      <thead><tr><th>File</th><th>Kind</th><th>Delta</th><th>Out of scope guard</th></tr></thead>
      <tbody>
        <tr data-node="hook"><td><span class="m">studio/src/shell/useIssueDrawerWorkspace.ts</span></td><td><span class="pill new">new</span></td><td>Hook facade used by <span class="m">IssueDrawerHost</span> and later tab renderers.</td><td>No visual tab rendering logic.</td></tr>
        <tr data-node="store"><td><span class="m">studio/src/stores/issue/drawerWorkspaceStore.ts</span></td><td><span class="pill new">new</span></td><td>Issue-key hydration state, statuses, launch context, and active-tab fallback.</td><td>No durable persistence beyond browser memory.</td></tr>
        <tr data-node="issue"><td><span class="m">studio/src/stores/issue/issueWorkspaceContext.ts</span></td><td><span class="pill new">new</span></td><td>Resolve issue detail, task/project ids, ancestry hints, and optional scope context without writing Studio selection.</td><td>Do not call <span class="m">issueStore.openIssue</span> from workspace orchestration.</td></tr>
        <tr data-node="issue"><td><span class="m">studio/src/stores/issue/issueStore.ts</span></td><td><span class="pill mod">modified</span></td><td>Share the read-only issue-detail helper with the drawer seam, then keep existing Details mutation behavior isolated or replace its project-context load with a read-only equivalent.</td><td>Do not leave drawer open dependent on <span class="m">studioStore.selectProject</span>.</td></tr>
        <tr data-node="issue"><td><span class="m">studio/src/lib/api.ts</span></td><td><span class="pill mod">modified</span></td><td>Use existing <span class="m">fetchScopeContext</span> for ancestry/module hints where issue detail is insufficient.</td><td>No new backend route unless existing data cannot resolve context.</td></tr>
        <tr data-node="codingApi"><td><span class="m">studio/src/coding/lib/api.ts</span></td><td><span class="pill mod">modified</span></td><td>Keep host API helpers reusable by the drawer for config, docs, and terminal listing.</td><td>No dependency on selected Coding project/module/task.</td></tr>
        <tr data-node="reuse"><td><span class="m">studio/src/coding/stores/workspaceStore.ts</span></td><td><span class="pill ro">reused</span></td><td>Reuse per-task active tab, doc tab, dormant doc, history, and overlay state behind issue bucket ids.</td><td>No drawer-specific fork unless reuse creates selection side effects.</td></tr>
        <tr data-node="reuse"><td><span class="m">studio/src/coding/stores/terminalStore.ts</span></td><td><span class="pill mod">modified</span></td><td>If needed, add a read-returning session discovery action rather than only mutating internal state.</td><td>No xterm ownership behavior; CODIN-749 owns foreground rules.</td></tr>
        <tr data-node="drawer"><td><span class="m">studio/src/shell/IssueDrawerHost.tsx</span></td><td><span class="pill mod">modified</span></td><td>Call the hook with <span class="m">drawerKey</span> and pass tab state through the drawer boundary.</td><td>No project/module/profile props.</td></tr>
        <tr data-node="hook"><td><span class="m">studio/src/test/IssueDrawerWorkspace.test.tsx</span></td><td><span class="pill new">new</span></td><td>Focused orchestration tests for issue-only hydration and selection isolation.</td><td>No full Coding app mount required.</td></tr>
      </tbody>
    </table>
  </section>

  <section id="sequence">
    <h2>Hydration sequence</h2>
    <div class="lede">Decision-complete steps for the implementation harness. Resource discovery is scoped so one failed family does not poison the whole drawer.</div>
    <div class="seq">
      <div class="step"><div class="n">1</div><b>Drawer key arrives</b>Hook starts or refreshes an issue-key hydration run and ensures a workspace bucket can exist.</div>
      <div class="step"><div class="n">2</div><b>Issue resolves</b>Read WorkTracker issue detail by key/id through a read-only helper, then normalize the canonical task id and project id.</div>
      <div class="step"><div class="n">3</div><b>Module resolves</b>Prefer issue ancestry; fall back to scope context; expose degraded state if module remains unknown.</div>
      <div class="step"><div class="n">4</div><b>Profile loads</b>Load Coding config/profile readiness without selecting profile project/module or persisting recent state.</div>
      <div class="step"><div class="n">5</div><b>Resources discover</b>Fetch docs and terminal sessions independently using the resolved task context.</div>
      <div class="step"><div class="n">6</div><b>Tab restores</b>Return prior session tab only if its doc or terminal still exists; otherwise choose Details.</div>
    </div>
  </section>

  <section id="decisions">
    <h2>Implementation decisions</h2>
    <div class="lede">Rows highlight the matching diagram node. These decisions close the open refinement questions for the slice.</div>
    <table>
      <thead><tr><th>Decision</th><th>Chosen path</th><th>Reason</th></tr></thead>
      <tbody>
        <tr data-node="reuse"><td>Workspace state</td><td>Adapt <span class="m">coding/stores/workspaceStore</span> behind the drawer seam.</td><td>It already has Details fallback, doc tab restore, dormant docs, history chips, and overlay flags keyed by bucket.</td></tr>
        <tr data-node="store"><td>Drawer store</td><td>Add a thin drawer orchestration store, not a parallel workspace model.</td><td>The drawer needs hydration status and launch context, while the reusable workspace store owns tab memory.</td></tr>
        <tr data-node="issue"><td>Issue/context reads</td><td>Add a read-only resolver for issue detail plus module hints; the workspace seam does not call <span class="m">issueStore.openIssue</span>.</td><td>The current Details path mutates Studio selection, so orchestration needs a side-effect-free path.</td></tr>
        <tr data-node="issue"><td>Module source</td><td>Use issue detail ancestry first, then <span class="m">fetchScopeContext</span>, then explicit degraded module state.</td><td>Preserves read-only behavior and avoids relying on selected Studio or Coding modules.</td></tr>
        <tr data-node="codingApi"><td>Profile readiness</td><td>Load config/profile through existing config API without calling selection methods.</td><td>Readiness is required for later tabs, but opening the drawer must not update recent project/module state.</td></tr>
        <tr data-node="store"><td>Prior active tab</td><td>Session memory only.</td><td>Matches refinement; no local storage or reload persistence in this slice.</td></tr>
        <tr data-node="later"><td>Not-ready UX</td><td>Expose per-tab statuses; later tabs remain visible when applicable.</td><td>Profile/docs/terminal failures should render local status, not hide the whole workspace.</td></tr>
      </tbody>
    </table>
  </section>

  <section id="states">
    <h2>Status model</h2>
    <div class="lede">Each resource family reports independently. Details is always the stable fallback.</div>
    <div class="status">
      <div class="card"><h3>Context</h3><ul><li>idle, loading, ready, degraded, error.</li><li>Degraded means task/project known but module unresolved.</li></ul></div>
      <div class="card"><h3>Profile</h3><ul><li>loading, ready, not-ready, error.</li><li>Not-ready includes no selected usable profile or missing API key.</li></ul></div>
      <div class="card"><h3>Docs</h3><ul><li>loading, ready, empty, error.</li><li>Failures do not block terminal session discovery.</li></ul></div>
      <div class="card"><h3>Terminals</h3><ul><li>loading, ready, empty, error.</li><li>Failures do not block docs or Details.</li></ul></div>
    </div>
  </section>

  <section id="tests">
    <h2>Test plan</h2>
    <div class="lede">Tests target the seam directly and avoid mounting the whole <span class="m">/coding</span> app.</div>
    <table>
      <thead><tr><th>Coverage</th><th>Assertion</th><th>Likely test home</th></tr></thead>
      <tbody>
        <tr><td>Issue-only hydration</td><td>Given only <span class="m">CODIN-748</span> or a UUID, the hook resolves task, project, module status, launch context, docs, and sessions.</td><td><span class="m">IssueDrawerWorkspace.test.tsx</span></td></tr>
        <tr><td>Pre-Coding discovery</td><td>Docs and sessions fetch when Coding stores have no selected project/module/task.</td><td><span class="m">IssueDrawerWorkspace.test.tsx</span></td></tr>
        <tr><td>No selection mutation</td><td><span class="m">selectProject</span>, <span class="m">selectModule</span>, and <span class="m">selectTask</span> are not called, and profile recent ids are not patched.</td><td><span class="m">IssueDrawerWorkspace.test.tsx</span></td></tr>
        <tr><td>Scoped failures</td><td>Docs error leaves Details and terminal readiness available; terminal error leaves docs available.</td><td><span class="m">IssueDrawerWorkspace.test.tsx</span></td></tr>
        <tr><td>Active-tab fallback</td><td>Missing restored doc or terminal returns effective tab <span class="m">details</span>.</td><td><span class="m">workspaceStore</span> or seam tests</td></tr>
        <tr><td>Drawer host wiring</td><td><span class="m">IssueDrawerHost</span> starts hydration from <span class="m">drawerKey</span> and keeps existing Details rendering.</td><td><span class="m">IssueDrawerHost.test.tsx</span></td></tr>
      </tbody>
    </table>
  </section>

  <section id="order">
    <h2>Build order</h2>
    <div class="lede">Implementation should land in this order so each step is independently checkable.</div>
    <div class="seq">
      <div class="step"><div class="n">1</div><b>Types</b>Define drawer workspace view model, launch context, and resource status types.</div>
      <div class="step"><div class="n">2</div><b>Read helpers</b>Extract read-only issue, config, docs, session, and context calls without Studio or Coding selection side effects.</div>
      <div class="step"><div class="n">3</div><b>Store</b>Add drawer orchestration store that hydrates per issue key and writes workspace buckets.</div>
      <div class="step"><div class="n">4</div><b>Hook</b>Add hook facade and abort stale hydration when drawer key changes or closes.</div>
      <div class="step"><div class="n">5</div><b>Host wiring</b>Wire <span class="m">IssueDrawerHost</span> to the hook while keeping Details visible.</div>
      <div class="step"><div class="n">6</div><b>Tests</b>Add focused tests for hydration, isolation, degradation, and fallback.</div>
    </div>
  </section>

  <section id="accept">
    <h2>Acceptance signal</h2>
    <div class="accept"><b>Ready for implementation when:</b> the drawer has a single issue-key orchestration seam, later drawer tabs can consume docs/sessions/launch context without receiving project/module/profile props, profile/docs/terminal failures are independently typed, and tests prove drawer open does not mutate <span class="m">/coding</span> project/module/task selection.</div>
  </section>
</main>
<script>
  const nodeData = {
    drawer: {
      title: "Drawer UI",
      tag: "consumer",
      does: ["Passes only the route drawer key into the boundary.", "Renders Details as the stable fallback.", "Later slices read tab/status data from the boundary."],
      no: ["Does not assemble project, module, profile, docs, or terminal props.", "Does not call Coding selection stores."]
    },
    hook: {
      title: "useIssueDrawerWorkspace",
      tag: "facade",
      does: ["Starts hydration from issue id/key.", "Returns the coherent view model for drawer tabs.", "Aborts or ignores stale hydration when the drawer key changes."],
      no: ["Does not own long-lived doc/terminal presentation.", "Does not expose raw Coding store selection state."]
    },
    store: {
      title: "drawerWorkspaceStore",
      tag: "orchestrator",
      does: ["Tracks resource status by family.", "Normalizes launch context.", "Computes effective active tab with Details fallback."],
      no: ["Does not persist active tab across browser reload.", "Does not duplicate workspaceStore tab internals."]
    },
    issue: {
      title: "WorkTracker reads",
      tag: "context",
      does: ["Reads issue detail by key/id through a read-only helper.", "Derives task and project ids.", "Uses ancestry and scope context for module hints."],
      no: ["Does not call issueStore.openIssue from workspace orchestration.", "Does not call studioStore.selectProject.", "Does not require the current Coding module."]
    },
    codingApi: {
      title: "Coding host APIs",
      tag: "read-only",
      does: ["Loads config/profile readiness.", "Lists design documents for task context.", "Lists persisted terminal sessions for task id."],
      no: ["Does not write recent project/module profile values.", "Does not require BootstrapGate or CodingView to mount."]
    },
    reuse: {
      title: "Reuse stores",
      tag: "prior art",
      does: ["Reuses workspaceStore bucket semantics.", "Reuses terminalStore persisted session machinery where it remains selection-free.", "Keeps current browser session tab memory."],
      no: ["Does not fork a full drawer workspace model unless required.", "Does not implement terminal foreground ownership."]
    },
    later: {
      title: "Later tabs",
      tag: "deferred",
      does: ["Consume docs, terminal summaries, and launch context in CODIN-749 through CODIN-752.", "Render per-tab not-ready/error states."],
      no: ["No iframe, xterm, dormant chip, or doc-agent overlay rendering in CODIN-748."]
    }
  };
  function selectNode(id) {
    document.querySelectorAll(".node").forEach((n) => n.classList.toggle("sel", n.dataset.node === id));
    document.querySelectorAll("tr[data-node]").forEach((r) => r.classList.toggle("hl", r.dataset.node === id));
    const d = nodeData[id];
    if (!d) return;
    document.getElementById("nodeInfo").innerHTML =
      "<h3>" + d.title + "</h3><span class=\"tag\">" + d.tag + "</span>" +
      "<div class=\"k\">Does</div><ul>" + d.does.map((x) => "<li>" + x + "</li>").join("") + "</ul>" +
      "<div class=\"k\">Does not</div><ul class=\"no\">" + d.no.map((x) => "<li>" + x + "</li>").join("") + "</ul>";
  }
  document.querySelectorAll("[data-node]").forEach((el) => {
    el.addEventListener("click", () => selectNode(el.dataset.node));
  });
  const links = [...document.querySelectorAll("nav a")];
  const sections = links.map((a) => document.querySelector(a.getAttribute("href")));
  const onScroll = () => {
    let active = links[0];
    sections.forEach((s, i) => {
      if (s && s.getBoundingClientRect().top < 90) active = links[i];
    });
    links.forEach((a) => a.classList.toggle("active", a === active));
  };
  document.addEventListener("scroll", onScroll, { passive: true });
  selectNode("hook");
</script>
</body>
</html>
