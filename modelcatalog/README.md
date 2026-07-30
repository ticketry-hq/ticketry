# Ticketry Model Atlas

This is the deliberately narrow companion to the full architecture catalog. It
shows only:

1. the complete backend persistence and frontend projection model;
2. the ubiquitous language generated from Ticketry's five context glossaries.

From the repository root:

```sh
npm run catalog:model
```

Open <http://localhost:3200>.

The language sync runs before every development build and reads the authoritative
`CONTEXT.md` files. Each displayed term links to the nearest backend model or
frontend store in the data-model section.
