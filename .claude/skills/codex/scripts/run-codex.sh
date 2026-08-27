#!/usr/bin/env bash

set -euo pipefail

codex_model="${CODEX_FANOUT_MODEL:-gpt-5.6-sol}"
reasoning_effort="${CODEX_FANOUT_REASONING_EFFORT:-high}"

resolve_worktree() {
  local candidate="${1:-}"
  if [[ -z "$candidate" || ! -d "$candidate" ]]; then
    echo "Codex worktree does not exist: $candidate" >&2
    exit 2
  fi
  CDPATH= cd -- "$candidate" && pwd -P
}

if ! command -v codex >/dev/null 2>&1; then
  echo "codex is not installed or is not on PATH" >&2
  exit 127
fi

mode="${1:-}"

case "$mode" in
  check)
    project_root="${CLAUDE_PROJECT_DIR:-$(pwd -P)}"
    project_root="$(resolve_worktree "$project_root")"
    printf 'project_root=%s\n' "$project_root"
    printf 'model=%s\n' "$codex_model"
    printf 'reasoning_effort=%s\n' "$reasoning_effort"
    codex --version
    ;;
  start)
    worktree="$(resolve_worktree "${2:-}")"
    exec codex exec \
      --sandbox workspace-write \
      --approve-for-me \
      --model "$codex_model" \
      --config "model_reasoning_effort=\"$reasoning_effort\"" \
      --cd "$worktree" \
      --json \
      -
    ;;
  resume)
    worktree="$(resolve_worktree "${2:-}")"
    thread_id="${3:-}"
    if [[ ! "$thread_id" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]]; then
      echo "resume requires the UUID emitted by Codex's thread.started event" >&2
      exit 2
    fi
    exec codex exec \
      --sandbox workspace-write \
      --approve-for-me \
      --model "$codex_model" \
      --config "model_reasoning_effort=\"$reasoning_effort\"" \
      --cd "$worktree" \
      --json \
      resume "$thread_id" \
      -
    ;;
  *)
    echo "usage: run-codex.sh check | start <worktree> | resume <worktree> <thread-id>" >&2
    exit 2
    ;;
esac
