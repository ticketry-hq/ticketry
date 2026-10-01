#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"

if [[ $(uname -s) != Linux ]] || ! command -v apt-get >/dev/null; then
  echo 'Cloud installation requires Debian/Ubuntu Linux. See scripts/codex-cloud/README.md.' >&2
  exit 1
fi
if ! command -v node >/dev/null || [[ $(node -p 'process.versions.node.split(".")[0]') != 22 ]]; then
  echo 'Select Node.js 22 in the cloud environment before running this installer.' >&2
  exit 1
fi

privilege=()
if [[ $EUID != 0 ]]; then privilege=(sudo); fi
"${privilege[@]}" apt-get update
"${privilege[@]}" env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
  build-essential ca-certificates curl git pkg-config tmux \
  libwebkit2gtk-4.1-dev libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

export PATH="${CARGO_HOME:-$HOME/.cargo}/bin:$PATH"
if ! command -v rustup >/dev/null; then
  rustup_installer=$(mktemp)
  trap 'rm -f "$rustup_installer"' EXIT
  curl --fail --location --proto '=https' --tlsv1.2 https://sh.rustup.rs -o "$rustup_installer"
  sh "$rustup_installer" -y --profile minimal --default-toolchain none
fi

# Read the repository pins rather than maintaining another Rust/SeaORM version.
rust_version=$(sed -n 's/^channel = "\([^"]*\)"/\1/p' studio/src-tauri/rust-toolchain.toml)
seaorm_version=$(awk '/^name = "sea-orm-cli"$/ { found=1; next } found && /^version = / { gsub(/"/, "", $3); print $3; exit }' studio/src-tauri/Cargo.lock)
[[ -n $rust_version && -n $seaorm_version ]]
rustup toolchain install "$rust_version" --profile minimal --component clippy --component rustfmt

# npm's lockfile contains an SSH GitHub URL. Rewrite it for this process and
# its children without changing personal Git configuration or the lockfile.
git_config_index=${GIT_CONFIG_COUNT:-0}
for github_prefix in 'ssh://git@github.com/' 'git@github.com:'; do
  export "GIT_CONFIG_KEY_${git_config_index}=url.https://github.com/.insteadOf"
  export "GIT_CONFIG_VALUE_${git_config_index}=$github_prefix"
  git_config_index=$((git_config_index + 1))
done
export GIT_CONFIG_COUNT=$git_config_index
export GIT_TERMINAL_PROMPT=0

npm ci --no-audit --no-fund
if [[ $(sea-orm-cli --version 2>/dev/null || true) != "sea-orm-cli $seaorm_version" ]]; then
  cargo +"$rust_version" install sea-orm-cli --version "$seaorm_version" --locked \
    --no-default-features --features codegen,sqlx-sqlite,runtime-tokio-rustls
fi
npm exec --workspace @worktracker/studio -- playwright install --with-deps chromium

cargo fetch --locked --manifest-path studio/src-tauri/Cargo.toml
cargo build --locked --manifest-path studio/src-tauri/Cargo.toml \
  -p ticketry-dev-tools -p ticketry-hook --bins
cargo test --locked --manifest-path studio/src-tauri/Cargo.toml \
  --workspace --exclude ticketry --exclude ticketry-desktop --no-run

echo 'Cloud dependencies and portable Rust test binaries are prepared.'
echo 'Run bash scripts/codex-cloud/check.sh all before publishing.'
