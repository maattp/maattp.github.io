# Auto: future improvements

Local notes, not a spec.

## Link 2 Line (East Link)

- Across I-90 to Mercer Island and Bellevue. In OSM it joins the 1 Line at the
  junction south of International District; `tools/build_link.py` currently
  walks each track's two 1 Line ends only, so the branch is dropped.
- Needs: a third/fourth track pair in `link.json`, a switch at the junction
  (a service pattern per line, the player picks at the junction or by the
  train they board), the floating-bridge section on I-90 (deck on the bridge,
  not the solved ground profile), Judkins Park / Mercer Island / South
  Bellevue / Bellevue Downtown stations, 2 Line blue on the map.
- The map's east edge is ~x 13000: check how much of Bellevue/Redmond is in.

## Freight train

- Catch it at the Interbay / Balmer Yard by Magnolia; the BNSF main line runs
  the whole map north-south (Everett direction past Golden Gardens / Shilshole,
  south through the waterfront tunnel under downtown, SODO, the Duwamish).
- Data already extracted: `tools/data/raw_rail.json` (railway=rail with
  usage/service tags; yards and sidings included). Pick the main line by
  `usage=main` and stitch like `build_link.py`.
- A very long, detailed train: diesel locomotives (two or three up front),
  a long consist (intermodal wells, tank cars, hoppers, boxcars) — instanced
  per car type, bones or per-car transforms along the track.
- Reuse `src/link.js`'s track/profile code (LinkTrack, envelopes, bores for the
  Great Northern tunnel under downtown); `spec.rail` already routes boarding,
  exit spots and the camera.
- Driving: throttle notches and air brakes, a heavy train's slow acceleration,
  grade effects; crossings with gates at grade.
