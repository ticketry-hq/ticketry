#!/usr/bin/env bash
# Local dev runner for the single-view Studio runtime.
#
#   scripts/dev.sh bootstrap   install deps, migrate, provision (one-time setup)
#   scripts/dev.sh backend     run the Django host on :8787
#   scripts/dev.sh studio      run the Studio frontend dev server on :5174
#   scripts/dev.sh test        run every package's test suite
#
# The backend and Studio are separate long-running processes — run each in its
# own terminal.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cmd="${1:-}"
case "$cmd" in
  bootstrap)
    echo "==> Installing backend (+ sdk) deps"
    (cd "$ROOT/backend" && uv sync --extra dev)
    echo "==> Installing workspace deps"
    (cd "$ROOT" && npm ci)
    echo "==> Validating the Studio frontend"
    (cd "$ROOT" && npm run typecheck && npm run test --workspace @worktracker/studio && npm run build --workspace @worktracker/studio)
    echo "==> Migrating the database"
    (cd "$ROOT/backend" && uv run python manage.py migrate)
    echo "==> Provisioning a workspace + admin + token"
    (cd "$ROOT/backend" && uv run python manage.py provision --admin-username admin --admin-password admin)
    echo "==> Done. Set VITE_WT_API_KEY (studio/.env.local) to the printed token."
    ;;
  backend)
    (cd "$ROOT/backend" && uv run python manage.py runserver 127.0.0.1:8787)
    ;;
  studio)
    (cd "$ROOT/studio" && npm run dev)
    ;;
  test)
    (cd "$ROOT/surfaces/worktracker-sdk" && env -u VIRTUAL_ENV uv run --extra dev python -m pytest -q)
    (cd "$ROOT/backend" && env -u VIRTUAL_ENV WORKTRACKER_DISABLE_AUTH=false uv run --extra dev python -m pytest -q)
    (cd "$ROOT/studio" && npm run typecheck && npm test)
    ;;
  *)
    echo "usage: scripts/dev.sh {bootstrap|backend|studio|test}" >&2
    exit 2
    ;;
esac
