# Blind test (brief section 4: Realism, "7 of 10 viewers do not notice")
Open `blindtest.html` (works offline, nothing leaves the device).
1. Record the SAME person in a real room and in a Genesis scene (same framing, similar light, 10-20 s or stills). Mark items Real / Virtual. Use only consented footage.
2. Run 10+ viewers one at a time. Each answers "looks real / looks virtual" for every shuffled item.
3. Results: a viewer "did not notice" if they called at most 40% of the virtual items virtual. PASS = at least 10 viewers and 70% not noticing. False alarms (real called virtual) are shown beside it.
Export CSV/JSON; import other devices' JSON to combine them.
Status: the tool is built and unit-tested (tools/e2e/unit_blindtest.js). NO real viewer session has been run. The shipped scenes are stylised drawings, so expect a FAIL until photoreal scene packs exist.
