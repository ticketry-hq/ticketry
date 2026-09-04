#!/usr/bin/env bash

set -euo pipefail

model="gpt-5.6-sol"
reasoning_effort="high"

project_root="${CLAUDE_PROJECT_DIR:-$(pwd -P)}"

if [[ ! -d "$project_root" ]]; then
  echo "Claude project directory does not exist: $project_root" >&2
  exit 2
fi

project_root="$(CDPATH= cd -- "$project_root" && pwd -P)"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex is not installed or is not on PATH" >&2
  exit 127
fi

mode="${1:-}"

case "$mode" in
  check)
    printf 'project_root=%s\n' "$project_root"
    printf 'model=%s\n' "$model"
    printf 'reasoning_effort=%s\n' "$reasoning_effort"
    codex --version
    ;;
  start)
    exec codex exec \
      --sandbox workspace-write \
      --approve-for-me \
      --model "$model" \
      --config "model_reasoning_effort=\"$reasoning_effort\"" \
      --cd "$project_root" \
      --json \
      -
    ;;
  resume)
    thread_id="${2:-}"
    if [[ ! "$thread_id" =~ ^[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}$ ]]; then
      echo "resume requires the UUID emitted by Codex's thread.started event" >&2
      exit 2
    fi
    exec codex exec \
      --sandbox workspace-write \
      --approve-for-me \
      --model "$model" \
      --config "model_reasoning_effort=\"$reasoning_effort\"" \
      --cd "$project_root" \
      --json \
      resume "$thread_id" \
      -
    ;;
  *)
    echo "usage: run-codex.sh check | start | resume <thread-id>" >&2
    exit 2
    ;;
esac
