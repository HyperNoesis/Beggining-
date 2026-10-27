# Photoreal scene pack: how to make and import scenes (v0.15)
## The picture must have (the importer checks most of this)
- 16:9, 1280x720 or bigger (it centre-crops to 16:9 and saves 1280x720).
- A desk or table edge running across the bottom third (you sit behind it). Horizontal, or slightly tilted.
- An EMPTY chair or empty space where you will sit. No people, no faces, no readable logos/brand marks.
- Even light, not black, not blown out. One main light side (the importer reads which).
- Licence you can prove: your own photo, or a generator whose terms allow commercial use. Keep the terms (URL + date).
## Import (any machine with node + python3 + Pillow)
`node tools/scenes/import_scene.js photo.jpg --name "Studio Loft" --type loft --licence "Own photo, taken 2026-10-20"`
Add `--source "Generator X, terms page URL, date"` for generated pictures. `--dry` checks without writing. `--force` imports a picture that failed the check (then drag the desk line in Scene Wizard).
Writes assets/environments/<id>.jpg, assets/scenes/<id>/scene.json + LICENCE.txt, a line in docs/SCENE_LICENCES.md, and rebuilds js/providers/scene-library.js. Then bump SHELL_CACHE in sw.js and zip.
## Prompt pack (paste into any image generator; change the bracketed words)
Base: "Photograph of an empty [ROOM TYPE], eye-level fixed camera at about 120 cm, 16:9, a [DESK STYLE] desk running across the bottom third of the frame, an empty [CHAIR STYLE] chair behind it, no people, no text, no logos, soft [LIGHT DIRECTION] window light, shallow depth of field in the background, natural colours, realistic, high detail."
Room types to cover (12+): news studio, podcast room, home office (bright), home office (dark wood), library, living room, classroom, startup loft, glass meeting room, kitchen counter, garden terrace, workshop/maker space, bedroom desk, recording booth, church/community hall office.
Vary: light side (left/right), time of day, colour of wall, desk material (wood, white, black), plants/shelves/monitors.
Negative: "people, faces, hands, text, watermark, logos, brand names, fisheye, tilt, extreme perspective".
Tips: reject pictures where the desk edge is blurry or curved a lot, where the chair is cut off by the frame, or where there are windows so bright that they blow out (the check flags the last one).

## Prompt for a BETTER church/stage scene (the v0.22 stage picture is a wide hall with a tiny lectern; it only works as a large-presenter background)
"Photograph from behind a large wooden lectern or pulpit in the foreground, taking the bottom third of the frame across the full width, eye-level fixed camera, an empty stage and a softly lit hall or sanctuary behind it with warm lights and a large screen, no people, no text, no logos, shallow depth of field, 16:9, realistic." (Church version: wooden pulpit, stained glass, warm spotlights.) The lectern top edge is then the desk line.
