# LessonCanvas / GraphCalc

- `lessoncanvas.html` — JSON-driven interactive lesson shell. Self-contained single file.
- `graphcalc.html` — standalone Desmos-style graphing calculator. Also self-contained, and also embeddable via `createGraphCalc(container, options)`.
- `validate-lesson.js` — offline validator for lesson JSON files: `node validate-lesson.js my-lesson.json`. Run this before shipping a lesson to a student; it catches things the app itself only ever reports as a `console.warn`.

## Before studying from a new lesson

1. Run `node validate-lesson.js <lesson>.json` and fix every **error** it reports. Warnings are
   advisory (worth a look, not blocking); errors mean something is genuinely wrong.
2. The validator can't check everything. It doesn't run `check_expression`s (those only execute
   live, in the browser console) and it has no way to judge whether the lesson content is factually
   correct — that's still on you.
3. Open the lesson once with the browser console visible and click through it before working
   through it for real. Watch for amber verification banners on graded blocks and any
   `console.warn` output — both mean something needs fixing before the lesson is trustworthy to
   study from.

## Re-embedding GraphCalc into LessonCanvas

`lessoncanvas.html` embeds the *entire contents* of `graphcalc.html` as a base64 string (`GRAPHCALC_HTML_B64`), decoded at runtime into the Calculator modal's iframe. This is what lets a lesson file work standalone no matter where it's copied to — it never depends on `graphcalc.html` being present alongside it.

**This is a snapshot, not a live reference.** Editing `graphcalc.html` does nothing to already-embedded lesson files (including `lessoncanvas.html` itself) until the blob is regenerated and re-pasted in by hand.

Whenever `graphcalc.html` changes and you want that change to show up in the embedded Calculator, run this from the repo root:

```bash
awk -v b64file=<(base64 -w0 games/graphcalc.html) '
BEGIN{ getline b64 < b64file }
/^  const GRAPHCALC_HTML_B64 = "/{ print "  const GRAPHCALC_HTML_B64 = \"" b64 "\";"; next }
{ print }
' games/lessoncanvas.html > /tmp/lessoncanvas_new.html && mv /tmp/lessoncanvas_new.html games/lessoncanvas.html
```

Note the `^  ` (line-start, two-space indent) anchor on the match pattern — it's required, not decorative. Without it, this command (and the verification below) would also match the doc comment sitting directly above the real assignment in `lessoncanvas.html`, since that comment necessarily quotes this same command and therefore contains the same literal text. An unanchored match against that comment line would corrupt the file on the very next re-embed.

Then verify it actually took: decode the constant back out and diff it against `graphcalc.html` — they must match byte-for-byte.

```bash
grep -o '^  const GRAPHCALC_HTML_B64 = "[^"]*"' games/lessoncanvas.html \
  | sed -e 's/^  const GRAPHCALC_HTML_B64 = "//' -e 's/"$//' \
  | base64 -d > /tmp/decoded_check.html
diff games/graphcalc.html /tmp/decoded_check.html && echo "match"
```

The comment directly above `GRAPHCALC_HTML_B64` in `lessoncanvas.html` records the source file's SHA-256 and the date it was last encoded — update both when you re-embed.

**Don't forget the same file lives in exported per-lesson copies too.** Any standalone lesson file exported from this shell (e.g. files handed out to students) carries its own frozen copy of this same blob. Re-embedding in the shell does not update those; each exported copy needs the same treatment separately if it should pick up a GraphCalc change.

## The `</script>` escaping gotcha

Any literal `</script>` substring inside a `<script>` tag's raw text — even nested inside a JS string or JSON value — prematurely terminates the *outer* `<script>` tag, because HTML parsing doesn't understand JS string context. This bites hardest when re-splicing lesson content that contains `custom` blocks with real `<script>` tags (interactive widgets), since `JSON.stringify` does not escape `/`. Fix: replace `</script` with `<\/script` (a backslash dropped at the JS-string level, but enough to break the raw HTML match) in the final assembled text. Re-verify with a syntax check on the extracted `<script>` contents after any such splice — a syntax error there means this bug resurfaced.
