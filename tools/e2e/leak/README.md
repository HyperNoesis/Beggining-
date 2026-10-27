Chair-leak test (measured, synthetic leak). Serve the project root at http://127.0.0.1:8123/app/ then, for each of
`LEAK=1 PATCH='{"seatClip":0,"seatFit":0,"personScale":1,"personY":0}'`, `LEAK=1 PATCH='{"seatClip":1,...same}'`, `LEAK=0 PATCH='{"seatClip":1,...same}'`
run `node shot_leak.js scene-lounge-seat` and compare the left 14% of the frame (rows 35-85%) against the LEAK=0 render.
Result recorded on 2026-10-23 in the build sandbox: mean abs diff vs clean = 42.09 without the clip, 0.24 with the clip.
