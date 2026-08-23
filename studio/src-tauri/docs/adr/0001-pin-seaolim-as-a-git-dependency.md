# Pin seaolim as a Git dependency

Ticketry consumes `seaolim` directly from its separate GitHub repository as a
Cargo Git dependency pinned to an exact revision. This keeps the library
independently versioned and reusable outside Ticketry while making Ticketry
builds resolve reviewed source without depending on a developer's filesystem
layout or embedding the library as a submodule.
