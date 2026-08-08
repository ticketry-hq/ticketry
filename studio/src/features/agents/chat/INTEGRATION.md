# Structured Chat integration

Ticketry Chat is a first-class run surface beside Terminal. It is not a new
provider: the first implementation launches Codex app-server and renders its
structured event stream. Process ownership, persistence, and provider protocol
translation stay in the Python sidecar.

## T3 Code reuse

The UI model and interaction patterns are adapted from T3 Code at audited
revision `45d9aa90baab8f2d6b13c7ae3cf2f97128edaf7b` under MIT. The full provenance,
license, and transplant map live in `third_party/t3code/` and the ticket spec.
The adapted seam includes:

- normalized messages, tool arguments/results, token usage, plans, and diffs;
- a centered streaming timeline with settled-turn folds and live-edge follow;
- Markdown responses, durable drafts, Enter/Shift+Enter, and Stop;
- composer-adjacent approval and structured user-input panels;
- reconnect/cursor replay and optimistic user messages.

Ticketry intentionally does not copy T3's Effect/RPC backend, desktop shell,
router, or persistence layers. Those are replaced by the existing Studio
runtime boundary, TanStack Query, Zustand, and the supervised sidecar.

## Runtime contract

- `GET /api/chats?task_id=...` indexes durable tabs.
- `POST /api/chats` creates a Codex Chat run.
- `GET /api/chats/:id?after=<cursor>` replays an ordered snapshot.
- `POST /api/chats/:id/turns`, `/interrupt`, `/approvals`, `/user-input`, and
  `/resume` perform durable commands; `DELETE /api/chats/:id` ends a session.
- `/ws/chat?agent_run_id=...&cursor=...&api_key=...` carries snapshots, ordered
  events, command acknowledgements, and replay-safe reconnects.

Both REST and WebSocket paths use the configured WorkTracker API key. The Chat
WebSocket is an explicit `RuntimeEndpoints.chatWebSocket` value in browser and
desktop runtimes; it must not be inferred from the Terminal endpoint.

The backend is authoritative for sequence numbers and session status. The UI
keeps a cursor per run, deduplicates by sequence, and retains tabs/transcripts
across workspace switches. Chat creation and turn delivery carry durable command
IDs, so a response-lost retry resolves to the original operation. If delivery
cannot be confirmed after dispatch, including when transcript catch-up is
temporarily unavailable, the composer stays interlocked and offers a
same-command-ID retry until replay settles it. Only a durable, explicit provider
rejection uses a new-message retry. A lone durable `thread.message-sent` audit
proves only that dispatch began, so it also keeps the composer interlocked until
a matching failure or later turn-start event arrives. If the backend restarts
after recording the user message but before it can prove whether Codex accepted the turn, the durable
event is marked `deliveryUnknown` and is deliberately not redeliverable. Every
fresh webview blocks new sends until the user reviews the resumed provider
thread and explicitly acknowledges that ambiguity; a later durable send or turn
also supersedes it.

A failed optional initial prompt leaves the live thread usable. Resume is shown
only after an explicit process-lifetime event advertises `resumable: true`;
ordinary turn failures retry through the composer, and a stopped session is
final. Session termination always uses the independent REST endpoint rather
than the live command WebSocket, so it can preempt a hung provider operation.
Closing a tab always asks the backend to stop the run before dismissing it, even
when this webview's cached status already says stopped, because another webview
may have resumed the durable thread.
