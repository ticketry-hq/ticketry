# libghostty build output

Run `npm run libghostty:prepare` from `studio/` before building the
macOS native-terminal spike. The script checks out Ghostty v1.3.1 at
`332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28`, applies the committed
native-static build patch, and writes `include/ghostty.h`, `lib/libghostty.a`,
and `REVISION` here.

Generated library artifacts are intentionally ignored.
