# Shipping caller inventory

CODING-993 checks callers before CODING-994 deletes the retired implementations.
"Retained" below means the file may still exist as an unreachable deletion target.

| Caller group | Shipping route | Evidence |
| --- | --- | --- |
| Studio reads and writes | Owned GraphQL documents through TauRPC | `scripts/shipping-caller-gate.mjs`, numbered acceptance 158 |
| Status feed | In-process GraphQL subscription | `studio/src/runtime/contract.ts` and existing status acceptance |
| Terminal sessions and bytes | Rust GraphQL lifecycle plus native Tauri renderer | numbered terminal transport acceptance |
| Documents and worktrees | Rust GraphQL plus read-only document protocol | numbered acceptance 97 |
| Module-folder validation | Narrow `desktop_validate_module_folder` Tauri command | `studio/src-tauri/src/desktop/commands.rs` |
| Provider hooks | Atomic files in the Rust-owned lifecycle spool | `ticketry_hook.rs`; Rust lifecycle acceptance |
| Provider work-management tools | Authenticated in-process Rust MCP listener | CODING-992 acceptance suite |
| MCP registration | OS-assigned loopback listener, run-scoped authority | CODING-992 listener tests |
| Browser development | Owned GraphQL documents through `/graphql` adapter | numbered acceptance 158; `studio/vite.proxy.ts` |
| Browser command | Rust GraphQL adapter plus Vite; no Django or FastMCP launch | root `web` script |
| Generated REST SDK | No import reachable from `studio/src/main.tsx` | shipping caller gate |
| Status and terminal WebSockets | No reachable constructor or retired URL | shipping caller gate |
| Tests | Desktop and browser GraphQL acceptance paths | overhaul gate |
| Copied-data adoption | Rust-owned in-place adoption on a disposable production snapshot copy | CODING-993 implementation evidence |

## Correction ledger

Browser development no longer promises the old REST, status-socket, or terminal-socket behavior. It uses the Rust GraphQL adapter and has no subscription or native terminal capability. Browser folder entry checks absolute-path syntax; desktop performs the filesystem check through the native command. Numbered acceptance 158 fixes that boundary in place.

The legacy HTTP clients, WebSocket fixtures, service packaging, and SDK sources are deletion targets owned by CODING-994. They are not reachable from the Studio entry point, release commands, or the canonical browser command.
