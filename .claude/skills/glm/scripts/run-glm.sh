#!/usr/bin/env bash

set -euo pipefail

model="opencode-go/glm-5.3-flash"
variant="high"
agent="build"
project_root="${CLAUDE_PROJECT_DIR:-$(pwd -P)}"

if [[ ! -d "$project_root" ]]; then
  echo "Claude project directory does not exist: $project_root" >&2
  exit 2
fi

project_root="$(CDPATH= cd -- "$project_root" && pwd -P)"

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode is not installed or is not on PATH" >&2
  exit 127
fi

read_prompt() {
  local prompt
  prompt="$(</dev/stdin)"
  if [[ -z "${prompt//[[:space:]]/}" ]]; then
    echo "worker prompt must be supplied on stdin" >&2
    exit 2
  fi
  printf '%s' "$prompt"
}

mode="${1:-}"

case "$mode" in
  check)
    printf 'project_root=%s\n' "$project_root"
    printf 'model=%s\n' "$model"
    printf 'variant=%s\n' "$variant"
    printf 'agent=%s\n' "$agent"
    opencode --version
    if ! opencode models opencode-go | rg -Fx -- "$model" >/dev/null; then
      echo "OpenCode model is unavailable: $model" >&2
      exit 69
    fi
    ;;
  start)
    prompt="$(read_prompt)"
    exec opencode run \
      --dir "$project_root" \
      --model "$model" \
      --variant "$variant" \
      --agent "$agent" \
      --format json \
      --title "ticketry-glm-worker" \
      "$prompt"
    ;;
  resume)
    session_id="${2:-}"
    if [[ ! "$session_id" =~ ^ses_[[:alnum:]_-]+$ ]]; then
      echo "resume requires the ses_... ID emitted in OpenCode's sessionID field" >&2
      exit 2
    fi
    prompt="$(read_prompt)"
    exec opencode run \
      --dir "$project_root" \
      --session "$session_id" \
      --model "$model" \
      --variant "$variant" \
      --agent "$agent" \
      --format json \
      "$prompt"
    ;;
  *)
    echo "usage: run-glm.sh check | start | resume <session-id>" >&2
    exit 2
    ;;
esac
