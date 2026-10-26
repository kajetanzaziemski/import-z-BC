// Written by tools/stamp-version.sh (run it before committing and before clasp push). Self-reported: "+" = that commit plus later changes.
const BUILD_INFO = {commit: "a10b0de+", date: "2026-10-26", branch: "refactor-and-grid"};

/** "4c6d2ec+ (2026-10-25, refactor-and-grid)" - shown in the developer tools sidebars. */
function buildVersionLabel(){
  return BUILD_INFO.commit + " (" + BUILD_INFO.date + ", " + BUILD_INFO.branch + ")";
}
