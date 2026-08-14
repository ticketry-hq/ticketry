# Ticketry EventCatalog

This catalog makes Ticketry's domain model, runtime architecture, contracts,
state ownership, and decisions explorable at several levels of detail.

From the repository root:

```sh
npm run catalog:dev
```

Open <http://localhost:3100>. The command regenerates the full sidecar OpenAPI
document before starting EventCatalog. Generated schemas and catalog build output
stay untracked.

## Reading the catalog

- **10,000 ft:** start on the home page and scan the five domains.
- **1,000 ft:** open a domain, then its system context and resource diagrams.
- **100 ft:** inspect services, data stores, flows, messages, and API operations.
- **10 ft:** use entity properties, schemas, source evidence, and model-drift notes.

## Maintenance

Update the nearest resource when a bounded context, service boundary, data owner,
message contract, or architectural decision changes. The catalog is an index of
authoritative evidence, not a replacement for source code:

- domain language remains in each `CONTEXT.md`;
- accepted decisions remain in their original ADR files;
- HTTP details are regenerated from `studio_server.api`;
- WebSocket payloads are traced to the backend and TypeScript wire contracts.

Run `npm run catalog:build` before committing catalog changes.
