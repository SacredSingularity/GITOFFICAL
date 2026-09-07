# Quill visual assets

Cropped from the reference sprite sheet and wired into
`learning-platform/quill.html`. Drop replacement/additional PNGs here using
the same names to update the app — no code changes needed for a like-for-like
swap.

## In use

**Mascot** (`mascot-*.png`) — only one real pose exists so far:
- `mascot-happy.png` — winking/celebrating. Used for the home-screen mascot,
  and for the in-lesson coach on a correct answer and a perfect-score finish.

**Islands** (`island-*.png`) — all 5, used on the Home journey map and the
Subjects grid:
- `island-numbers-forest.png`, `island-reading-retreat.png`,
  `island-space-station.png`, `island-history-hills.png`,
  `island-creative-cove.png`

**Subject pills** (`icon-subject-*.png`) — cropped, cut out (not yet used in
the app UI, but ready — a subject quick-switcher row would use these as-is,
background+label baked in):
- `icon-subject-maths.png`, `icon-subject-english.png`,
  `icon-subject-science.png`, `icon-subject-history.png`,
  `icon-subject-art.png`

**Decorative** (`deco-*.png`) — used for the low-opacity ambient background
scatter (stars, sparkles, cloud, flowers, leaf, moon, heart, pencil, books,
trophy, scroll):
- `deco-star-pair.png`, `deco-sparkle-small.png`, `deco-sparkle-tiny.png`,
  `deco-star-blue.png`, `deco-cloud.png`, `deco-flower1.png`,
  `deco-flower2.png`, `deco-leaf.png`, `deco-moon.png`, `deco-heart.png`,
  `deco-pencil.png`, `deco-books.png`, `deco-trophy.png`, `deco-scroll.png`

**Achievement badges** (`badge-*.png`) — cropped but not yet wired in
(Achievements view still uses emoji, since the sheet only had one badge
icon design, not distinct trophy/star/flame badges):
- `badge-earned.png`, `badge-locked.png` (greyed, question-mark)

**Toolbar icons** (`icon-toolbar-*.png`, `icon-star.png`,
`icon-sparkle-blob.png`) — cropped but not yet wired in; there's no "Tools"
menu in the app yet (design brief calls for collapsing secondary tools into
one, not built this pass):
- `icon-toolbar-book.png`, `icon-toolbar-calculator.png`,
  `icon-toolbar-pencil.png`, `icon-toolbar-flask.png`,
  `icon-toolbar-palette.png`

## Still missing

The sheet only supplied one mascot expression (the winking/celebrating
pose, reused for both its "Great job" and "Try again" reaction cards). The
app still uses hand-drawn SVG for every other pose — idle, wave, encourage
(incorrect answer), thinking, sleeping, surprised, pointing — because using
the same cheerful face for a wrong answer would read as celebrating the
mistake. If you get a genuine "gentle/encouraging" pose (not winking) for
incorrect answers, or art for the other poses, drop it in as `mascot-<mood>.png`
and it'll slot into `QUILL_MASCOT_ART` in quill.html.
