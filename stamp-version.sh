#!/bin/bash
# ============================================================================
# stamp-version.sh — stamp every asset link with today's version
# ----------------------------------------------------------------------------
# Run this once before pushing a change, then commit what it edited:
#
#     ./stamp-version.sh && git add -A && git commit && git push
#
# WHY THIS EXISTS
#
# GitHub Pages tells browsers to keep assets for ten minutes. That is normally
# fine, but the editor draws its preview by loading preview.html in a hidden
# frame, and both pages load slide.js separately. Refresh the editor inside
# that ten-minute window — especially with a hard refresh, which bypasses the
# cache for the page but not always for what is inside the frame — and you get
# the new editor talking to the old renderer. What that looks like is "##" and
# "**" showing up as literal characters on the preview, because the editor
# thinks slide.js understands them and the cached slide.js does not.
#
# Stamping every asset with a version makes each release a different address,
# so a browser cannot serve half of one version and half of another. There is
# no build step here and there isn't going to be one; this is a shell script
# that runs sed, and it is the whole of it.
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")"

VERSION="$(date +%Y%m%d%H%M)"

for f in index.html import.html preview.html signup.html; do
  [ -f "$f" ] || continue
  # Strip any previous stamp, then add the current one. Doing it in that order
  # means running this twice in a row is harmless rather than cumulative.
  #
  # preview.html is stamped as well as the assets, because it is loaded in a
  # frame by the editor. Stamping only the scripts would still allow a cached
  # copy of that page to pull in a stale slide.js through the old address
  # written inside it — which is precisely the mixed state this prevents.
  sed -i '' -E \
    -e 's|(="assets/[^"?]*)\?v=[0-9]+"|\1"|g' \
    -e 's|(="preview\.html)\?v=[0-9]+"|\1"|g' \
    -e 's|(="assets/[^"?]*\.(js\|css))"|\1?v='"$VERSION"'"|g' \
    -e 's|(="preview\.html)"|\1?v='"$VERSION"'"|g' \
    "$f"
done

echo "Stamped assets with ?v=$VERSION"
grep -h -oE '="assets/[^"]*"' index.html import.html preview.html signup.html \
  | sort -u | sed 's/^="/  /; s/"$//'
