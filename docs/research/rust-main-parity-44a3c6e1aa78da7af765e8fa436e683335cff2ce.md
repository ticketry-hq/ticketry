# Main parity review for 44a3c6e1aa78da7af765e8fa436e683335cff2ce

Research snapshot: 2026-08-27. This audit uses only Git objects and repository
files. It does not inspect or modify Ticketry.

## Verdict

Commit `44a3c6e1aa78da7af765e8fa436e683335cff2ce`, `Merge pull request #28
from ticketry-hq/agent/keep-generated-specs-local`, adds no independent file or
behavioral content.

The merge tree is exactly the second-parent tree:

```text
merge tree:         315ed85df62b61aa8381eb90ec063bcc266cbd3e
second-parent tree: 315ed85df62b61aa8381eb90ec063bcc266cbd3e
```

Both the dense combined patch and Git's reconstructed merge-resolution diff
are empty. Everything visible against the first parent was already present in
`602596a1ea0146a1d19aad20912bdd9d3b2f1dfe`.

## Parent and ancestry verification

The actual parents are not `3a5f434...` and `602596a...`. Git reports:

```text
first parent:  aefbd1b56c2b8763430c96d7f4b5fd61669f54c0
second parent: 602596a1ea0146a1d19aad20912bdd9d3b2f1dfe
```

`3a5f434a90696f40a4911e401a84db009cdfa4e7` is the direct parent of
`602596a...`, so it remains part of the reviewed second-parent history.

Command:

```bash
git show -s --format='commit %H%nparents %P%ntree %T%nsubject %s' \
  44a3c6e1aa78da7af765e8fa436e683335cff2ce
```

Evidence:

```text
commit 44a3c6e1aa78da7af765e8fa436e683335cff2ce
parents aefbd1b56c2b8763430c96d7f4b5fd61669f54c0 602596a1ea0146a1d19aad20912bdd9d3b2f1dfe
tree 315ed85df62b61aa8381eb90ec063bcc266cbd3e
subject Merge pull request #28 from ticketry-hq/agent/keep-generated-specs-local
```

The two merge parents diverge at `6c6d268e310e6515fba28aebd1045d736833cc59`:

```bash
git merge-base 44a3c6e1^1 44a3c6e1^2
```

```text
6c6d268e310e6515fba28aebd1045d736833cc59
```

The first-parent tree and merge-base tree are themselves identical:

```text
aefbd1b tree: 2d446db94b8d0c85f50c29c5200d30b76fa239c1
6c6d268 tree: 2d446db94b8d0c85f50c29c5200d30b76fa239c1
```

This explains the clean result. Although the parent histories diverge, the
first parent contributes no tree change relative to the merge base. The result
therefore takes the complete second-parent tree without a conflict resolution.

The second-parent branch content between the merge base and this merge is:

```bash
git log --reverse --topo-order --format='%H %P %s' 44a3c6e1^1..44a3c6e1^2
```

```text
3a5f434a90696f40a4911e401a84db009cdfa4e7 6c6d268e310e6515fba28aebd1045d736833cc59 Harden repository governance and backend REST boundaries
602596a1ea0146a1d19aad20912bdd9d3b2f1dfe 3a5f434a90696f40a4911e401a84db009cdfa4e7 Harden terminal runtime ownership and agent launch isolation
```

## Requested diff views

### First-parent diff

```bash
git diff --shortstat 44a3c6e1^1 44a3c6e1
```

```text
677 files changed, 53707 insertions(+), 19581 deletions(-)
```

`git diff --name-only 44a3c6e1^1 44a3c6e1` enumerates those paths. This is
not merge-authored content. The merge tree equals `602596a...`, so this entire
first-parent view is the already-reviewed second-parent snapshot measured
against `aefbd1b...`.

### Second-parent diff

```bash
git diff --name-status 44a3c6e1^2 44a3c6e1
git diff --raw 44a3c6e1^2 44a3c6e1
```

Both commands produce no output. `git rev-parse` also reports the same tree
hash for the merge and second parent, which is a stronger whole-tree equality
check than a path summary.

### Combined diff

```bash
git show --cc --combined-all-paths \
  --format='commit %H%nparents %P%nsubject %s' \
  --patch --no-ext-diff 44a3c6e1
git diff-tree -r --cc --combined-all-paths --raw --no-commit-id 44a3c6e1
```

The first command prints only the commit header. The second prints nothing.
There is no path or hunk changed relative to both parents.

### Merge-resolution diff

```bash
git show --remerge-diff \
  --format='commit %H%nparents %P%nsubject %s' \
  --stat --summary 44a3c6e1
```

Output:

```text
commit 44a3c6e1aa78da7af765e8fa436e683335cff2ce
parents aefbd1b56c2b8763430c96d7f4b5fd61669f54c0 602596a1ea0146a1d19aad20912bdd9d3b2f1dfe
subject Merge pull request #28 from ticketry-hq/agent/keep-generated-specs-local
```

There is no stat, path, or patch after the header. Git's reconstructed automatic
merge matches the recorded merge, so the commit contains no manual
merge-resolution change.

### Comparison with the reviewed content commits

These commands report the same result:

```bash
git diff --shortstat 3a5f434a90696f40a4911e401a84db009cdfa4e7 \
  602596a1ea0146a1d19aad20912bdd9d3b2f1dfe
git diff --shortstat 3a5f434a90696f40a4911e401a84db009cdfa4e7 \
  44a3c6e1aa78da7af765e8fa436e683335cff2ce
```

```text
176 files changed, 9185 insertions(+), 805 deletions(-)
```

The matching shortstat follows from the exact tree identity between `602596a`
and the merge. It confirms that the merge adds nothing beyond the previously
reviewed `3a5f434...` and `602596a...` content sequence.

## Parity classification

| Meaningful merge concern | Classification | Evidence |
| --- | --- | --- |
| First-parent-visible product, Django, documentation, generated-contract, and test changes | Already present or behaviorally equivalent | Every resulting blob and path is already in second parent `602596a...`; the trees are identical. |
| Merge commit metadata and topology | Not applicable to the current architecture | The commit records integration history but changes no repository path or runtime behavior. |

There are no merge-introduced concerns classified as Django-only and obsolete,
missing and should be ported, or partially present and needs follow-up. Those
categories have zero entries for this commit.

## Accounting verdict

The commit is fully accounted for. It is topology-only for parity purposes.
There is no independent behavior to compare with Rust and React, no parity gap,
and no Story to draft or create.

## Next commit

The next commit in Git's reverse topological order after this merge is:

```text
9d752d77b3da9766c3e4c79e32624cc66d860ddb Prepare Ticketry 0.2.0 release
```

This audit identifies that commit only. It does not review it.
