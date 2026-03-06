#!/usr/bin/env bash
# Set up node_modules in the current worktree by symlinking from the main repo.
# Usage: ./scripts/setup-worktree.sh [worktree-path]
#
# If no path given, operates on the current directory.
# Detects the main repo via `git worktree list` and symlinks its node_modules.

set -euo pipefail

WORKTREE_PATH="${1:-.}"
WORKTREE_PATH="$(cd "$WORKTREE_PATH" && pwd)"

# Find the main repo (first entry from git worktree list)
# Read into a variable to avoid SIGPIPE with head
WORKTREE_LIST="$(git -C "$WORKTREE_PATH" worktree list --porcelain)"
MAIN_REPO="$(echo "$WORKTREE_LIST" | grep '^worktree ' | head -1 | sed 's/^worktree //')"

if [ -z "$MAIN_REPO" ]; then
  echo "error: could not detect main repo from git worktree list" >&2
  exit 1
fi

SOURCE="$MAIN_REPO/node_modules"
TARGET="$WORKTREE_PATH/node_modules"

if [ ! -d "$SOURCE" ]; then
  echo "Main repo node_modules not found at $SOURCE"
  echo "Run 'npm install' in $MAIN_REPO first."
  exit 1
fi

if [ -e "$TARGET" ]; then
  if [ -L "$TARGET" ]; then
    EXISTING="$(readlink "$TARGET")"
    echo "node_modules already symlinked -> $EXISTING"
  else
    echo "node_modules already exists (not a symlink) at $TARGET"
  fi
  exit 0
fi

# Remove broken symlink if present
if [ -L "$TARGET" ]; then
  rm "$TARGET"
fi

ln -s "$SOURCE" "$TARGET"
echo "Symlinked node_modules:"
echo "  $TARGET -> $SOURCE"
