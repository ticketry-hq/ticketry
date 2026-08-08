# Codex app-server protocol snapshot

`codex_app_server_protocol.schemas.json` and
`codex_app_server_protocol.v2.schemas.json` were generated from
`codex-cli 0.147.0` on 2026-08-08 with:

```console
codex app-server generate-json-schema --experimental --out <temporary-directory>
```

SHA-256:

- complete bidirectional wire bundle:
  `babfd5c98cd978dd858b4762cdfbc9fba941e1a0e4053de0050e4082ae1f075a`
- V2 client/notification bundle:
  `ff10829cd75b67297019b39ab508ac699198574663579aa18336b7dc55ea178f`

This is a generated contract fixture, not hand-maintained source. The focused
contract tests validate Ticketry's initialize, thread-start, thread-resume,
turn-start, interrupt, approval, and user-input payloads against them.
Regenerate deliberately when the bundled/approved Codex CLI protocol is
upgraded and review the schema diff together with the runtime adapter changes.
