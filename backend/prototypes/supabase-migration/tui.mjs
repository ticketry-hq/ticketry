#!/usr/bin/env node
// PROTOTYPE — interactive shell over the pure migration-boundary reducer.

import readline from "node:readline";
import { initialState, reduce } from "./model.mjs";

const bold = "\x1b[1m";
const dim = "\x1b[2m";
const yellow = "\x1b[33m";
const reset = "\x1b[0m";
let state = initialState();

function line(label, value) {
  return `${bold}${label.padEnd(22)}${reset} ${value}`;
}

function render() {
  console.clear();
  console.log(`${bold}Ticketry → Supabase boundary prototype${reset}`);
  console.log(`${dim}Question: cloud collaboration plane, local execution plane?${reset}\n`);
  console.log(`${bold}CONNECTION${reset}`);
  console.log(line("network", state.network.online ? "online" : "OFFLINE"));
  console.log(line("auth", state.studio.auth));
  console.log(line("realtime", state.studio.realtime));
  console.log(line("client cursor", state.studio.cursor));
  console.log(line("pending cloud events", state.studio.pendingChanges));
  console.log(`\n${bold}WORK ITEM PROJECTION${reset}`);
  console.log(line("Studio sees", `${state.studio.item.key} · ${state.studio.item.state} · r${state.studio.item.revision}`));
  console.log(line("Supabase has", `${state.supabase.item.key} · ${state.supabase.item.state} · r${state.supabase.item.revision}`));
  console.log(line("last cloud writer", state.supabase.item.updatedBy));
  console.log(`\n${bold}LOCAL RUNTIME${reset}`);
  console.log(line("policy/API", state.sidecar.api));
  console.log(line("worktree", state.sidecar.worktree));
  console.log(line("tmux sessions", state.sidecar.tmuxSessions.length || "none"));
  console.log(line("shared run rows", state.supabase.runLedger.length || "none"));
  console.log(`\n${yellow}${bold}OUTCOME${reset}\n${state.lastOutcome}`);
  console.log(`\n${bold}[m]${reset}${dim} move via Django  ${reset}${bold}[c]${reset}${dim} collaborator move  ${reset}${bold}[d]${reset}${dim} direct DB bypass${reset}`);
  console.log(`${bold}[l]${reset}${dim} launch agent     ${reset}${bold}[o]${reset}${dim} online/offline     ${reset}${bold}[s]${reset}${dim} sync/reconnect${reset}`);
  console.log(`${bold}[r]${reset}${dim} reset            ${reset}${bold}[q]${reset}${dim} quit${reset}`);
}

const actions = {
  m: { type: "LOCAL_MOVE" },
  c: { type: "REMOTE_MOVE" },
  d: { type: "DIRECT_MOVE" },
  l: { type: "LAUNCH_AGENT" },
  o: { type: "TOGGLE_NETWORK" },
  s: { type: "SYNC" },
  r: { type: "RESET" },
};

function dispatch(key) {
  if (key === "q" || key === "\u0003") {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    return;
  }
  if (actions[key]) state = reduce(state, actions[key]);
  render();
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on("keypress", (text, key) => dispatch(key?.sequence ?? text));
render();
