# Third-party notices

Ticketry is licensed under the MIT License (see [`LICENSE`](LICENSE)). It
incorporates or builds against the following third-party software.

## Ghostty / libghostty

The desktop application's native terminal support links against
`libghostty`, built from [Ghostty](https://github.com/ghostty-org/ghostty).
Ghostty sources are not vendored in this repository: the build script
`studio/scripts/prepare-libghostty.sh` clones Ghostty v1.3.1 (commit
`332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28`), applies a committed
native-static build patch, and writes the generated header and static
library to `studio/src-tauri/vendor/libghostty/` (see the README in that
directory). Generated artifacts are not committed.

Ghostty (https://github.com/ghostty-org/ghostty) is distributed under the
MIT License, Copyright (c) Mitchell Hashimoto. Refer to the `LICENSE` file
in the Ghostty repository at the pinned revision for the authoritative
license text.

## Vendored agent skills (Matt Pocock)

The agent skill definitions vendored under
`studio/src-tauri/resources/launch/` are derived from upstream work by
Matt Pocock and are distributed under the MIT License,
Copyright (c) 2026 Matt Pocock. The full upstream license text is included
at [`studio/src-tauri/resources/launch/UPSTREAM_LICENSE`](studio/src-tauri/resources/launch/UPSTREAM_LICENSE).
