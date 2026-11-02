#!/bin/sh
# Draws / tris of a residential street by night and day, for each season (phone profile).
#   AUTO_HTTP_PORT=.. AUTO_CDP_PORT=.. sh tools/kw/calcost.sh
for d in 2026-06-15 2026-12-10 2026-10-31; do
  echo "== $d"
  case "$d" in 2026-10-31) V=halloween-night-street,halloween-day-street ;; *) V=xmas-night-street,xmas-day-street ;; esac
  AUTO_PHONE=1 AUTO_GPU=1 VIEWS=tools/kw/calviews.json VIEW_BOOT_FILE=tools/kw/seedrandom.js VIEW_BOOT_JS="window.__calDate='$d';" \
    VIEW_INFO='JSON.stringify(window.__dbg.calendar.stats)' node tools/kw/kwshots.mjs "/tmp/cal-ph-$d" "$V" 2>&1 | grep -v booted | grep -v "^    "
done
