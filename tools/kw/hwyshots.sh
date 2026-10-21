#!/bin/sh
# Auto KW's freeways (src/highways.js): shoot every exit's overhead sign from
# the right lane, the first few ground signs of each kind, and three aerials.
#
#   sh tools/kw/hwyshots.sh <outdir> [name-prefixes,comma,separated]
#
# Prefixes: '<route>-<exit>-<street>' for the overhead signs (e.g. 401-282,
# 8--Fairway, '7;8--Homer'), adv (1 km signs), gore, spd (MAXIMUM), route
# (reassurance shields), rail (guide rail runs), mast (high masts), noise
# (Parkway noise walls), air. Needs the http server; AUTO_HTTP_PORT /
# AUTO_CDP_PORT / AUTO_GPU / AUTO_PHONE pass through to kwshots.mjs. Pass 1
# boots once and reads the viewpoints highways.js recorded (window.__hwy.views);
# pass 2 shoots them. The boot cache is cleared first (geometry changes
# without a build bump would otherwise be shot from the cached city).
set -e
OUT=${1:?outdir}
CDP=${AUTO_CDP_PORT:-9412}
mkdir -p "$OUT"
rm -rf "/tmp/autokw-shots-profile-$CDP"
VIEW_PROBE='JSON.stringify(window.__hwy.views.concat([
  {name:"air-fairway",c:[2800,2480,30],t:[2960,2620,0],fov:60},
  {name:"air-401",c:[10900,4200,30],t:[11100,4300,0],fov:60},
  {name:"air-85",c:[-500,-1300,30],t:[-300,-1100,0],fov:60}]))' \
  node tools/kw/kwshots.mjs "$OUT" 2>&1 | grep '^\[' > "$OUT/views.json"
VIEWS="$OUT/views.json" VIEW_WAIT=${VIEW_WAIT:-2500} node tools/kw/kwshots.mjs "$OUT" ${2:+"$2"}
