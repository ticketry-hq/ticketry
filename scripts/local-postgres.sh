#!/usr/bin/env bash
# Manage Ticketry's opt-in, user-level Postgres database on macOS without Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FORMULA="${TICKETRY_POSTGRES_FORMULA:-postgresql@17}"
DATABASE_NAME="${TICKETRY_POSTGRES_DATABASE:-ticketry}"
DATABASE_URL_FILE="${MUXED_DATABASE_URL_FILE:-${HOME:?HOME is required}/.config/worktracker-studio/database-url}"
DATABASE_ENABLE_FILE="${DATABASE_URL_FILE}.enabled"

if [[ ! "$DATABASE_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]; then
  echo "TICKETRY_POSTGRES_DATABASE contains unsupported characters: $DATABASE_NAME" >&2
  exit 2
fi

postgres_bin() {
  local prefix
  prefix="$(brew --prefix "$FORMULA" 2>/dev/null)" || return 1
  printf '%s/bin' "$prefix"
}

wait_for_postgres() {
  local bin="$1"
  local attempt
  for attempt in {1..30}; do
    if "$bin/pg_isready" -q -d postgres; then
      return 0
    fi
    sleep 1
  done
  echo "Postgres did not become ready after 30 seconds." >&2
  return 1
}

setup() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required to install local Postgres on macOS." >&2
    exit 1
  fi
  if ! brew list --formula "$FORMULA" >/dev/null 2>&1; then
    echo "==> Installing $FORMULA"
    brew install "$FORMULA"
  fi

  local bin database_url config_dir temporary_file
  bin="$(postgres_bin)"
  echo "==> Starting $FORMULA"
  brew services start "$FORMULA"
  wait_for_postgres "$bin"

  if ! "$bin/psql" -d postgres -Atqc \
    "SELECT 1 FROM pg_database WHERE datname = '$DATABASE_NAME'" | grep -qx 1; then
    echo "==> Creating database $DATABASE_NAME"
    "$bin/createdb" "$DATABASE_NAME"
  fi

  database_url="postgresql:///$DATABASE_NAME"
  config_dir="$(dirname "$DATABASE_URL_FILE")"
  mkdir -p "$config_dir"
  temporary_file="$(mktemp "$config_dir/.database-url.XXXXXX")"
  chmod 600 "$temporary_file"
  printf '%s\n' "$database_url" >"$temporary_file"
  mv "$temporary_file" "$DATABASE_URL_FILE"

  echo "==> Installing the Postgres driver and applying Ticketry migrations"
  (cd "$ROOT/backend" && uv sync --extra dev)
  (cd "$ROOT/backend" && MUXED_ENABLE_LOCAL_POSTGRES=true MUXED_DATABASE_URL="$database_url" uv run python manage.py migrate --noinput)
  (cd "$ROOT/backend" && MUXED_ENABLE_LOCAL_POSTGRES=true MUXED_DATABASE_URL="$database_url" uv run python manage.py provision)

  temporary_file="$(mktemp "$config_dir/.database-url-enabled.XXXXXX")"
  chmod 600 "$temporary_file"
  printf 'enabled\n' >"$temporary_file"
  mv "$temporary_file" "$DATABASE_ENABLE_FILE"

  echo "==> Shared Ticketry database is ready"
  echo "database=$DATABASE_NAME"
  echo "config=$DATABASE_URL_FILE"
  echo "This user's local development and installed Ticketry app now use it."
}

status() {
  local bin
  if [[ ! -f "$DATABASE_URL_FILE" || ! -f "$DATABASE_ENABLE_FILE" ]]; then
    echo "Ticketry shared Postgres is disabled (no $DATABASE_URL_FILE)."
    exit 1
  fi
  echo "config=$DATABASE_URL_FILE"
  if bin="$(postgres_bin)" && "$bin/pg_isready" -q -d "$DATABASE_NAME"; then
    echo "status=ready"
  else
    echo "status=unavailable"
    exit 1
  fi
}

disable() {
  if [[ -f "$DATABASE_ENABLE_FILE" ]]; then
    rm "$DATABASE_ENABLE_FILE"
  fi
  if [[ -f "$DATABASE_URL_FILE" ]]; then
    rm "$DATABASE_URL_FILE"
  fi
  echo "Ticketry shared Postgres is disabled. Existing Postgres data was not deleted."
  echo "New launches will use their existing per-instance SQLite database."
}

case "${1:-}" in
  setup) setup ;;
  status) status ;;
  disable) disable ;;
  *)
    echo "usage: scripts/local-postgres.sh {setup|status|disable}" >&2
    exit 2
    ;;
esac
