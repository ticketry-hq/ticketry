# OpenCode Go GLM-5.3-Flash inside Codex

Research snapshot: 2026-08-27. Sources are limited to official product docs and
the projects' own repositories, source, releases, pull requests, and issue
trackers.

## Recommendation

Use [lidge-jun/opencodex](https://github.com/lidge-jun/opencodex) for this
specific goal. It has a maintained built-in `opencode-go` provider pointed at
`https://opencode.ai/zen/go/v1`, translates Chat Completions for Codex, supports
the Codex App and CLI, and exposes routed models to Codex subagents.

Most importantly, its documented v1 collaboration surface allows a native
ChatGPT parent to select a routed child model directly. OpenCodex recommends v1
when cross-provider delegation must work predictably. Its v2 mode has the same
encrypted native-to-routed task limitation as other integrations, so configure
`ocx v2 mode v1` for a GPT parent delegating to
`opencode-go/glm-5.3-flash`.
([provider guide](https://opencodex.me/guides/providers/),
[subagent guide](https://opencodex.me/guides/sub-agent-surface/))

[duolahypercho/codex-router](https://github.com/duolahypercho/codex-router) is
the strongest alternative if the main goal is putting OpenCode Go models in
Codex's normal model picker with less emphasis on heterogeneous subagents.

There are two caveats:

1. In Codex Router, GLM-5.3-Flash support is on `main`, not in the latest
   `v0.5.0` release. The
   repository merged the route on August 26 and lists it as
   `opencode-go/glm-5.3-flash`; the changelog still calls it unreleased.
   ([main README](https://github.com/duolahypercho/codex-router#opencode-go-subscription-and-zen),
   [commit history](https://github.com/duolahypercho/codex-router/commits/main),
   [changelog](https://github.com/duolahypercho/codex-router/blob/main/CHANGELOG.md),
   [latest release](https://github.com/duolahypercho/codex-router/releases/tag/v0.5.0))
2. Do not use v2 for a ChatGPT-signed native GPT parent delegating to GLM.
   OpenCodex documents that ChatGPT-native parents encrypt v2 task bodies, which
   external providers cannot read. Its v1 surface is the supported workaround.
   Codex Router's own live certification
   work says Codex refuses non-OpenAI children in that authentication mode.
   OpenAI's tracker also records custom-provider multi-agent behavior as an
   open product and protocol gap. Single-agent inference works, and local
   client-side spawning may work, but that is not the same as the first-party
   multi-agent path.
   ([Codex Router subagent PR](https://github.com/duolahypercho/codex-router/pull/439),
   [OpenAI Codex issue #37858](https://github.com/openai/codex/issues/37858))

The recommended setup path is therefore:

- install OpenCodex and choose its built-in `opencode-go` provider;
- enter the OpenCode Go API key through its provider setup rather than writing
  it into Codex configuration;
- confirm `opencode-go/glm-5.3-flash` appears and works as a normal routed
  model;
- set `ocx v2 mode v1`, add `opencode-go/glm-5.3-flash` to the subagent roster,
  then start a new Codex session;
- verify one tool-using GLM child task before relying on the route for larger
  work.

This is near-native today. Calling the exact mixed-provider child path solved
without qualification would overstate the evidence.

## Why a bridge is required

OpenCode's current Go documentation lists GLM-5.3-Flash as model ID
`glm-5.3-flash` at
`https://opencode.ai/zen/go/v1/chat/completions`. The Go subscription supplies
an API key and also exposes a models endpoint at
`https://opencode.ai/zen/go/v1/models`.
([OpenCode Go documentation](https://opencode.ai/docs/go/))

Current Codex no longer accepts `wire_api = "chat"`. Its provider enum contains
only `Responses`, and selecting `chat` returns a removal error. OpenAI announced
the removal for February 2026 and told custom-provider users to expose the
Responses API.
([Codex provider source](https://github.com/openai/codex/blob/main/codex-rs/model-provider-info/src/lib.rs),
[deprecation discussion](https://github.com/openai/codex/discussions/7782),
[official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference))

The missing piece is a local process that accepts Codex's `/v1/responses`
traffic, translates it to Chat Completions, then turns streamed text and tool
calls back into Responses events.

Current Codex HTTP turns ask for SSE, send `stream: true` and `store: false`,
and normally include the complete conversation in `input`. A bridge must return
complete assistant or function-call items in `response.output_item.done` and
finish with `response.completed`; argument-delta events alone are insufficient.
([Codex Responses endpoint](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/responses.rs),
[Codex SSE parser](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/sse/responses.rs))

Function calls are only the minimum. Codex can also send freeform `custom`,
`namespace`, `tool_search`, and `web_search` tool definitions. The projects
below document ordinary function tools, and Codex Router now has a dedicated
`tool_search` adapter, but I found no end-to-end claim that the OpenCode Go GLM
route preserves every current tool shape. Treat basic coding tools as the
target, not complete first-party parity.
([Codex tool specification](https://github.com/openai/codex/blob/main/codex-rs/tools/src/tool_spec.rs),
[Codex Router v0.5.0 release](https://github.com/duolahypercho/codex-router/releases/tag/v0.5.0))

## Existing options

| Project | What it covers | Streaming and tools | OpenCode Go and GLM-5.3-Flash | Maintenance signal | Verdict |
| --- | --- | --- | --- | --- | --- |
| [OpenCodex](https://github.com/lidge-jun/opencodex) | Full Codex App/CLI proxy, provider registry, model routing, subagent roster and fallbacks, dashboard, diagnostics, restore | Translates Responses to provider protocols and documents heterogeneous subagent behavior across v1/base/v2 | Built-in `opencode-go` preset at the canonical Go endpoint; live model discovery should expose `glm-5.3-flash` | Large, actively maintained community project with dedicated provider and subagent documentation | Best fit for GPT parent to GLM child. Use v1, not v2, for readable cross-provider task delivery. |
| [Codex Router](https://github.com/duolahypercho/codex-router) | Full Codex integration: local Responses endpoint, LiteLLM translation, provider credentials, merged catalog, picker entries, subagent definitions, diagnostics, update and rollback | The project says it preserves streaming and tool-call shapes. Its subagent gate tests a streamed response, forced tool call, child marker return, and same-thread follow-up. | Explicit provider family for Go's Chat Completions, Messages, and Responses models. `opencode-go/glm-5.3-flash` is on `main`. | 947 commits, active commits on August 26, 2026, and `v0.5.0` released the same day. | Best fit, but use `main` for Flash and verify the child path locally. |
| [MetaFARS/codex-relay](https://github.com/MetaFARS/codex-relay) | Focused Responses to Chat Completions proxy plus model catalog generation | Explicit SSE event sequencing, tool calls, parallel tool calls, GLM reasoning handling, and retained `previous_response_id` history. Offline Codex fixtures and gated live-provider tests are documented. | No OpenCode-specific preset, but its upstream can be any compatible base URL. The Go base URL should fit mechanically. | 93 commits, 29 forks, active GLM and Codex compatibility work; an OpenAI Codex issue documents it as a working bridge. | Best small bridge if picker and credential management are unnecessary. OpenCode Go remains an unverified configuration rather than a shipped integration. |
| [LiteLLM](https://github.com/BerriAI/litellm) | General AI gateway with an opt-in `/responses` to `/chat/completions` bridge | Documents both blocking and streaming Responses events and Chat Completions translation. Tool support is broad, but Codex-specific request changes are not its sole focus. | Can route an OpenAI-compatible custom base URL using `use_chat_completions_api: true`; no OpenCode Go package is required. | Large, actively maintained project. | Sound translation engine, but more configuration and operational weight than `codex-relay`; Codex Router already packages it for this exact use. |
| [lininn/codex-proxy](https://github.com/lininn/codex-proxy) | Local Responses proxy for Chat Completions and Anthropic Messages | Claims SSE translation and multiple provider profiles. | Generic base URL only. | One star, no releases shown. | Functional-looking alternative, but much weaker evidence and maintenance than the first two. |
| [DrOetker747/codex-model-router](https://github.com/DrOetker747/codex-model-router) | Fork of Codex Router with a separate parallel CLI-agent runner and key rotation | Claims per-model in-app profiles plus an out-of-app CLI fan-out and mailbox. | Explicit OpenCode Go support, but its published model list predates GLM-5.3-Flash. | New fork, one fork, no release, and claims exceed the limitations recorded upstream. | Interesting CLI fallback, not the first installation choice. |

LiteLLM explicitly documents the relevant setting for a third-party compatible
endpoint: `use_chat_completions_api: true` forces its Responses endpoint to call
the upstream Chat Completions endpoint. Its documentation names Codex CLI as
the client for this bridge.
([LiteLLM Responses API documentation](https://github.com/BerriAI/litellm-docs/blob/main/docs/response_api.md#calling-non-responses-api-endpoints-responses-to-chatcompletions-bridge))

`codex-relay` is smaller and more Codex-specific. It documents GLM request
shaping, streamed reasoning, structured and parallel function calls, tool
round-trip logging, and session history for `previous_response_id`. An open
issue in the official Codex repository reports it working for a provider that
only exposes Chat Completions.
([codex-relay README](https://github.com/MetaFARS/codex-relay),
[OpenAI Codex issue #37393](https://github.com/openai/codex/issues/37393))

## What is and is not verified

Verified from primary sources:

- OpenCode Go currently serves GLM-5.3-Flash through Chat Completions.
- Codex currently requires the Responses wire protocol for custom providers.
- OpenCodex has a built-in OpenCode Go provider and documents v1 as the
  predictable surface for native-to-routed subagent delegation.
- Codex Router has a merged OpenCode Go GLM-5.3-Flash route on `main` and an
  active release and test process.
- Codex Router and `codex-relay` both translate Responses and Chat Completions,
  including streamed tool-call shapes.
- Codex Router can publish routed models into Codex's picker and write agent
  definitions.

Not verified:

- a locally observed GLM-5.3-Flash child spawn from this machine's
  ChatGPT-authenticated GPT parent (the documented OpenCodex v1 path still needs
  an end-to-end setup test);
- an accepted v2 certification artifact for this exact provider/model route;
- a released Codex Router package containing GLM-5.3-Flash;
- full equivalence with OpenAI's server-side multi-agent behavior;
- preservation of every Codex-specific freeform, namespace, hosted, and
  tool-search shape through the GLM Chat Completions route.

Those gaps matter because Codex Router itself treats tool calling, encrypted
child payload relay, a marker-return spawn, and a same-thread follow-up as
separate proof requirements. A plain successful chat or tool call is not enough.
([Codex Router installation and certification rules](https://github.com/duolahypercho/codex-router/blob/main/AGENTS.md))
