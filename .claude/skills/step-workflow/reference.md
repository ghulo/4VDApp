# Landing files on main without touching the checkout

Use this when another session holds the checkout (its branch is checked out, it has uncommitted work, or a test run is going). It builds a commit from `origin/main` plus your files, using a private index, so the working tree, the shared index and the current branch stay exactly as they are.

Keep your files outside the checkout (your scratchpad), or in paths the other session doesn't touch. Run in Git Bash from the repo root:

```bash
git fetch origin main
BASE=$(git rev-parse origin/main)
export GIT_INDEX_FILE="$SCRATCH/land.index"     # a private index, never .git/index
git read-tree "$BASE"

# One pair of lines per file: store the content, then put it at its repo path.
H=$(git hash-object -w "$SCRATCH/files/foo.md")
git update-index --add --cacheinfo 100644,"$H",path/in/repo/foo.md

TREE=$(git write-tree)
C=$(printf '%s\n\n%s\n' "docs: plain-English summary" "Co-Authored-By: ..." | git commit-tree "$TREE" -p "$BASE")
unset GIT_INDEX_FILE

git diff-tree -r --name-status "$BASE" "$C"     # must list only your files (A or M); stop on anything else
git push origin "$C":refs/heads/main            # no force; if rejected, fetch and start again
```

Afterwards:
- The checkout's own branch doesn't have your commit until its holder merges or pulls main. If your files also exist untracked in the checkout at the same paths, that merge can fail ("untracked working tree files would be overwritten"); that's why the files live in the scratchpad.
- Watch the "Checks" run for your commit on main, as for any merge.
- Delete the temp index file.
