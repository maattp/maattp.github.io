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
