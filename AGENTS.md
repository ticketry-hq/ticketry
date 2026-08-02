# Ticketry desktop application

This repository owns the complete Ticketry desktop application: the React
frontend, Tauri shell, supervised Python backend sidecar, MCP service, and
generated SDKs required by that application.

Use `npm run desktop:dev` or `pnpm run dev` from the repository root for local
desktop development. Both commands rebuild and launch the sidecar. Keep browser-
only service commands as supporting development tools, not as a separate product.

Keep the Tauri/webview boundary narrow. The native terminal renderer consumes a
pinned libghostty revision through its C API, while tmux remains responsible for
durable sessions. Preserve the existing fallback unless a deliberate migration
removes it.

Development data must remain isolated from live application data. Generated
databases, caches, sidecars, native libraries, and build output must not be
committed.