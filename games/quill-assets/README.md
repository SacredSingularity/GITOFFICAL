# Quill visual assets

Drop PNGs (or sprite sheets) here. `games/quill.html` will reference files
in this folder by name to replace the current hand-drawn SVG mascot/icons.

Based on the reference sheet, here's what I'm expecting — confirm/adjust
filenames as files actually arrive:

## Mascot poses (`mascot-*.png`)
- `mascot-idle.png` — default standing pose (home screen / greeting)
- `mascot-wink.png` / `mascot-celebrate.png` — happy, one eye closed
- `mascot-thinking.png` — wing to chin
- `mascot-pointing.png` — wing extended out
- `mascot-correct.png` — "Great job!" reaction
- `mascot-incorrect.png` — "Try again" reaction, gentle
- (sleeping / surprised poses if you have them — not in the sheet but in the
  original brief's expression list)

## World islands (`island-*.png`)
- `island-numbers-forest.png` (Maths)
- `island-reading-retreat.png` (English)
- `island-space-station.png` (Science)
- `island-history-hills.png` (History)
- `island-creative-cove.png` (Art)

## Subject icons (`icon-subject-*.png`)
- `icon-subject-maths.png`, `icon-subject-english.png`,
  `icon-subject-science.png`, `icon-subject-history.png`,
  `icon-subject-art.png`

## Badges / achievements (`badge-*.png`)
- `badge-trophy.png` (Maths Master), `badge-star.png` (Bright Mind),
  `badge-streak.png` (Streak Keeper)

## Decorative elements (`deco-*.png`)
sparkle-stars, clouds, pencil, books, trophy, scroll, flowers, leaves,
moon, heart — low-opacity background scatter.

## Buttons / UI chrome
The button/pill states (Normal/Hover/Pressed) in the reference look like a
component spec rather than assets to embed directly — I'll rebuild those as
CSS states using your color/shape as reference, not as image files, unless
you say otherwise.

Once files land here, tell me what's in each (or I'll infer from filenames
if you name them per the pattern above) and I'll wire them into the app.
