//! What a launch is allowed to be, before anything is spawned.
//!
//! Every agent run starts as a request — launch this Work Item, this module,
//! this document, with this agent and this free text — and this crate is the
//! part of that path that decides, rather than executes. [`terminal_session`]
//! is the caller-owned request contract itself, owned here because launch
//! authority resolves it and the terminal slice executes it.
//! [`authority`] answers the one question asked before anything is persisted:
//! what launch policy actually governs this run, drawn from the Work Item, its
//! module and the global default rather than from the caller. [`paths`] fixes
//! where the run may start — its working directory and its design directory —
//! against the worktree that owns them. [`planning`] resolves durable launch
//! material into the concrete provider command, hook wiring, MCP endpoint and
//! settings overlay an effect executes with. [`trace_reasons`] renders this
//! crate's refusal codes as the stable names the launch trace in
//! `ticketry-diagnostics` reports; the trace emitter itself lives there so
//! nothing below launch has to read back up into it.

pub mod authority;
pub mod paths;
pub mod planning;
pub mod terminal_session;
pub mod trace_reasons;
