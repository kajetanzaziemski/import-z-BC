#!/bin/sh
# Writes Version.js: which commit the files in this folder are, so that the developer sidebars can show it.
# Run it before `clasp push` (exact commit when the tree is clean) and before every commit (then it records the commit the new one is built on,
# with a "+": "that commit plus the changes being committed"). Self-reported: nothing checks it, and it cannot hold the hash of its own commit.
cd "$(dirname "$0")/.." || exit 1
hash=$(git rev-parse --short HEAD) || exit 1
date=$(git log -1 --format=%cs)
branch=$(git rev-parse --abbrev-ref HEAD)
plus=""
if [ -n "$(git status --porcelain | grep -v ' Version.js$')" ]; then plus="+"; fi
cat > Version.js <<JS
// Written by tools/stamp-version.sh (run it before committing and before clasp push). Self-reported: "+" = that commit plus later changes.
const BUILD_INFO = {commit: "${hash}${plus}", date: "${date}", branch: "${branch}"};

/** "4c6d2ec+ (2026-10-25, refactor-and-grid)" - shown in the developer tools sidebars. */
function buildVersionLabel(){
  return BUILD_INFO.commit + " (" + BUILD_INFO.date + ", " + BUILD_INFO.branch + ")";
}
JS
echo "Version.js: ${hash}${plus}"
