// Written by tools/stamp-version.sh (run it before committing and before clasp push). Self-reported: "+" = that commit plus later changes.
const BUILD_INFO = {commit: "b81a41e+", date: "2026-11-07", branch: "bc-timeout-fix"};

/** "4c6d2ec+ (2026-10-25, refactor-and-grid)" - shown in the developer tools sidebars. */
function buildVersionLabel(){
  return BUILD_INFO.commit + " (" + BUILD_INFO.date + ", " + BUILD_INFO.branch + ")";
}
