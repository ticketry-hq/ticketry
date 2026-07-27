<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CODIN-751 · Drawer Terminal Tabs · LLD</title>
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
  body { background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; padding-bottom: 72px; }
  header { background: var(--panel); border-bottom: 1px solid var(--line); padding: 26px 40px 16px; }
  .crumb { color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; }
  h1 { font-size: 23px; line-height: 1.2; margin: 6px 0 4px; letter-spacing: 0; }
  .sub { color: var(--muted); font-size: 14px; max-width: 980px; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 13px 0 14px; }
  .chip { background: var(--accent-soft); border-radius: 999px; color: var(--accent); font-size: 12px; font-weight: 800; padding: 3px 10px; }
  .chip.green { background: var(--green-soft); color: var(--green); }
  .chip.amber { background: var(--amber-soft); color: var(--amber); }
  .chip.violet { background: var(--violet-soft); color: var(--violet); }
  nav { position: sticky; top: 0; z-index: 20; display: flex; gap: 2px; overflow-x: auto; background: var(--panel); border-bottom: 1px solid var(--line); padding: 0 40px; }
  nav a { border-bottom: 2px solid transparent; color: var(--muted); font-size: 13px; font-weight: 800; padding: 10px 14px 8px; text-decoration: none; white-space: nowrap; }
  nav a.active, nav a:hover { border-bottom-color: var(--accent); color: var(--accent); }
  main { max-width: 1180px; margin: 0 auto; padding: 34px 40px; }
  section { margin-bottom: 56px; scroll-margin-top: 58px; }
  h2 { font-size: 18px; margin-bottom: 4px; }
  .lede { color: var(--muted); font-size: 14px; margin-bottom: 18px; max-width: 920px; }
  .m { font-family: var(--mono); font-size: 12.5px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .card, .side, table, .accept { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
  .card { padding: 18px 20px; }
  .card h3 { font-size: 15px; margin-bottom: 8px; }
  .list { list-style: none; }
  .list li { border-bottom: 1px dashed var(--line); font-size: 13.5px; padding: 6px 0 6px 20px; position: relative; }
  .list li:last-child { border-bottom: 0; }
  .list li:before { content: ">"; color: var(--accent); font-weight: 900; left: 2px; position: absolute; }
  .list li.no:before { content: "x"; color: var(--red); }
  .diagram { display: grid; grid-template-columns: 1fr 330px; gap: 18px; align-items: stretch; }
  .svgbox { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow-x: auto; padding: 14px; }
  svg text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .node { cursor: pointer; }
  .node rect, .node ellipse { transition: stroke-width .12s, filter .12s; }
  .node.sel rect, .node.sel ellipse { filter: drop-shadow(0 2px 3px rgba(53,86,212,.2)); stroke-width: 3; }
  .side { font-size: 13px; padding: 18px 20px; }
  .side h3 { color: var(--accent); font-size: 15px; margin-bottom: 6px; }
  .side .tag { background: var(--accent-soft); border-radius: 999px; color: var(--accent); display: inline-block; font-size: 11px; font-weight: 800; letter-spacing: .04em; margin-bottom: 10px; padding: 2px 8px; }
  .side .k { color: var(--muted); font-size: 11px; font-weight: 800; letter-spacing: .06em; margin: 11px 0 3px; text-transform: uppercase; }
  .side li { margin-left: 17px; padding: 2px 0; }
  .side .no li { color: var(--red); }
  table { border-collapse: collapse; overflow: hidden; width: 100%; }
  th, td { border-bottom: 1px solid var(--line); font-size: 13px; padding: 10px 12px; text-align: left; vertical-align: top; }
  th { background: #fbfcfe; color: var(--muted); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; }
  tr:last-child td { border-bottom: 0; }
  tr[data-node] { cursor: pointer; }
  tr.hl td { background: var(--accent-soft); }
  .pill { border-radius: 999px; display: inline-block; font-size: 11px; font-weight: 800; padding: 2px 8px; white-space: nowrap; }
  .pill.new { background: var(--green-soft); color: var(--green); }
  .pill.mod { background: var(--amber-soft); color: var(--amber); }
  .pill.ro { background: var(--accent-soft); color: var(--accent); }
  .pill.none { background: var(--red-soft); color: var(--red); }
  .seq { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
  .step { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; border-top: 3px solid var(--accent); color: var(--muted); font-size: 12.5px; padding: 13px 14px; }
  .step .n { color: var(--accent); font-size: 18px; font-weight: 900; }
  .step b { color: var(--ink); display: block; font-size: 13px; margin: 1px 0 4px; }
  details { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 16px; }
  details + details { margin-top: 10px; }
  summary { color: var(--accent); cursor: pointer; font-weight: 800; }
  .accept { background: var(--green-soft); border-color: #cfe5d8; font-size: 14px; padding: 20px 24px; }
  .accept b { color: var(--green); }
  @media (max-width: 900px) {
    header, nav, main { padding-left: 18px; padding-right: 18px; }
    .grid2, .grid3, .diagram, .seq { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<header>
  <div class="crumb">Coding · WorkTracker · CODIN-751 · LLD</div>
  <h1>Tabbed Drawer Slice 5: Drawer Terminal Tabs and Run Launch</h1>
  <div class="sub">Low-level implementation plan for drawer Terminal tabs over live/restorable task sessions: explicit selection, drawer foreground ownership, shared xterm/WebSocket reuse, presentation-only drawer close, and issue-scoped new-run launch. Terminated run chips and revival stay in CODIN-753.</div>
  <div class="chips">
    <span class="chip">Phase: LLD review</span>
    <span class="chip green">Frontend slice</span>
    <span class="chip violet">Uses CODIN-748 seam</span>
    <span class="chip violet">Uses CODIN-749 registry/pool</span>
    <span class="chip amber">No backend protocol change planned</span>
    <span class="chip amber">No terminated history chips</span>
  </div>
</header>
<nav id="nav">
  <a href="#scope" class="active">Scope</a>
  <a href="#shape">Shape</a>
  <a href="#flow">Flow</a>
  <a href="#map">Change Map</a>
  <a href="#decisions">Decisions</a>
  <a href="#states">States</a>
  <a href="#tests">Harness</a>
  <a href="#steps">Steps</a>
  <a href="#accept">Acceptance</a>
</nav>
<main>
  <section id="scope">
    <h2>Scope lock</h2>
    <div class="lede">This slice makes the issue drawer a terminal foreground surface without changing the server, terminal protocol, or the global /coding selection.</div>
    <div class="grid2">
      <div class="card">
        <h3>Build</h3>
        <ul class="list">
          <li>Render live/restorable task-scoped sessions as Terminal tabs in <span class="m">IssueDrawerTabs</span>.</li>
          <li>Keep Details selected on drawer open even when Terminal tabs exist.</li>
          <li>Selecting a Terminal tab claims drawer foreground ownership through <span class="m">terminalForegroundStore</span>.</li>
          <li>Mount a drawer terminal host that reuses <span class="m">terminalEntryPool</span> and the existing terminal socket lifecycle helpers.</li>
          <li>Close a drawer Terminal tab as presentation-only: release drawer ownership and remove only the drawer presentation.</li>
          <li>Add a drawer-scoped new-run launcher that consumes <span class="m">DrawerLaunchContext</span> and writes to <span class="m">terminalStore</span>.</li>
          <li>Show existing lifecycle badges with <span class="m">lifecycleOfRun</span> and <span class="m">LifecycleBadge</span>.</li>
          <li>Add a pool driver ref-count so <span class="m">disposeAll</span> only fires when the last of /coding and the drawer unmounts.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Do not build</h3>
        <ul class="list">
          <li class="no">No terminated-run chips, history, revival, or provider continue semantics.</li>
          <li class="no">No reuse of <span class="m">closeTerminalTab</span> for drawer close because it can terminate persisted runs.</li>
          <li class="no">No mutation of <span class="m">tasksStore.selectedProjectId</span>, <span class="m">selectedModuleId</span>, or <span class="m">selectedTaskId</span>.</li>
          <li class="no">No second terminal implementation, second xterm instance, or second WebSocket viewer for an existing live run.</li>
          <li class="no">No doc edit-with-agent overlay; CODIN-752 owns that.</li>
          <li class="no">No backend model, migration, or endpoint work unless implementation proves the existing launch/attach path is insufficient.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="shape">
    <h2>System shape</h2>
    <div class="lede">Click a node for ownership. Blue is the CODIN-751 work; violet seams already exist; dashed amber is explicitly deferred.</div>
    <div class="diagram">
      <div class="svgbox">
        <svg viewBox="0 0 900 500" width="100%" height="460" role="img" aria-label="Drawer terminal architecture">
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#5b6478"></path>
            </marker>
          </defs>
          <g class="node" data-node="tabs">
            <rect x="32" y="50" width="210" height="94" rx="8" fill="#e8edfb" stroke="#3556d4" stroke-width="2"></rect>
            <text x="137" y="80" text-anchor="middle" font-size="13" font-weight="700">IssueDrawerTabs</text>
            <text x="137" y="101" text-anchor="middle" font-size="11" fill="#5b6478">Details + Docs + Terminal</text>
            <text x="137" y="119" text-anchor="middle" font-size="11" fill="#5b6478">badges + drawer close</text>
          </g>
          <g class="node" data-node="host">
            <rect x="32" y="226" width="210" height="88" rx="8" fill="#e8edfb" stroke="#3556d4" stroke-width="2"></rect>
            <text x="137" y="259" text-anchor="middle" font-size="13" font-weight="700">IssueDrawerHost</text>
            <text x="137" y="280" text-anchor="middle" font-size="11" fill="#5b6478">routes active content</text>
          </g>
          <g class="node" data-node="drawerTerminal">
            <rect x="312" y="226" width="210" height="88" rx="8" fill="#e8edfb" stroke="#3556d4" stroke-width="2"></rect>
            <text x="417" y="256" text-anchor="middle" font-size="13" font-weight="700">DrawerTerminalHost</text>
            <text x="417" y="277" text-anchor="middle" font-size="11" fill="#5b6478">attach shared entry</text>
            <text x="417" y="295" text-anchor="middle" font-size="11" fill="#5b6478">fit + resize + wheel</text>
          </g>
          <g class="node" data-node="foreground">
            <rect x="590" y="56" width="226" height="96" rx="8" fill="#f0e9fb" stroke="#6b3fb8" stroke-width="2"></rect>
            <text x="703" y="85" text-anchor="middle" font-size="13" font-weight="700">terminalForegroundStore</text>
            <text x="703" y="106" text-anchor="middle" font-size="11" fill="#5b6478">coding default, drawer claim</text>
            <text x="703" y="124" text-anchor="middle" font-size="11" fill="#5b6478">foregroundKey(meta)</text>
          </g>
          <g class="node" data-node="pool">
            <rect x="590" y="226" width="226" height="88" rx="8" fill="#f0e9fb" stroke="#6b3fb8" stroke-width="2"></rect>
            <text x="703" y="256" text-anchor="middle" font-size="13" font-weight="700">terminalEntryPool</text>
            <text x="703" y="277" text-anchor="middle" font-size="11" fill="#5b6478">single xterm + WS entry</text>
            <text x="703" y="295" text-anchor="middle" font-size="11" fill="#5b6478">syncEntries / ensureConnected</text>
          </g>
          <g class="node" data-node="workspace">
            <rect x="312" y="50" width="210" height="94" rx="8" fill="#ffffff" stroke="#3556d4" stroke-width="2"></rect>
            <text x="417" y="80" text-anchor="middle" font-size="13" font-weight="700">drawer workspace view</text>
            <text x="417" y="101" text-anchor="middle" font-size="11" fill="#5b6478">launchContext</text>
            <text x="417" y="119" text-anchor="middle" font-size="11" fill="#5b6478">terminal summaries</text>
          </g>
          <g class="node" data-node="terminalStore">
            <rect x="312" y="380" width="210" height="76" rx="8" fill="#ffffff" stroke="#3556d4" stroke-width="2"></rect>
            <text x="417" y="410" text-anchor="middle" font-size="13" font-weight="700">terminalStore</text>
            <text x="417" y="431" text-anchor="middle" font-size="11" fill="#5b6478">sessions, byTaskId, activeByTask</text>
          </g>
          <g class="node" data-node="coding">
            <rect x="590" y="380" width="226" height="76" rx="8" fill="#ffffff" stroke="#1d7a4f" stroke-width="2"></rect>
            <text x="703" y="410" text-anchor="middle" font-size="13" font-weight="700">/coding TerminalHost</text>
            <text x="703" y="431" text-anchor="middle" font-size="11" fill="#5b6478">backs off when drawer owns key</text>
          </g>
          <g class="node" data-node="history">
            <rect x="32" y="380" width="210" height="76" rx="8" fill="#fbf0d8" stroke="#9a6700" stroke-width="2" stroke-dasharray="7 5"></rect>
            <text x="137" y="410" text-anchor="middle" font-size="13" font-weight="700">Terminated history</text>
            <text x="137" y="431" text-anchor="middle" font-size="11" fill="#5b6478">CODIN-753</text>
          </g>
          <path d="M242 98 H312" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="277" y="88" text-anchor="middle" font-size="11" fill="#5b6478">read</text>
          <path d="M242 270 H312" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="277" y="260" text-anchor="middle" font-size="11" fill="#5b6478">render terminal</text>
          <path d="M522 270 H590" stroke="#6b3fb8" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="556" y="260" text-anchor="middle" font-size="11" fill="#6b3fb8">shared entry</text>
          <path d="M522 98 H590" stroke="#6b3fb8" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="556" y="88" text-anchor="middle" font-size="11" fill="#6b3fb8">claim/release</text>
          <path d="M417 314 V380" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="436" y="350" font-size="11" fill="#5b6478">focus/open</text>
          <path d="M522 418 H590" stroke="#5b6478" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="556" y="408" text-anchor="middle" font-size="11" fill="#5b6478">same sessions</text>
          <path d="M703 380 V314" stroke="#6b3fb8" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="720" y="350" font-size="11" fill="#6b3fb8">pool</text>
          <path d="M703 226 V152" stroke="#6b3fb8" stroke-width="2" fill="none" marker-end="url(#arrow)"></path>
          <text x="720" y="190" font-size="11" fill="#6b3fb8">gate</text>
        </svg>
      </div>
      <aside class="side" id="nodeInfo">
        <h3>Select a node</h3>
        <span class="tag">Interactive map</span>
        <p>Click any diagram node for responsibilities and non-responsibilities.</p>
      </aside>
    </div>
  </section>

  <section id="flow">
    <h2>Interaction flow</h2>
    <div class="lede">The drawer only acquires terminal ownership after an explicit user action. Details remains the first selected tab on open.</div>
    <div class="seq">
      <div class="step"><div class="n">1</div><b>Open drawer</b><span>CODIN-748 hydrates task context, documents, terminal summaries, and launch context by issue key.</span></div>
      <div class="step"><div class="n">2</div><b>Surface tabs</b><span>Terminal tabs render for non-terminated task sessions already attached or restorable; Details stays selected.</span></div>
      <div class="step"><div class="n">3</div><b>Select terminal</b><span>The tab focuses the session in terminalStore, sets the drawer workspace active tab, and claims drawer ownership.</span></div>
      <div class="step"><div class="n">4</div><b>Attach entry</b><span>DrawerTerminalHost syncs the pool, opens the shared xterm into the drawer host, and ensures one socket.</span></div>
      <div class="step"><div class="n">5</div><b>Transfer safely</b><span>/coding sees the drawer claim and detaches for that key while keeping unrelated sessions usable.</span></div>
      <div class="step"><div class="n">6</div><b>Close/release</b><span>Drawer close, issue switch, tab switch, or terminal-tab close releases drawer ownership without killing the run.</span></div>
    </div>
  </section>

  <section id="map">
    <h2>Change map</h2>
    <div class="lede">Implementation stays inside Studio frontend code and focused tests. No server files are planned.</div>
    <table>
      <thead><tr><th>File</th><th>Kind</th><th>Decision-complete delta</th><th>Must not do</th></tr></thead>
      <tbody>
        <tr data-node="workspace"><td><span class="m">studio/src/stores/issue/drawerWorkspaceStore.ts</span></td><td><span class="pill mod">modify</span></td><td>In <span class="m">effectiveActiveTab</span> drop the live/restorable-terminal preference branch so first-open resolves to <span class="m">"details"</span> unconditionally; keep storing terminal summaries into <span class="m">persistedSessions</span> and the launch context. During hydrate, call <span class="m">restoreLiveSessions(taskId)</span> so restorable persisted rows materialize into <span class="m">byTaskId</span> as inactive tabs (this does not steal focus — active tab is still Details).</td><td>No global /coding task/module selection mutation; no auto-select of a terminal tab.</td></tr>
        <tr data-node="tabs"><td><span class="m">studio/src/shell/IssueDrawerTabs.tsx</span></td><td><span class="pill mod">modify</span></td><td>Add Terminal tabs beside Details and Doc tabs; labels from <span class="m">terminalLabel</span>; badges from existing lifecycle semantics; add a drawer new-run launcher and presentation-only close.</td><td>No terminated history chips and no call to <span class="m">closeTerminalTab</span>.</td></tr>
        <tr data-node="host"><td><span class="m">studio/src/shell/IssueDrawerHost.tsx</span></td><td><span class="pill mod">modify</span></td><td>Render DrawerTerminalHost when drawer workspace active tab is terminal; register cleanup on drawer close and issue changes.</td><td>No re-parenting or remounting of /coding TerminalHost.</td></tr>
        <tr data-node="drawerTerminal"><td><span class="m">studio/src/shell/DrawerTerminalHost.tsx</span></td><td><span class="pill new">new</span></td><td>Drawer-owned terminal presentation host, symmetric to <span class="m">TerminalHost</span>: <span class="m">registerHost("drawer", el)</span>, <span class="m">getEntry</span> + <span class="m">term.open(drawerRef)</span> for the drawer-owned session, <span class="m">ensureConnected</span>, rAF-coalesced fit/resize, and the #578 wheel bridge. It also calls <span class="m">syncEntries(sessions)</span> so the pool stays driven when the drawer is open outside /coding, and detaches (clears the host div) without disposing when ownership is released.</td><td>Never call <span class="m">disposeAll()</span> — the drawer is a pool viewer, not its owner; no independent xterm, socket, or transport implementation.</td></tr>
        <tr data-node="terminalStore"><td><span class="m">studio/src/coding/stores/terminalStore.ts</span></td><td><span class="pill mod">modify</span></td><td>Add a presentation-only drawer close helper if needed, or expose a narrow background action that releases ownership and removes only the local drawer/open-tab presentation.</td><td>No tmux termination and no removal of persisted sessions on drawer close.</td></tr>
        <tr data-node="pool"><td><span class="m">studio/src/coding/panes/terminalEntryPool.ts</span></td><td><span class="pill mod">modify</span></td><td>Reuse as the single object lifecycle for xterm and WebSocket entries. Add a driver ref-count (register/release driver) so <span class="m">disposeAll()</span> runs only when the last driver unmounts — not whenever /coding alone unmounts.</td><td>No foreground-ownership policy here; that stays in <span class="m">terminalForegroundStore</span>.</td></tr>
        <tr data-node="coding"><td><span class="m">studio/src/coding/panes/TerminalHost.tsx</span></td><td><span class="pill mod">modify</span></td><td>Replace the unconditional <span class="m">disposeAll()</span> on unmount with register/release against the pool driver ref-count, so leaving /coding while the drawer holds a live session no longer tears the pool down. Attach/gate logic (<span class="m">isCodingEligible</span>) is unchanged.</td><td>No change to the eligibility gate or selected-task routing.</td></tr>
        <tr data-node="foreground"><td><span class="m">studio/src/stores/terminalForegroundStore.ts</span></td><td><span class="pill ro">reuse</span></td><td>Use <span class="m">foregroundKey</span>, <span class="m">acquire</span>, <span class="m">release</span>, <span class="m">releaseOwner</span>, and drawer host registration.</td><td>No new owner vocabulary.</td></tr>
        <tr data-node="tabs"><td><span class="m">studio/src/test/IssueDrawerTerminalTabs.test.tsx</span></td><td><span class="pill new">new</span></td><td>Focused drawer tests for default Details, visible tabs, badges, selection, close semantics, new launch, and scoped failure handling.</td><td>No brittle full app integration setup unless needed.</td></tr>
        <tr data-node="drawerTerminal"><td><span class="m">studio/src/test/coding/panes/terminalForegroundArbitration.test.tsx</span></td><td><span class="pill mod">modify</span></td><td>Add drawer-host transfer coverage or factor shared setup to assert one xterm/WS across coding to drawer to coding.</td><td>No duplicate socket expectations.</td></tr>
      </tbody>
    </table>
  </section>

  <section id="decisions">
    <h2>Decisions</h2>
    <div class="lede">Rows highlight related diagram nodes. These are implementation constraints, not open questions.</div>
    <table>
      <thead><tr><th>Decision</th><th>Implementation choice</th><th>Reason</th></tr></thead>
      <tbody>
        <tr data-node="workspace"><td>First-open tab</td><td>Drawer hydration resolves to Details first, regardless of available terminal sessions.</td><td>Matches accepted requirement; terminal ownership is never acquired implicitly.</td></tr>
        <tr data-node="drawerTerminal"><td>Terminal presentation</td><td>Add drawer-specific host that mirrors the attachment mechanics of /coding TerminalHost over the shared pool.</td><td>A separate host is needed because /coding TerminalHost is selected-task driven and would violate drawer issue-scope rules.</td></tr>
        <tr data-node="foreground"><td>Ownership</td><td>Drawer selection calls <span class="m">acquire(foregroundKey(meta), "drawer")</span>; release happens on close, switch, issue change, and unmount.</td><td>Uses the existing CODIN-749 single-owner registry and keeps /coding as the implicit fallback.</td></tr>
        <tr data-node="terminalStore"><td>Drawer tab close</td><td>Presentation-only release/background action, not /coding close semantics.</td><td>/coding close can terminate persisted runs and records history chips, both out of scope.</td></tr>
        <tr data-node="tabs"><td>New run launch</td><td>Drawer launcher consumes <span class="m">launchContext</span> and selected agent, then opens a normal task session in terminalStore and foregrounds it in the drawer.</td><td>Starts issue-scoped runs without deriving scope from global /coding selection.</td></tr>
        <tr data-node="history"><td>Terminated sessions</td><td>Filter out <span class="m">terminated_at</span> rows from drawer Terminal tabs.</td><td>CODIN-753 owns history/revival and provider continue semantics.</td></tr>
        <tr data-node="pool"><td>Scrollback identity</td><td>Never dispose or recreate the entry when transferring foreground between /coding and drawer. Foreground transfer relies on the <span class="m">isCodingEligible</span> gate: /coding clears its host div when the drawer claims the key, so only one <span class="m">term.open()</span> target is ever live at a time.</td><td>Scrollback lives in the shared xterm buffer; preserving the entry preserves session identity.</td></tr>
        <tr data-node="pool"><td>Pool lifetime</td><td>Dispose pooled entries only when the last driver (/coding or drawer) unmounts, via a driver ref-count. The drawer registers as a driver and drives <span class="m">syncEntries</span>/<span class="m">ensureConnected</span> when open outside /coding.</td><td>Today /coding is the sole driver and disposes on unmount; with a shell-level drawer that would kill live sessions the drawer still shows.</td></tr>
        <tr data-node="workspace"><td>Restorable tabs</td><td>Drawer tabs render from live <span class="m">byTaskId</span>; <span class="m">hydrate</span> calls <span class="m">restoreLiveSessions(taskId)</span> to promote restorable <span class="m">persistedSessions</span> into that live set.</td><td>The reattach path already exists (used on reload); the drawer reuses it rather than inventing a separate restorable-tab model.</td></tr>
      </tbody>
    </table>
  </section>

  <section id="states">
    <h2>UI and failure states</h2>
    <div class="lede">Failures are scoped to terminal controls. Details and Doc tabs must keep rendering.</div>
    <div class="grid3">
      <div class="card">
        <h3>Ready</h3>
        <ul class="list">
          <li>Details tab selected on open.</li>
          <li>Terminal tabs visible for live/restorable task runs.</li>
          <li>Lifecycle badge appears when lifecycle state is known or reconnecting.</li>
          <li>New-run control enabled when launch context and profile are ready.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Scoped errors</h3>
        <ul class="list">
          <li>Terminal discovery failure leaves Details and Docs intact.</li>
          <li>Profile not ready disables or errors only the new-run control.</li>
          <li>Socket/attach error marks only that terminal session area.</li>
          <li>Launch failure does not change the active Details or Doc content.</li>
        </ul>
      </div>
      <div class="card">
        <h3>Release points</h3>
        <ul class="list">
          <li>Clicking Details or Doc releases the drawer claim for the active drawer terminal.</li>
          <li>Closing a drawer Terminal tab releases the claim and returns to Details if that tab was active.</li>
          <li>Drawer close or issue switch calls drawer-owner release.</li>
          <li>Session exit/error also releases ownership via existing terminalStore behavior.</li>
        </ul>
      </div>
    </div>
  </section>

  <section id="tests">
    <h2>Implementation harness</h2>
    <div class="lede">Test-first target is narrow component/store coverage plus the existing terminal arbitration tests. No end-to-end server is required for this LLD.</div>
    <details open>
      <summary>Drawer tab and content tests</summary>
      <ul class="list">
        <li>Seed CODIN-748 drawer state and terminalStore; assert Terminal tabs render without visiting /coding first.</li>
        <li>Assert Details is selected on drawer open even when terminal tabs exist.</li>
        <li>Click a Terminal tab; assert workspace active terminal, terminalStore focus, drawer foreground claim, and DrawerTerminalHost rendering.</li>
        <li>Click Details or a Doc tab after a terminal; assert drawer claim is released and Details/Doc content renders.</li>
        <li>Close a drawer Terminal tab; assert no terminate API call, no persisted-session removal, no history chip, and backend-run metadata remains restorable.</li>
      </ul>
    </details>
    <details>
      <summary>Launch tests</summary>
      <ul class="list">
        <li>With profile-ready launch context, selecting an agent opens a task-scoped terminal session using the context project, module, task, ticket sequence, and selected agent.</li>
        <li>New run becomes a drawer Terminal tab and immediately claims drawer foreground ownership.</li>
        <li>Missing profile or degraded launch context disables or scopes the launch error to terminal controls.</li>
        <li>Global /coding selected project, module, and task remain unchanged.</li>
      </ul>
    </details>
    <details>
      <summary>Arbitration and pool tests</summary>
      <ul class="list">
        <li>Extend existing xterm/WebSocket mocks to mount both /coding TerminalHost and DrawerTerminalHost.</li>
        <li>Assert coding to drawer to coding transfer creates one xterm and opens one WebSocket.</li>
        <li>Assert the same terminal entry object survives transfer, preserving scrollback/session identity.</li>
        <li>Assert /coding remains eligible and usable for unrelated sessions while drawer owns a different session.</li>
        <li>Unmount /coding TerminalHost while the drawer host stays mounted; assert entries are NOT disposed (driver ref-count &gt; 0) and the drawer terminal keeps its buffer.</li>
        <li>Assert hydrate's <span class="m">restoreLiveSessions</span> promotes a restorable persisted row into a drawer Terminal tab without auto-selecting it (Details stays active).</li>
      </ul>
    </details>
    <details>
      <summary>Regression checks</summary>
      <ul class="list">
        <li>Existing IssueDrawerHost and IssueDrawerDocTabs tests stay green.</li>
        <li>Existing TerminalHost tests stay green.</li>
        <li>Run focused Vitest files first, then the Studio test command used by the repo if time allows.</li>
      </ul>
    </details>
  </section>

  <section id="steps">
    <h2>Build order</h2>
    <div class="lede">Each step is independently reviewable. Code implementation starts only after this LLD is accepted and the WorkTracker task is moved to LLD.</div>
    <div class="seq">
      <div class="step"><div class="n">1</div><b>Lock drawer default</b><span>Drop the terminal branch in <span class="m">effectiveActiveTab</span> so Details wins on first open, and call <span class="m">restoreLiveSessions</span> in hydrate to surface restorable tabs.</span></div>
      <div class="step"><div class="n">2</div><b>Terminal tabs</b><span>Extend IssueDrawerTabs with terminal tabs, lifecycle badges, selection, new-run affordance, and presentation-only close.</span></div>
      <div class="step"><div class="n">3</div><b>Drawer host</b><span>Add DrawerTerminalHost over the shared pool, add the pool driver ref-count (drawer + /coding), and register the drawer host target.</span></div>
      <div class="step"><div class="n">4</div><b>Ownership cleanup</b><span>Wire release on tab switch, drawer close, issue switch, and active drawer terminal close.</span></div>
      <div class="step"><div class="n">5</div><b>Launch path</b><span>Add the drawer-scoped launch action from launchContext to terminalStore, then foreground the new session in the drawer.</span></div>
      <div class="step"><div class="n">6</div><b>Verify</b><span>Run focused drawer and terminal arbitration tests; expand only if shared behavior breaks.</span></div>
    </div>
  </section>

  <section id="accept">
    <h2>Acceptance signal</h2>
    <div class="accept">
      <b>Accepted when:</b> existing and newly launched task terminal sessions appear as drawer Terminal tabs, Details remains the first selected tab, drawer selection owns exactly one shared terminal viewer, drawer close only backgrounds/releases presentation, /coding remains usable for unrelated sessions and regains eligibility after release, lifecycle badges use the existing model, and terminal/launch failures do not break Details or Doc tabs.
    </div>
  </section>
</main>
<script>
  const info = {
    tabs: {
      title: "IssueDrawerTabs",
      tag: "Modify",
      does: ["Render terminal tabs beside Details and Docs.", "Use terminalLabel and LifecycleBadge.", "Select, close, and launch through drawer-safe callbacks."],
      no: ["No terminated history chips.", "No call to closeTerminalTab for drawer close."]
    },
    host: {
      title: "IssueDrawerHost",
      tag: "Modify",
      does: ["Route terminal-active state to DrawerTerminalHost.", "Release drawer ownership on drawer close or issue switch.", "Keep Details and Doc rendering intact."],
      no: ["No mutation of global /coding selection.", "No reuse of /coding selected-task routing."]
    },
    drawerTerminal: {
      title: "DrawerTerminalHost",
      tag: "New",
      does: ["Attach the shared xterm entry into the drawer host.", "Use syncEntries, getEntry, and ensureConnected.", "Fit, resize, and wheel-scroll like /coding."],
      no: ["No second terminal object lifecycle.", "No second WebSocket viewer for an existing live run."]
    },
    foreground: {
      title: "terminalForegroundStore",
      tag: "Reuse",
      does: ["Arbitrate coding vs drawer ownership.", "Represent drawer claims by foreground key.", "Return to coding eligibility when released."],
      no: ["No new owner names.", "No session metadata ownership."]
    },
    pool: {
      title: "terminalEntryPool",
      tag: "Reuse",
      does: ["Own xterm and WebSocket entries exactly once.", "Preserve scrollback through DOM reattachment.", "Open sockets idempotently."],
      no: ["No policy decisions.", "No drawer-specific fork."]
    },
    workspace: {
      title: "Drawer workspace view",
      tag: "Reuse/modify",
      does: ["Expose launchContext and fetched terminal summaries.", "Keep first-open active tab on Details.", "Stay independent from /coding selected state."],
      no: ["No manual project/module/worktree assembly in presentation.", "No active terminal auto-select on open."]
    },
    terminalStore: {
      title: "terminalStore",
      tag: "Modify narrowly",
      does: ["Store normal task sessions for drawer and /coding.", "Focus and open issue-scoped sessions.", "Release claims when sessions end."],
      no: ["No drawer close termination.", "No persisted-session deletion for presentation close."]
    },
    coding: {
      title: "/coding TerminalHost",
      tag: "Modify (narrow)",
      does: ["Back off when drawer owns a foreground key.", "Continue rendering unrelated sessions.", "Register/release against the pool driver ref-count instead of unconditional disposeAll on unmount."],
      no: ["No drawer-specific task selection changes.", "No duplicate host for a claimed session.", "No eligibility-gate change."]
    },
    history: {
      title: "Terminated history",
      tag: "Deferred",
      does: ["Remain owned by CODIN-753.", "Define revive-by-run-id later."],
      no: ["No chips in CODIN-751.", "No provider continue semantics."]
    }
  };
  function renderInfo(key) {
    const data = info[key];
    if (!data) return;
    document.querySelectorAll(".node").forEach((n) => n.classList.toggle("sel", n.dataset.node === key));
    document.querySelectorAll("tr[data-node]").forEach((r) => r.classList.toggle("hl", r.dataset.node === key));
    document.getElementById("nodeInfo").innerHTML = `
      <h3>${data.title}</h3>
      <span class="tag">${data.tag}</span>
      <div class="k">Does</div>
      <ul>${data.does.map((x) => `<li>${x}</li>`).join("")}</ul>
      <div class="k">Does not</div>
      <ul class="no">${data.no.map((x) => `<li>${x}</li>`).join("")}</ul>
    `;
  }
  document.querySelectorAll(".node, tr[data-node]").forEach((el) => {
    el.addEventListener("click", () => renderInfo(el.dataset.node));
  });
  const links = [...document.querySelectorAll("nav a")];
  const sections = links.map((a) => document.querySelector(a.getAttribute("href")));
  const onScroll = () => {
    const y = window.scrollY + 80;
    let active = links[0];
    sections.forEach((s, i) => { if (s && s.offsetTop <= y) active = links[i]; });
    links.forEach((a) => a.classList.toggle("active", a === active));
  };
  document.addEventListener("scroll", onScroll, { passive: true });
  renderInfo("tabs");
</script>
</body>
</html>
