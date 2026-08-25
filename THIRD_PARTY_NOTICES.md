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

Ghostty is distributed under the following license:

```text
MIT License

Copyright (c) 2024 Mitchell Hashimoto, Ghostty contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Vendored agent skills (Matt Pocock)

The agent skill definitions vendored under
`backend/apps/terminals/agents/skills/` are derived from upstream work by
Matt Pocock and are distributed under the MIT License,
Copyright (c) 2026 Matt Pocock. The full upstream license text is included
at [`backend/apps/terminals/agents/skills/UPSTREAM_LICENSE`](backend/apps/terminals/agents/skills/UPSTREAM_LICENSE).

## Diffs, from Pierre (`@pierre/diffs`)

Studio's source-control review surface renders unified diffs with
[`@pierre/diffs`](https://www.npmjs.com/package/@pierre/diffs), pinned at
version 1.3.5 and used stock — no patches are applied. The package is
distributed under the Apache License 2.0, Copyright (c) The Pierre Computer
Company. It is installed from npm rather than vendored here; its full license
text ships in the package as `LICENSE.md`.

## T3 Code

Ticketry's source-control surface follows the product and safety decisions
audited from [T3 Code](https://github.com/t3-oss), which is distributed under
the MIT License, Copyright (c) T3 Tools, Inc. Where a small piece of T3's
frontend behaviour is reproduced — currently the plain-text fallback used when
the diff renderer cannot parse a patch, in
`studio/src/features/source-control/internal/RawPatch.tsx` — the file carries
its attribution inline. No T3 source files are vendored in this repository.
