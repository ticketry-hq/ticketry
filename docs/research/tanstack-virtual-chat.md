# TanStack Virtual chat support and Ticketry fit

Research snapshot: 2026-08-15. Sources are limited to TanStack's official
documentation, announcement, repository, and published package metadata.

## Bottom line

The release that most closely matches “TanStack's new chat interface” is
**TanStack Virtual's first-class support for chat-style, end-anchored lists**,
announced on 2026-05-25. It is not a prebuilt chat interface and it is not an
agent SDK. TanStack explicitly says it “still isn't a chat component”: the app
continues to own message bubbles, timestamps, loading UI, the composer, data,
and styling. The new library behavior is the difficult scroll layer underneath
that UI: stable history prepends, follow-new-output only while already pinned,
correct bottom anchoring while the last message grows during streaming, and
“jump to latest” helpers. ([announcement](https://tanstack.com/blog/tanstack-virtual-chat),
[Chat guide](https://tanstack.com/virtual/latest/docs/chat))

For Ticketry, this is a good eventual fit for the **message-list viewport** of a
structured Chat run. It does not remove the larger prerequisite: Ticketry first
needs a structured event transport and durable transcript. It must not be wired
to terminal bytes or treated as the chat architecture itself.

## What was released

TanStack added chat/reverse-feed semantics to the existing **TanStack Virtual
v3** virtualizer. The official docs describe one virtualizer that renders the
visible window of a much larger list; the app still provides normal-order data,
markup, styles, fetching, and item identity. The React package is
`@tanstack/react-virtual`, a thin React wrapper around the framework-neutral
`@tanstack/virtual-core`. ([introduction](https://tanstack.com/virtual/latest/docs/introduction),
[React adapter](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual),
[repository overview](https://github.com/TanStack/virtual))

There is one credible alternate interpretation: the separate TanStack AI repo
now publishes **`@tanstack/ai-react-ui`**, an actual headless React chat UI
package. TanStack Virtual has no model or provider opinions and works with any
message source; `ai-react-ui` is coupled to TanStack AI's message and client
model. The two choices and their Ticketry implications are evaluated separately
below. ([TanStack AI beta announcement](https://tanstack.com/blog/tanstack-ai-beta),
[`ai-react-ui` package source](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/package.json))

### Maturity and compatibility

- The chat APIs are in the normal v3 documentation and current non-prerelease
  package, not under an experimental namespace. As of this snapshot the
  published React package is `3.14.9`. ([published package metadata](https://www.npmjs.com/package/@tanstack/react-virtual),
  [v3 Chat guide](https://tanstack.com/virtual/v3/docs/chat))
- `@tanstack/react-virtual` declares React and React DOM peer support from 16.8
  through 19, so Ticketry's React 18.3.1 is supported. The package publishes
  ESM and CommonJS entries and declares itself side-effect free. ([official
  package source](https://github.com/TanStack/virtual/blob/main/packages/react-virtual/package.json),
  [Ticketry package manifest](../../studio/package.json#L34-L55))
- TanStack Virtual and the package are MIT licensed. The license requires the
  copyright and permission notice to remain in copies or substantial portions.
  ([official license](https://github.com/TanStack/virtual/blob/main/LICENSE),
  [package metadata](https://github.com/TanStack/virtual/blob/main/packages/react-virtual/package.json))

## Installation and runtime requirements

For Ticketry's React renderer, installation is:

```sh
npm install @tanstack/react-virtual --workspace @worktracker/studio
```

The documented alternatives are framework adapters for Solid, Svelte, Vue,
Lit, Angular, and Marko, or `@tanstack/virtual-core` for a framework-neutral
integration. ([installation guide](https://tanstack.com/virtual/latest/docs/installation))

The relevant runtime is the browser/webview DOM. The adapter observes the scroll
element and dynamically measures message elements; the recommended chat pattern
uses a fixed-height `overflow: auto` container and attaches `measureElement` to
variable-height rows. That is compatible with Ticketry's React UI inside the
Tauri webview. No Node server, TanStack Start, backend JavaScript runtime, or AI
provider is required. ([Chat guide](https://tanstack.com/virtual/latest/docs/chat),
[React adapter API](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual))

## The chat API

The minimum React setup is:

```tsx
const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => viewportRef.current,
  estimateSize: () => 72,
  getItemKey: (index) => messages[index]!.id,
  anchorTo: 'end',
  followOnAppend: true,
  scrollEndThreshold: 80,
  overscan: 6,
})
```

The new/central pieces are:

- `anchorTo: 'end'`: treats the list end as the stable edge. A prepend finds the
  same visible item by key and preserves its screen position. While pinned, a
  changing measurement for the streaming last item keeps the bottom pinned.
- `followOnAppend: boolean | 'auto' | 'smooth' | 'instant'`: follows appended
  output only if the viewport was already at the end; it does not yank a reader
  away from older history.
- `scrollEndThreshold`: pixel distance used to decide what “at the end” means.
- `scrollToEnd()`, `getDistanceFromEnd()`, and `isAtEnd()`: imperative/query
  helpers for initial positioning and “Jump to latest” UI.
- Stable `getItemKey` values are mandatory for prepend stability. Array indexes
  cannot identify the same message after older items are inserted.
- `measureElement` is used for dynamic message heights; `estimateSize` supplies
  the initial estimate and `overscan` controls extra mounted rows.

([Chat guide and production checklist](https://tanstack.com/virtual/latest/docs/chat),
[Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer),
[official React example](https://tanstack.com/virtual/latest/docs/framework/react/examples/chat),
[core type/source](https://github.com/TanStack/virtual/blob/main/packages/virtual-core/src/index.ts))

The official React example also enables `directDomUpdates`, which lets the
virtualizer update scroll-only positions and the inner container size without a
React render. It imposes a stricter DOM contract (`containerRef`, absolute item
positioning, and no app-owned main-axis transform). This is an optimization, not
needed for the first Ticketry integration; the adapter docs recommend satisfying
those requirements when it is enabled. ([React adapter's
`directDomUpdates` documentation](https://tanstack.com/virtual/latest/docs/framework/react/react-virtual))

## Backend and transport assumptions

There are effectively none. TanStack's production checklist explicitly keeps
network loading outside the virtualizer: the application fetches history and
prepends or appends ordinary data. The virtualizer accepts a count and item-key
function and observes DOM size/scroll state. It does not define or require:

- HTTP, SSE, WebSocket, JSON-RPC, AG-UI, or any other transport;
- a server or provider runtime;
- message, turn, tool-call, reasoning, or approval schemas;
- transcript storage, reconnection, pagination, or multi-client consistency;
- markdown rendering, sanitization, composer behavior, or accessibility
  semantics for the content.

([Chat guide](https://tanstack.com/virtual/latest/docs/chat), [core
Virtualizer options](https://github.com/TanStack/virtual/blob/main/packages/virtual-core/src/index.ts))

That makes it transport-compatible with Ticketry's Django/Channels backend, but
only after Ticketry exposes structured messages. It would work equally well if
that transport is an initial REST snapshot plus WebSocket deltas, SSE, or AG-UI.

## Alternate candidate: `@tanstack/ai-react-ui`

If “chat interface” refers to the new TanStack AI UI package rather than the
TanStack Virtual announcement, this is the exact product. Its package
description is “Headless React components for building TanStack AI chat
interfaces with streamed message parts.” At this snapshot it is version
`0.8.16`, MIT licensed, ESM-only, and declares React/React DOM 18 or 19 plus
`@tanstack/ai-client` and `@tanstack/ai-react` as peers. It also brings its own
markdown stack: `react-markdown`, GFM, raw HTML, sanitization, and syntax
highlighting packages. ([official package source](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/package.json),
[official license](https://github.com/TanStack/ai/blob/main/LICENSE))

The likely minimum client installation is therefore:

```sh
npm install \
  @tanstack/ai-client \
  @tanstack/ai-react \
  @tanstack/ai-react-ui \
  --workspace @worktracker/studio
```

Provider adapters and `@tanstack/ai` itself are additionally needed only if the
server is implemented with TanStack AI's TypeScript runtime. Ticketry's Django
backend could instead expose a compatible connection/stream; the root `Chat`
component requires a TanStack `ConnectionAdapter`, not a particular provider or
web framework. ([`Chat` source and props](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/src/chat.tsx),
[`ConnectionAdapter`/`ChatClient` API](https://tanstack.com/ai/latest/docs/api/ai-client))

### Surface and architecture

The package exports:

- `Chat` and `useChatContext`: a context root that calls TanStack AI's `useChat`;
- `ChatMessages`: maps the client's `UIMessage[]`, with empty/loading/error
  slots and basic auto-scroll;
- `ChatMessage`: renders TanStack AI text, thinking, tool-call, and tool-result
  parts, with render-prop overrides and named tool renderers;
- `ChatInput`: local composer state and `sendMessage` integration;
- `ToolApproval`: approve/deny actions wired to
  `addToolApprovalResponse`;
- `TextPart` and `ThinkingPart`: markdown/highlighting and collapsible reasoning;
- convenient re-exports of `useChat` and TanStack AI message/connection types.

([public exports](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/src/index.ts),
[`ChatMessage` source](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/src/chat-message.tsx),
[`ChatInput` source](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/src/chat-input.tsx),
[`ToolApproval` source](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/src/tool-approval.tsx),
[`TextPart` source](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/src/text-part.tsx))

The root usage is intentionally small:

```tsx
<Chat connection={connection} initialMessages={messages}>
  <ChatMessages>
    {(message) => <ChatMessage message={message} />}
  </ChatMessages>
  <ChatInput />
</Chat>
```

The headless claim means consumers can use class names and render props, but
some defaults do include inline styling and presentation. Ticketry would almost
certainly use the render-prop paths to preserve its design system.

### Maturity and protocol assumptions

TanStack AI as a whole reached **beta** on 2026-06-09. TanStack says the core
APIs are stable and the protocol is documented and versioned. The React UI
package itself remains 0.x, so its component API should still be treated as
evolving even though it is publicly published. ([beta
announcement](https://tanstack.com/blog/tanstack-ai-beta), [package
version](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/package.json))

TanStack AI's headless `ChatClient` owns streaming message state, tool execution,
approval flows, and connection management. The framework hooks wrap that same
client. Its native wire format is AG-UI in both directions; the normal web path
is an AG-UI request followed by streamed AG-UI events over SSE using
`fetchServerSentEvents`. TanStack states that its client can connect to another
AG-UI server and another AG-UI client can connect to a TanStack AI endpoint, so
the TypeScript TanStack server runtime is optional. ([client
architecture](https://tanstack.com/ai/latest/docs/api/ai-client), [React
API](https://tanstack.com/ai/latest/docs/api/ai-react), [bidirectional AG-UI
announcement](https://tanstack.com/blog/ag-ui-compliance))

This makes `ai-react-ui` materially different from TanStack Virtual: adopting it
means adopting or translating into TanStack AI's `UIMessage` part graph,
`useChat` lifecycle, tool approval semantics, and connection contract.

### Current reasons not to make it Ticketry's UI foundation

The package is promising, but current primary source shows several reasons to
prototype before committing:

- `ChatMessages` renders every message rather than virtualizing and its
  `autoScroll` effect assigns `scrollTop = scrollHeight` on every `messages`
  change. During streaming this pulls a reader back to the bottom even if they
  intentionally scrolled up—the exact behavior TanStack Virtual's newer chat
  APIs avoid. ([`ChatMessages` source](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/src/chat-messages.tsx),
  [Virtual chat behavior](https://tanstack.com/virtual/latest/docs/chat))
- Its root component's public `ChatProps` declares a `tools` registry, but the
  current implementation neither destructures nor passes that prop into
  `useChat`. This is a concrete sign that the 0.x component layer is still
  settling. ([`Chat` implementation](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/src/chat.tsx))
- Ticketry already chose provider-neutral structured managed-subprocess events
  as the core boundary. Replacing that decision with TanStack AI's client model
  would be an architectural change; adapting the chosen message model to the UI
  package may cost as much as rendering Ticketry-native components.
- Ticketry already depends on `marked` and `isomorphic-dompurify`; the UI package
  adds a second markdown/sanitization stack. That is manageable, but it is not a
  free primitive. ([Ticketry package manifest](../../studio/package.json#L34-L55),
  [`ai-react-ui` dependencies](https://github.com/TanStack/ai/blob/main/packages/ai-react-ui/package.json))

The sensible experiment, after Ticketry has structured events, would be a
throwaway adapter from one Ticketry transcript fixture to TanStack `UIMessage`
plus a custom `ConnectionAdapter`. Compare that against a small native
`ChatTranscript` built on TanStack Virtual. Do not install the entire TanStack AI
server/provider stack just to obtain React renderers.

## Ticketry starting point

Ticketry already uses TanStack Query, React 18.3.1, Vite, and Tauri, but it does
not currently depend on TanStack Virtual. ([Studio package
manifest](../../studio/package.json#L34-L55))

More importantly, the product has no transcript for Virtual to render:

- `AgentRun` persists run metadata and lifecycle state but no messages, parts,
  events, or transcript. ([run model](../../backend/apps/runs/models.py#L8-L39))
- The frontend agent types describe lifecycle and terminal sessions, and the
  workspace tab kinds are `details`, `doc`, and `terminal`; there is no Chat tab
  or message model. ([agent types](../../studio/src/features/agents/types.ts#L1-L46))
- The existing chat architecture decision requires Chat runs to consume a
  structured managed-subprocess protocol rather than parse PTY bytes. Chat and
  Terminal remain distinct run kinds. The current document-chat command opens
  a terminal rather than a message UI.

TanStack Virtual therefore solves one downstream presentation concern. It does
not change the core chat architecture decision.

## Recommended integration shape

### 1. Keep it behind the structured-chat prerequisite

First establish a durable message/part model and a stream with an initial
snapshot plus ordered deltas. Each renderable transcript row needs a persistent,
stable id. A row may be a whole turn, a message, or a deliberate grouped event;
choose that unit before connecting the virtualizer because row identity and
measurement depend on it.

Do not feed terminal scrollback, ANSI output, or arbitrary PTY chunks into this
component. That would make a smoother terminal transcript, not the structured
Chat run Ticketry has already specified.

### 2. Add a small, presentation-only frontend seam

Under the repository's governing feature structure, a sensible ownership shape
is:

```text
studio/src/features/agents/chat/
  ChatTranscript.tsx       # message rendering and semantic content
  ChatTranscriptViewport.tsx # TanStack Virtual setup and scroll policy only
  chatTypes.ts             # frontend projection of the generated API contract
```

`ChatTranscriptViewport` should accept already-ordered rows and callbacks such
as `loadOlder`, and should know nothing about providers or Django. Start with
the standard rendering pattern; profile before adopting `directDomUpdates`.

### 3. Use the documented chat contract

- Keep messages in chronological order; do not use `column-reverse`.
- Key rows by durable backend ids, never indexes.
- Use `anchorTo: 'end'`, `followOnAppend: true`, a tuned
  `scrollEndThreshold`, and `measureElement` on every variable-height row.
- Call `scrollToEnd()` after the initial snapshot mounts.
- Show a “Latest” affordance when `!virtualizer.isAtEnd()`.
- Fetch older transcript pages above the viewport and prepend them normally.
- Treat expanded reasoning, tool results, diffs, and streamed markdown as row
  resize events, not special scroll commands.

### 4. Test behavior, not implementation

Because this would change user-visible Studio behavior, Ticketry's repository
rules require an automated acceptance case in `studio/src/test/*Acceptance.test.tsx`
and the overhaul gate. The valuable acceptance scenarios are:

1. initial transcript opens at latest;
2. streamed growth remains pinned when already at latest;
3. streamed/appended output does not steal position after the user scrolls up;
4. prepending older history keeps the same keyed message in place;
5. “Latest” appears away from the end and returns the viewport to the end;
6. expanding/collapsing a tool or reasoning block does not create a jump.

## Recommendation

Adopt `@tanstack/react-virtual` for Ticketry's Chat transcript viewport once the
structured transcript contract exists. It is a small, framework-compatible,
MIT-licensed dependency that directly addresses the hardest scrolling edge
cases for long and streaming agent conversations while preserving Ticketry's
markup and visual design.

Do **not** begin the chat build by integrating it, and do not adopt the larger
TanStack AI stack merely to obtain this behavior. The critical-path work remains
the structured agent adapter, persisted transcript, and snapshot-plus-delta
transport. Once there are real rows to render, TanStack Virtual is the right
scrolling primitive and should be a contained frontend dependency.
